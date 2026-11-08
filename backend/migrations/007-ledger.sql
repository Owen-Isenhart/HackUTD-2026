CREATE TABLE IF NOT EXISTS hackutd_finance.brand (
  key text PRIMARY KEY,                    -- 'chipotle', 'taco_bell', … same keys as deals.program.merchant_id
  display_name text NOT NULL,
  category text NOT NULL                   -- dining, coffee, groceries, fuel, retail, travel, electronics, other
);

CREATE TABLE IF NOT EXISTS hackutd_finance.brand_alias (
  normalized_name text PRIMARY KEY,        -- output of normalizeMerchantName (step 6.4)
  brand_key text NOT NULL REFERENCES hackutd_finance.brand (key)
);

CREATE TABLE IF NOT EXISTS hackutd_finance.merchant (
  id text PRIMARY KEY,                     -- Nessie merchant ID (merch_…), or osm:<id> for OpenStreetMap branches
  name text NOT NULL,
  category text,
  lat double precision,
  lon double precision,
  brand_key text REFERENCES hackutd_finance.brand (key),
  brand_match text NOT NULL CHECK (brand_match IN ('alias','manual','unresolved')),
  provenance text NOT NULL CHECK (provenance IN ('nessie_sandbox','openstreetmap')),
  fetched_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS hackutd_finance.ledger_transaction (
  owner_id uuid NOT NULL REFERENCES hackutd_finance.owner (id) ON DELETE CASCADE,
  id text NOT NULL,                        -- Nessie txn_… ID, or persona_… ID
  provenance text NOT NULL CHECK (provenance IN ('nessie_sandbox','synthetic_persona')),
  account_id text,                         -- null for persona rows
  kind text NOT NULL,                      -- purchase, deposit, withdrawal, transfer, bill_payment, fee, interest_credit, refund, chargeback
  status text NOT NULL CHECK (status IN ('pending','completed','declined','cancelled')),
  direction text NOT NULL CHECK (direction IN ('outflow','inflow','internal')),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  occurred_at timestamptz NOT NULL,
  merchant_id text,
  brand_key text,
  category text,
  descriptor text,                         -- statement text; kept for display, never used for matching
  parent_id text,                          -- the purchase a refund or chargeback answers
  reversed_cents bigint NOT NULL DEFAULT 0 CHECK (reversed_cents >= 0),
  screen_flags text[] NOT NULL DEFAULT '{}',
  content_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX IF NOT EXISTS ledger_owner_time ON hackutd_finance.ledger_transaction (owner_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ledger_owner_brand ON hackutd_finance.ledger_transaction (owner_id, brand_key, occurred_at DESC);

CREATE TABLE IF NOT EXISTS hackutd_finance.provider_cursor (
  owner_id uuid NOT NULL REFERENCES hackutd_finance.owner (id) ON DELETE CASCADE,
  source text NOT NULL,                    -- 'nessie_events:<account_id>'
  cursor jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, source)
);

-- Preserve provider bill identity for mutually unique payment reconciliation.
ALTER TABLE hackutd_finance.ledger_transaction ADD COLUMN IF NOT EXISTS bill_id text;
