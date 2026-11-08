CREATE SCHEMA IF NOT EXISTS hackutd_finance;

CREATE TABLE IF NOT EXISTS hackutd_finance.profile (
  owner_id text PRIMARY KEY,
  as_of timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object')
);

CREATE TABLE IF NOT EXISTS hackutd_finance.confirmed_memory (
  owner_id text PRIMARY KEY,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  budget jsonb CHECK (budget IS NULL OR jsonb_typeof(budget) = 'object'),
  goals jsonb NOT NULL CHECK (jsonb_typeof(goals) = 'array')
);
