-- Demo location for the UT Dallas demo (Alex Taylor only).
-- demo_deal: deals the team wrote for stores near UTD that had no deal of a kind.
--   Every row is synthetic and is labeled that way wherever it is shown or spoken.
-- demo_position: the position the user last dragged to, and which store rings it was inside,
--   so a call is placed only when a ring is newly entered.
CREATE TABLE IF NOT EXISTS hackutd_finance.demo_deal (
  id text PRIMARY KEY,
  brand_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('capital_one', 'store_email')),
  title text NOT NULL,
  benefit jsonb NOT NULL,
  min_spend_cents integer,
  channels text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  provenance text NOT NULL DEFAULT 'synthetic_fixture' CHECK (provenance = 'synthetic_fixture')
);

CREATE TABLE IF NOT EXISTS hackutd_finance.demo_position (
  owner_id uuid PRIMARY KEY,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  inside text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per demo-location call: the deal context the call may talk about, and how it went.
CREATE TABLE IF NOT EXISTS hackutd_finance.demo_call (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  context jsonb NOT NULL,
  state text NOT NULL DEFAULT 'ready',
  decision text,
  started_at timestamptz,
  ended_at timestamptz,
  answer_until timestamptz NOT NULL
);
