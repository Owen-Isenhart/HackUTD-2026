-- Durable phone -> verified user link, so a returning caller is not onboarded again. Safe to run again.
-- Registrations expire after 24 hours; this table is the only lasting phone record and is never pruned.
CREATE TABLE IF NOT EXISTS hackutd_finance.onboarding_phone_link (
  phone_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES hackutd_finance.onboarding_user_link (user_id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_phone_link_user ON hackutd_finance.onboarding_phone_link (user_id);

ALTER TABLE hackutd_finance.onboarding_session
  ADD COLUMN IF NOT EXISTS profile text NOT NULL DEFAULT 'onboarding';
ALTER TABLE hackutd_finance.onboarding_session DROP CONSTRAINT IF EXISTS onboarding_session_profile_check;
ALTER TABLE hackutd_finance.onboarding_session
  ADD CONSTRAINT onboarding_session_profile_check CHECK (profile IN ('onboarding', 'phone_details'));

-- One-time backfill: verified users whose registration has not been pruned yet.
INSERT INTO hackutd_finance.onboarding_phone_link (phone_hash, user_id)
  SELECT registration.phone_hash, registration.user_id
  FROM hackutd_finance.onboarding_registration AS registration
  JOIN hackutd_finance.onboarding_user_link AS link USING (user_id)
ON CONFLICT DO NOTHING;
