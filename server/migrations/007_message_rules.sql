-- Toosh 007: message formats a person taught Toosh ("Bar Toosh"). Additive only.
-- Each rule is a sender plus a pattern built from one example SMS (shared/src/rules.ts). The example is kept so the
-- person can see what they taught; it is their own message and is protected by row-level security like messages.
CREATE TABLE message_rules (
  id          uuid PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sender      text NOT NULL CHECK (char_length(sender) BETWEEN 1 AND 64),
  pattern     text NOT NULL CHECK (char_length(pattern) BETWEEN 3 AND 6000),
  direction   text NOT NULL CHECK (direction IN ('IN', 'OUT', 'NONE')),
  example     text NOT NULL CHECK (char_length(example) BETWEEN 1 AND 2000),
  created_by_device_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  change_seq  bigint NOT NULL DEFAULT nextval('change_seq')
);
CREATE INDEX message_rules_account ON message_rules (account_id, change_seq);

ALTER TABLE message_rules ENABLE ROW LEVEL SECURITY; ALTER TABLE message_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY message_rules_owner ON message_rules USING (account_id = app_account()) WITH CHECK (account_id = app_account());
