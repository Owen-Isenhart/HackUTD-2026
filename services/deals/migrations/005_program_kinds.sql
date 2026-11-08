-- One brand may now have a store loyalty program AND a card-linked offer program.
ALTER TABLE deals.program DROP CONSTRAINT IF EXISTS program_merchant_id_key;
ALTER TABLE deals.program
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'store_loyalty'
    CHECK (kind IN ('store_loyalty','card_linked_offer')),
  ADD COLUMN IF NOT EXISTS provenance text NOT NULL DEFAULT 'public_terms'
    CHECK (provenance IN ('public_terms','synthetic_fixture')),
  ADD COLUMN IF NOT EXISTS assisted_supported boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_membership boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS earn_terms jsonb;   -- points per dollar and cash value, each with url, quote and date
CREATE UNIQUE INDEX IF NOT EXISTS program_one_per_kind ON deals.program (merchant_id, kind);

-- The Capital One rows are card-linked sample offers, not store memberships.
UPDATE deals.program SET kind = 'card_linked_offer', provenance = 'synthetic_fixture'
  WHERE id LIKE 'capital_one_%';

-- Give Chipotle and Panera their own card-linked programs, so their sample offers
-- stop hanging off the loyalty programs.
INSERT INTO deals.program (id, merchant_id, name, adapter_version, signup_url, preferences_url,
  sender_domains, capabilities, policy_evidence, kind, provenance)
VALUES
  ('capital_one_chipotle', 'chipotle', 'Chipotle (Capital One sample offer)', 'capital-one-v1',
   'https://www.capitalone.com/offers', 'https://www.capitalone.com/offers', '{capitalone.com}',
   '{"loyalty":false,"promotions":true,"mode":"none"}', '{"source":"synthetic_fixture"}',
   'card_linked_offer', 'synthetic_fixture'),
  ('capital_one_panera', 'panera', 'Panera (Capital One sample offer)', 'capital-one-v1',
   'https://www.capitalone.com/offers', 'https://www.capitalone.com/offers', '{capitalone.com}',
   '{"loyalty":false,"promotions":true,"mode":"none"}', '{"source":"synthetic_fixture"}',
   'card_linked_offer', 'synthetic_fixture')
ON CONFLICT (id) DO NOTHING;
UPDATE deals.offer SET program_id = 'capital_one_chipotle' WHERE campaign_key = 'c1-chipotle-3off15-2026';
UPDATE deals.offer SET program_id = 'capital_one_panera'   WHERE campaign_key = 'c1-panera-20pct-2026';

-- Whether the owner is a synthetic sandbox person (step 12.4 reads this).
ALTER TABLE deals.owner ADD COLUMN IF NOT EXISTS synthetic_person boolean NOT NULL DEFAULT false;

-- Enrollment can now be started by store selection, and can be a labeled simulation.
ALTER TABLE deals.enrollment DROP CONSTRAINT IF EXISTS enrollment_initiation_check;
ALTER TABLE deals.enrollment ADD CONSTRAINT enrollment_initiation_check
  CHECK (initiation IN ('purchase','owner_request','store_selection'));
ALTER TABLE deals.enrollment ADD COLUMN IF NOT EXISTS simulated boolean NOT NULL DEFAULT false;
ALTER TABLE deals.enrollment DROP CONSTRAINT IF EXISTS enrollment_loyalty_status_check;
ALTER TABLE deals.enrollment ADD CONSTRAINT enrollment_loyalty_status_check
  CHECK (loyalty_status IN ('unknown','existing','enrolled','unsupported','simulated'));
ALTER TABLE deals.enrollment ADD CONSTRAINT enrollment_simulated_is_labeled
  CHECK (NOT simulated OR (loyalty_status IN ('simulated','unknown') AND coalesce(evidence->>'kind','') = 'simulated_demo_signup'));

-- Repair the loyalty rows the Capital One seed overwrote (problem 2 in section 2).
UPDATE deals.enrollment
SET state = 'needs_user_input', signup_status = 'awaiting_user', loyalty_status = 'unknown',
    promotion_status = 'unknown', reason = 'complete_merchant_signup_with_alias',
    evidence = '{}'::jsonb, version = version + 1, updated_at = now()
WHERE program_id IN ('mypanera','chipotle_rewards')
  AND evidence->>'kind' = 'capital_one_cardholder_automatic_enrollment';

ALTER TABLE deals.owner ADD COLUMN IF NOT EXISTS first_name text;
UPDATE deals.program SET assisted_supported=true WHERE id IN ('chipotle_rewards','mypanera');

-- Existing generated fixture messages must not retain the old verification claim.
UPDATE deals.message SET sender='synthetic-fixture@invalid',classification='synthetic_fixture',trust=jsonb_build_object('origin','synthetic_fixture','verified',false) WHERE project_id='capital_one' AND provider_id='c1_feed_aggregator';
