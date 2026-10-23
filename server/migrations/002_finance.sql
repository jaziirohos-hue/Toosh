-- Toosh 002: expenses, categories, budgets and savings goals.
-- Additive only: no existing table, column or row is changed. Every new table is account-owned and protected by the
-- same row-level security as 001 (account_id = app_account()), and carries change_seq so other devices refresh.

-- Built-in category keys (labels and icons live in shared/src/finance.ts). 'biil' is "Bills".
CREATE OR REPLACE FUNCTION is_builtin_category(key text) RETURNS boolean LANGUAGE sql IMMUTABLE AS
$$ SELECT key IN ('biil', 'korantada', 'iskuulka', 'dugsiga', 'gaari_raac', 'kirada', 'biyaha', 'cuntada', 'internet', 'caafimaadka', 'kale') $$;

-- Categories a person adds themselves. Archived instead of deleted, so past expenses keep their category.
CREATE TABLE expense_categories (
  id           uuid PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  icon         text NOT NULL CHECK (icon ~ '^[a-z_]{1,40}$'),
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  change_seq   bigint NOT NULL DEFAULT nextval('change_seq'),
  UNIQUE (account_id, id)
);
CREATE UNIQUE INDEX expense_categories_name ON expense_categories (account_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX expense_categories_changes ON expense_categories (account_id, change_seq);

-- Expenses entered by hand (cash and anything not seen in an EVC Plus SMS). Deleting hides the row (deleted_at)
-- so financial history is never silently lost.
CREATE TABLE expenses (
  id                   uuid PRIMARY KEY,
  account_id           uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name                 text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  amount_milli         bigint NOT NULL CHECK (amount_milli > 0 AND amount_milli <= 999999999999),
  currency             text NOT NULL CHECK (currency IN ('USD', 'SOS')),
  category_key         text CHECK (category_key IS NULL OR is_builtin_category(category_key)),
  custom_category_id   uuid,
  spent_on             date NOT NULL,
  description          text CHECK (char_length(description) <= 500),
  payment_status       text NOT NULL CHECK (payment_status IN ('PAID', 'UNPAID')),
  created_by_device_id uuid,
  updated_by_device_id uuid,
  version              integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  change_seq           bigint NOT NULL DEFAULT nextval('change_seq'),
  FOREIGN KEY (account_id, custom_category_id) REFERENCES expense_categories (account_id, id),
  CONSTRAINT expense_one_category CHECK ((category_key IS NULL) <> (custom_category_id IS NULL))
);
CREATE INDEX expenses_by_day ON expenses (account_id, spent_on DESC, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX expenses_changes ON expenses (account_id, change_seq);

-- Category of an outgoing EVC Plus payment. Kept apart from messages so the SMS record and its audit trail are
-- untouched; removing the row makes the payment "uncategorised" again.
CREATE TABLE transaction_categories (
  message_id           uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  account_id           uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_key         text CHECK (category_key IS NULL OR is_builtin_category(category_key)),
  custom_category_id   uuid,
  updated_by_device_id uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  change_seq           bigint NOT NULL DEFAULT nextval('change_seq'),
  FOREIGN KEY (account_id, custom_category_id) REFERENCES expense_categories (account_id, id),
  CONSTRAINT transaction_one_category CHECK ((category_key IS NULL) <> (custom_category_id IS NULL))
);
CREATE INDEX transaction_categories_changes ON transaction_categories (account_id, change_seq);

-- Spending limits per day, week or month; overall (no category) or for one category; per currency.
CREATE TABLE budgets (
  id                 uuid PRIMARY KEY,
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period             text NOT NULL CHECK (period IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  category_key       text CHECK (category_key IS NULL OR is_builtin_category(category_key)),
  custom_category_id uuid,
  amount_milli       bigint NOT NULL CHECK (amount_milli > 0 AND amount_milli <= 999999999999),
  currency           text NOT NULL CHECK (currency IN ('USD', 'SOS')),
  alert_percent      integer NOT NULL DEFAULT 80 CHECK (alert_percent BETWEEN 1 AND 100),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  change_seq         bigint NOT NULL DEFAULT nextval('change_seq'),
  FOREIGN KEY (account_id, custom_category_id) REFERENCES expense_categories (account_id, id),
  CONSTRAINT budget_category_not_both CHECK (category_key IS NULL OR custom_category_id IS NULL)
);
CREATE UNIQUE INDEX budgets_one_per_scope ON budgets (account_id, period, currency, coalesce(category_key, ''),
  coalesce(custom_category_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX budgets_changes ON budgets (account_id, change_seq);

CREATE TABLE savings_goals (
  id           uuid PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  target_milli bigint NOT NULL CHECK (target_milli > 0 AND target_milli <= 999999999999),
  saved_milli  bigint NOT NULL DEFAULT 0 CHECK (saved_milli >= 0 AND saved_milli <= 999999999999),
  currency     text NOT NULL CHECK (currency IN ('USD', 'SOS')),
  target_date  date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  change_seq   bigint NOT NULL DEFAULT nextval('change_seq')
);
CREATE INDEX savings_goals_changes ON savings_goals (account_id, change_seq);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;     ALTER TABLE expense_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;               ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
ALTER TABLE transaction_categories ENABLE ROW LEVEL SECURITY; ALTER TABLE transaction_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;                ALTER TABLE budgets FORCE ROW LEVEL SECURITY;
ALTER TABLE savings_goals ENABLE ROW LEVEL SECURITY;          ALTER TABLE savings_goals FORCE ROW LEVEL SECURITY;

CREATE POLICY expense_categories_owner ON expense_categories USING (account_id = app_account()) WITH CHECK (account_id = app_account());
CREATE POLICY expenses_owner ON expenses USING (account_id = app_account()) WITH CHECK (account_id = app_account());
CREATE POLICY transaction_categories_owner ON transaction_categories USING (account_id = app_account()) WITH CHECK (account_id = app_account());
CREATE POLICY budgets_owner ON budgets USING (account_id = app_account()) WITH CHECK (account_id = app_account());
CREATE POLICY savings_goals_owner ON savings_goals USING (account_id = app_account()) WITH CHECK (account_id = app_account());
