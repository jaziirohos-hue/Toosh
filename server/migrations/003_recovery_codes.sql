-- Toosh 003: one-time recovery codes for a forgotten password. Additive only.
-- Each code is stored only as a salted scrypt hash (like passwords). A used or replaced code can never work again.
CREATE TABLE recovery_codes (
  id                uuid PRIMARY KEY,
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code_hash         text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  used_at           timestamptz,
  used_by_device_id uuid,
  replaced_at       timestamptz
);
CREATE INDEX recovery_codes_active ON recovery_codes (account_id) WHERE used_at IS NULL AND replaced_at IS NULL;

ALTER TABLE recovery_codes ENABLE ROW LEVEL SECURITY; ALTER TABLE recovery_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY recovery_codes_owner ON recovery_codes USING (account_id = app_account()) WITH CHECK (account_id = app_account());
