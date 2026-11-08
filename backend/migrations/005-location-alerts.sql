CREATE TABLE IF NOT EXISTS hackutd_finance.alert_settings (
  owner_id text PRIMARY KEY REFERENCES hackutd_finance.profile (owner_id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('off', 'call', 'imessage')),
  version integer NOT NULL CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS hackutd_finance.location_device (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES hackutd_finance.profile (owner_id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);

ALTER TABLE hackutd_finance.recommendation_call
  ADD COLUMN IF NOT EXISTS automatic boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS settings_version integer,
  ADD COLUMN IF NOT EXISTS device_id uuid,
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'call' CHECK (channel IN ('call', 'imessage')),
  ADD COLUMN IF NOT EXISTS provider_id text;
