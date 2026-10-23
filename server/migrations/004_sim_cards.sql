-- Toosh 004: SIM card records. Additive only.
-- A record is the person's own note about a SIM they use. Deleting it removes only this row: it never touches EVC
-- numbers, messages, other records, or the real SIM on the mobile network.
CREATE TABLE sim_cards (
  id            uuid PRIMARY KEY,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  phone         text NOT NULL CHECK (phone ~ '^\+252[6-9][0-9]{8}$'),
  provider      text NOT NULL CHECK (provider IN ('HORMUUD', 'SOMTEL', 'GOLIS', 'OTHER')),
  registered_on date NOT NULL,
  notes         text CHECK (char_length(notes) <= 500),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  change_seq    bigint NOT NULL DEFAULT nextval('change_seq'),
  UNIQUE (account_id, phone)
);
CREATE INDEX sim_cards_changes ON sim_cards (account_id, change_seq);

ALTER TABLE sim_cards ENABLE ROW LEVEL SECURITY; ALTER TABLE sim_cards FORCE ROW LEVEL SECURITY;
CREATE POLICY sim_cards_owner ON sim_cards USING (account_id = app_account()) WITH CHECK (account_id = app_account());
