CREATE TABLE IF NOT EXISTS hackutd_finance.pipeline_job (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES hackutd_finance.owner (id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('bank_pull','persona_load','forecast','routines','budget','store_selection','enrollment_sync')),
  input_hash text,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','completed','skipped','failed','dead')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,                         -- a short code, never message text or money
  output_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, run_id, kind)
);
CREATE INDEX IF NOT EXISTS pipeline_job_ready ON hackutd_finance.pipeline_job (available_at) WHERE state IN ('queued','running');

CREATE TABLE IF NOT EXISTS hackutd_finance.forecast_snapshot (
  owner_id uuid NOT NULL REFERENCES hackutd_finance.owner (id) ON DELETE CASCADE,
  version integer NOT NULL,
  input_hash text NOT NULL,
  method text NOT NULL,                    -- 'weekly_block_bootstrap_v1'
  as_of timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  horizon_days integer NOT NULL CHECK (horizon_days BETWEEN 1 AND 90),
  summary jsonb NOT NULL,
  daily jsonb NOT NULL,
  PRIMARY KEY (owner_id, version)
);

CREATE TABLE IF NOT EXISTS hackutd_finance.routine_fact (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES hackutd_finance.owner (id) ON DELETE CASCADE,
  version integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('inferred','stated')),
  purpose text NOT NULL CHECK (purpose IN ('purchase','work','commute')),
  brand_key text,                          -- null for work hours
  branch_merchant_id text,
  weekdays smallint[] NOT NULL,            -- 1 = Monday … 7 = Sunday
  window_start_minute integer NOT NULL CHECK (window_start_minute BETWEEN 0 AND 1439),
  window_end_minute integer NOT NULL CHECK (window_end_minute BETWEEN 0 AND 1439),
  typical_low_cents bigint, typical_mid_cents bigint, typical_high_cents bigint,
  confidence numeric(4,3),                 -- share of weeks with a visit; null for stated facts
  support jsonb NOT NULL,                  -- counts, p-value, sources by label
  evidence text NOT NULL,                  -- one sentence a person can check
  provenance text[] NOT NULL,
  superseded_by uuid,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz
);
CREATE INDEX IF NOT EXISTS routine_active ON hackutd_finance.routine_fact (owner_id) WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS hackutd_finance.budget (
  owner_id uuid NOT NULL REFERENCES hackutd_finance.owner (id) ON DELETE CASCADE,
  category text NOT NULL,                  -- a category key, or 'all' for total spending
  version integer NOT NULL CHECK (version > 0),
  period text NOT NULL CHECK (period IN ('week','month')),
  limit_cents bigint NOT NULL CHECK (limit_cents >= 0),
  source text NOT NULL CHECK (source IN ('derived','user')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  evidence jsonb NOT NULL,                 -- formula inputs, so the number can be re-derived by hand
  PRIMARY KEY (owner_id, category, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS budget_active ON hackutd_finance.budget (owner_id, category) WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS hackutd_finance.store_selection (
  owner_id uuid NOT NULL REFERENCES hackutd_finance.owner (id) ON DELETE CASCADE,
  brand_key text NOT NULL,
  version integer NOT NULL,
  selected boolean NOT NULL,
  decided_by text NOT NULL CHECK (decided_by IN ('rule','user')),
  reasons text[] NOT NULL,
  stats jsonb NOT NULL,
  branches jsonb NOT NULL,                 -- frequented branches with coordinates
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, brand_key, version)
);

CREATE TABLE IF NOT EXISTS hackutd_finance.onboarding_answer (
  owner_id uuid NOT NULL REFERENCES hackutd_finance.owner (id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key IN ('work_schedule','regular_stops')),
  version integer NOT NULL CHECK (version > 0),
  value jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('user_typed','model_extracted_user_confirmed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, key, version)
);

ALTER TABLE hackutd_finance.pipeline_job ADD COLUMN IF NOT EXISTS summary text;
