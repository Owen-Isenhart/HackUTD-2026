ALTER TABLE deals.enrollment
  ADD COLUMN initiation text NOT NULL DEFAULT 'purchase' CHECK(initiation IN ('purchase','owner_request')),
  ADD COLUMN enrollment_intent text NOT NULL DEFAULT 'loyalty_and_promotions' CHECK(enrollment_intent IN ('loyalty_and_promotions','promotions_only')),
  ADD COLUMN existing_membership text NOT NULL DEFAULT 'unknown' CHECK(existing_membership IN ('unknown','yes','no')),
  ADD COLUMN signup_status text NOT NULL DEFAULT 'not_started' CHECK(signup_status IN ('not_started','awaiting_user','verification_pending','outcome_unknown','confirmed')),
  ADD COLUMN verification_started_at timestamptz,
  ADD COLUMN submitted_at timestamptz;

UPDATE deals.enrollment SET signup_status='confirmed' WHERE state='enrolled';

-- Use observed official entry pages. Account-specific preferences remain an authenticated user step.
UPDATE deals.program SET
  signup_url='https://www.panerabread.com/en-us/mypanera/meet-mypanera.html',
  preferences_url='https://www.panerabread.com/en-us/mypanera/meet-mypanera.html'
WHERE id='mypanera';
