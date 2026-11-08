CREATE TABLE IF NOT EXISTS hackutd_finance.onboarding_attempt (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL,
  phone_hash text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_attempt_user ON hackutd_finance.onboarding_attempt (user_id, attempted_at);
CREATE INDEX IF NOT EXISTS onboarding_attempt_phone ON hackutd_finance.onboarding_attempt (phone_hash, attempted_at);
CREATE TABLE IF NOT EXISTS hackutd_finance.onboarding_session (
  session_id text PRIMARY KEY,
  user_id text NOT NULL,
  phone_hash text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  failures integer NOT NULL DEFAULT 0,
  verified boolean NOT NULL DEFAULT false,
  customer_id text
);
CREATE TABLE IF NOT EXISTS hackutd_finance.onboarding_user_link (
  user_id text PRIMARY KEY,
  customer_id text NOT NULL,
  account_id text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hackutd_finance.onboarding_registration (
  user_id text PRIMARY KEY,
  phone_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
