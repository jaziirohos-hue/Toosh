-- Toosh initial schema.
-- Every account-owned table carries account_id and is protected by row-level security (RLS). The server sets
-- app.account_id per transaction; a query that forgets its own WHERE account_id still cannot see other accounts.
-- FORCE ROW LEVEL SECURITY applies the policies to the table owner too. Run the server as a role that is neither
-- SUPERUSER nor BYPASSRLS (the server refuses to start in production otherwise).

CREATE OR REPLACE FUNCTION app_setting(name text) RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting(name, true), '') $$;
CREATE OR REPLACE FUNCTION app_account() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT app_setting('app.account_id')::uuid $$;

-- One global, monotonically increasing change counter. Clients use it to apply updates in order and to ignore
-- stale (out-of-order) deliveries.
CREATE SEQUENCE change_seq;

CREATE TABLE accounts (
  id             uuid PRIMARY KEY,
  display_name   text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  login_phone    text NOT NULL UNIQUE CHECK (login_phone ~ '^\+252[67][0-9]{8}$'),
  password_hash  text NOT NULL,
  timezone       text NOT NULL DEFAULT 'Africa/Mogadishu',
  failed_logins  integer NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id              uuid PRIMARY KEY,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('SOURCE', 'VIEWER')),
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  platform        text NOT NULL CHECK (platform IN ('android', 'web', 'ios', 'other')),
  model           text CHECK (char_length(model) <= 80),
  app_version     text CHECK (char_length(app_version) <= 40),
  token_hash      text NOT NULL UNIQUE,
  sms_permission  text NOT NULL DEFAULT 'UNKNOWN' CHECK (sms_permission IN ('GRANTED', 'DENIED', 'UNKNOWN', 'NOT_APPLICABLE')),
  queue_pending   integer,
  queue_failed    integer,
  last_error      text CHECK (char_length(last_error) <= 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz,              -- last authenticated contact of any kind
  last_upload_at  timestamptz,              -- last successful SMS upload (source devices)
  revoked_at      timestamptz,
  revoked_by      uuid,
  change_seq      bigint NOT NULL DEFAULT nextval('change_seq')
);
CREATE INDEX devices_account ON devices (account_id) WHERE revoked_at IS NULL;

CREATE TABLE evc_numbers (
  id                  uuid PRIMARY KEY,
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  msisdn              text NOT NULL CHECK (msisdn ~ '^\+252[67][0-9]{8}$'),
  display_name        text CHECK (char_length(display_name) <= 80),
  -- No verification flow exists yet, so a number is never marked verified.
  verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN ('UNVERIFIED')),
  source_device_id    uuid REFERENCES devices(id),
  sim_subscription_id integer,
  sim_slot            integer CHECK (sim_slot BETWEEN 0 AND 7),
  sim_label           text CHECK (char_length(sim_label) <= 80),
  created_at          timestamptz NOT NULL DEFAULT now(),
  change_seq          bigint NOT NULL DEFAULT nextval('change_seq'),
  UNIQUE (account_id, msisdn),
  UNIQUE (account_id, id)
);

CREATE TABLE messages (
  id                    uuid PRIMARY KEY,
  account_id            uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  evc_number_id         uuid NOT NULL,
  source_device_id      uuid NOT NULL REFERENCES devices(id),
  -- Import identity chosen by the phone (stable across retries) and the server's content identity.
  client_message_id     text NOT NULL CHECK (char_length(client_message_id) BETWEEN 8 AND 128),
  dedupe_key            text NOT NULL,
  -- Original SMS. Never modified after insert (enforced by trigger below).
  sender                text NOT NULL CHECK (char_length(sender) BETWEEN 1 AND 64),
  body                  text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  sms_timestamp         timestamptz NOT NULL,  -- timestamp carried by the SMS network (service centre)
  received_at           timestamptz NOT NULL,  -- when the source phone received it
  uploaded_at           timestamptz NOT NULL DEFAULT now(), -- when the server stored it
  sim_subscription_id   integer,
  sim_slot              integer,
  import_method         text NOT NULL CHECK (import_method IN ('LIVE', 'INITIAL_IMPORT', 'RECOVERY')),
  parts_count           integer NOT NULL DEFAULT 1 CHECK (parts_count BETWEEN 1 AND 30),
  -- Latest parser output (suggestions). Reprocessing may replace it; it never overrides manual work.
  parser_version        text NOT NULL,
  parsed                jsonb NOT NULL,
  -- Classification (separate from sync status, which lives on the phone and in uploaded_at).
  classification        text NOT NULL CHECK (classification IN ('PENDING', 'TRANSACTION', 'NOT_TRANSACTION')),
  classification_source text NOT NULL CHECK (classification_source IN ('PARSER', 'MANUAL')),
  -- Effective transaction fields (set only while classification = TRANSACTION).
  direction             text CHECK (direction IN ('IN', 'OUT')),
  amount_milli          bigint CHECK (amount_milli > 0),
  currency              text CHECK (currency IN ('USD')),
  occurred_at           timestamptz,
  occurred_at_source    text CHECK (occurred_at_source IN ('SMS', 'RECEIPT_FALLBACK', 'MANUAL')),
  counterparty_name     text CHECK (char_length(counterparty_name) <= 120),
  counterparty_phone    text CHECK (counterparty_phone ~ '^\+252[67][0-9]{8}$'),
  provider_ref          text CHECK (char_length(provider_ref) <= 64),
  -- SMS-reported balance (thousandths). Eligible for "latest balance" only when not PENDING.
  balance_milli         bigint CHECK (balance_milli >= 0),
  balance_source        text CHECK (balance_source IN ('PARSER', 'MANUAL')),
  balance_effective_at  timestamptz GENERATED ALWAYS AS (COALESCE(occurred_at, sms_timestamp)) STORED,
  field_sources         jsonb NOT NULL DEFAULT '{}'::jsonb,
  version               integer NOT NULL DEFAULT 1,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by_device_id  uuid,
  change_seq            bigint NOT NULL DEFAULT nextval('change_seq'),
  FOREIGN KEY (account_id, evc_number_id) REFERENCES evc_numbers (account_id, id),
  CONSTRAINT transaction_complete CHECK (classification <> 'TRANSACTION' OR
    (direction IS NOT NULL AND amount_milli IS NOT NULL AND currency IS NOT NULL AND occurred_at IS NOT NULL AND occurred_at_source IS NOT NULL)),
  CONSTRAINT non_transaction_clean CHECK (classification = 'TRANSACTION' OR (direction IS NULL AND amount_milli IS NULL)),
  UNIQUE (account_id, dedupe_key),
  UNIQUE (source_device_id, client_message_id)
);
-- A provider reference can back at most one confirmed transaction per number.
CREATE UNIQUE INDEX messages_provider_ref ON messages (account_id, evc_number_id, provider_ref)
  WHERE classification = 'TRANSACTION' AND provider_ref IS NOT NULL;
CREATE INDEX messages_inbox ON messages (account_id, received_at DESC, id DESC);
CREATE INDEX messages_pending ON messages (account_id, received_at DESC) WHERE classification = 'PENDING';
CREATE INDEX messages_transactions ON messages (account_id, occurred_at DESC, id DESC) WHERE classification = 'TRANSACTION';
CREATE INDEX messages_balance ON messages (account_id, evc_number_id, balance_effective_at DESC, received_at DESC)
  WHERE balance_milli IS NOT NULL AND classification <> 'PENDING';
CREATE INDEX messages_changes ON messages (account_id, change_seq);

-- The original SMS is immutable.
CREATE OR REPLACE FUNCTION messages_protect_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.sender IS DISTINCT FROM OLD.sender
     OR NEW.sms_timestamp IS DISTINCT FROM OLD.sms_timestamp OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.evc_number_id IS DISTINCT FROM OLD.evc_number_id
     OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key OR NEW.client_message_id IS DISTINCT FROM OLD.client_message_id THEN
    RAISE EXCEPTION 'original SMS fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER messages_protect_original BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION messages_protect_original();
CREATE OR REPLACE FUNCTION messages_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'messages cannot be deleted' USING ERRCODE = 'check_violation'; END $$;
CREATE TRIGGER messages_no_delete BEFORE DELETE ON messages FOR EACH ROW
  WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION messages_no_delete();

-- Who changed what, when, and the previous values. Append-only.
CREATE TABLE message_changes (
  id                bigserial PRIMARY KEY,
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  message_id        uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  action            text NOT NULL CHECK (action IN ('INGEST', 'CLASSIFY', 'REPROCESS')),
  actor_device_id   uuid,
  actor_device_name text,
  from_version      integer,
  to_version        integer NOT NULL,
  previous          jsonb,
  next              jsonb NOT NULL,
  changed_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_changes_message ON message_changes (message_id, id);

CREATE TABLE pairing_codes (
  code_hash   text PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES devices(id),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  used_by     uuid
);

-- Row-level security.
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;        ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;         ALTER TABLE devices FORCE ROW LEVEL SECURITY;
ALTER TABLE evc_numbers ENABLE ROW LEVEL SECURITY;     ALTER TABLE evc_numbers FORCE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;        ALTER TABLE messages FORCE ROW LEVEL SECURITY;
ALTER TABLE message_changes ENABLE ROW LEVEL SECURITY; ALTER TABLE message_changes FORCE ROW LEVEL SECURITY;
ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;   ALTER TABLE pairing_codes FORCE ROW LEVEL SECURITY;

-- Login looks an account up by phone before its id is known; registration inserts with the new id set.
CREATE POLICY accounts_owner ON accounts USING (id = app_account() OR login_phone = app_setting('app.login_phone'))
  WITH CHECK (id = app_account());
-- Authentication looks a device up by the hash of its token before the account is known.
CREATE POLICY devices_owner ON devices USING (account_id = app_account() OR token_hash = app_setting('app.token_hash'))
  WITH CHECK (account_id = app_account());
CREATE POLICY evc_numbers_owner ON evc_numbers USING (account_id = app_account()) WITH CHECK (account_id = app_account());
CREATE POLICY messages_owner ON messages USING (account_id = app_account()) WITH CHECK (account_id = app_account());
CREATE POLICY message_changes_owner ON message_changes USING (account_id = app_account()) WITH CHECK (account_id = app_account());
CREATE POLICY pairing_codes_owner ON pairing_codes USING (account_id = app_account() OR code_hash = app_setting('app.pairing_hash'))
  WITH CHECK (account_id = app_account());
