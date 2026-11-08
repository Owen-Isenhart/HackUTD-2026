-- Photon text ingestion and text-derived obligations. Safe to run again.
CREATE SCHEMA IF NOT EXISTS hackutd_finance;

-- Photon user IDs observed sending from the consenting user's own handle.
CREATE TABLE IF NOT EXISTS hackutd_finance.text_owner_user (
  owner_id text NOT NULL,
  photon_user_id text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, photon_user_id)
);

-- One row per provider message; this row is also the single interpretation job.
-- Friends' handles are not stored. Message bodies are purged after purge_at.
CREATE TABLE IF NOT EXISTS hackutd_finance.text_message (
  owner_id text NOT NULL,
  project_id text NOT NULL,
  provider_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('sms', 'imessage')),
  space_id text NOT NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('owner', 'participant')),
  received_at timestamptz NOT NULL,
  body text,
  purge_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('no_signal', 'no_text', 'queued', 'interpreting', 'interpreted', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_until timestamptz,
  last_error text,
  result_kind text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, project_id, provider_id)
);
CREATE INDEX IF NOT EXISTS text_message_space_idx ON hackutd_finance.text_message (owner_id, space_id, received_at);
CREATE INDEX IF NOT EXISTS text_message_status_idx ON hackutd_finance.text_message (owner_id, status);

-- Webhook and reconciliation deliveries, for replay evidence.
CREATE TABLE IF NOT EXISTS hackutd_finance.text_delivery (
  owner_id text NOT NULL,
  delivery_id text NOT NULL,
  provider_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, delivery_id)
);

CREATE TABLE IF NOT EXISTS hackutd_finance.text_obligation (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  space_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('included', 'needs_clarification', 'expected_inflow', 'cancelled', 'dismissed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  record jsonb NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS text_obligation_owner_idx ON hackutd_finance.text_obligation (owner_id, space_id, status);

CREATE TABLE IF NOT EXISTS hackutd_finance.text_sync (
  owner_id text PRIMARY KEY,
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
