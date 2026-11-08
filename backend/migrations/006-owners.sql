CREATE TABLE IF NOT EXISTS hackutd_finance.owner (
  id uuid PRIMARY KEY,
  nessie_customer_id text NOT NULL UNIQUE,
  card_account_id text NOT NULL,
  first_name text NOT NULL,                -- for greetings only; no last name stored
  time_zone text NOT NULL,
  persona_enabled boolean NOT NULL DEFAULT false,
  is_synthetic_person boolean NOT NULL,    -- true for sandbox customers such as Alex Taylor
  onboarding_step text NOT NULL DEFAULT 'identified'
    CHECK (onboarding_step IN ('identified','importing','questions','stores','signups','done')),
  onboarding_version integer NOT NULL DEFAULT 1 CHECK (onboarding_version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hackutd_finance.owner_account (
  owner_id uuid NOT NULL REFERENCES hackutd_finance.owner (id) ON DELETE CASCADE,
  account_id text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('Checking','Savings','Credit Card')),
  last4 text NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),  -- the full account number is never stored
  nickname text,
  PRIMARY KEY (owner_id, account_id)
);

CREATE TABLE IF NOT EXISTS hackutd_finance.owner_session (
  token_hash text PRIMARY KEY,             -- SHA-256 of a 32-byte random token
  owner_id uuid NOT NULL REFERENCES hackutd_finance.owner (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
