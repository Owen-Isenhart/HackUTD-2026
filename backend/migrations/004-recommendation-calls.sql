CREATE TABLE IF NOT EXISTS hackutd_finance.recommendation_call (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES hackutd_finance.profile (owner_id) ON DELETE CASCADE,
  inputs jsonb NOT NULL,
  opening_id text NOT NULL,
  candidates jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('live', 'demo')),
  dispatch_before timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  decision text CHECK (decision IN ('accepted', 'declined')),
  state text NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'dialing', 'dial_requested', 'message_accepted', 'uncertain', 'failed', 'busy', 'no_answer', 'declined', 'ended'))
);

CREATE INDEX IF NOT EXISTS recommendation_call_owner_started_idx
  ON hackutd_finance.recommendation_call (owner_id, started_at DESC) WHERE started_at IS NOT NULL;
