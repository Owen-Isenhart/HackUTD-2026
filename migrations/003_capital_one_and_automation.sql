-- Capital One Programs and Automation Migration
-- Adds Capital One merchant programs and updates existing programs with automated capabilities.

INSERT INTO deals.program(id, merchant_id, name, adapter_version, signup_url, preferences_url, sender_domains, capabilities, policy_evidence) VALUES
('capital_one_nike', 'nike', 'Nike', 'capital-one-v1', 'https://www.capitalone.com/offers', 'https://www.capitalone.com/offers', '{capitalone.com,nike.com}',
 '{"loyalty":false,"promotions":true,"mode":"automatic","cashback":true}',
 '{"source":"capital_one_offers","statementCredit":true,"terms":"Earn 5% cash back as statement credit on eligible Nike purchases."}'),
('capital_one_walmart', 'walmart', 'Walmart', 'capital-one-v1', 'https://www.capitalone.com/offers', 'https://www.capitalone.com/offers', '{capitalone.com,walmart.com}',
 '{"loyalty":false,"promotions":true,"mode":"automatic","cashback":true}',
 '{"source":"capital_one_offers","statementCredit":true,"terms":"Earn 2% cash back as statement credit on eligible Walmart orders over $35."}'),
('capital_one_macys', 'macys', 'Macy''s', 'capital-one-v1', 'https://www.capitalone.com/offers', 'https://www.capitalone.com/offers', '{capitalone.com,macys.com}',
 '{"loyalty":false,"promotions":true,"mode":"automatic","cashback":true}',
 '{"source":"capital_one_offers","statementCredit":true,"terms":"Earn 6% cash back on eligible Macy''s purchases online and in-store."}'),
('capital_one_sephora', 'sephora', 'Sephora', 'capital-one-v1', 'https://www.capitalone.com/offers', 'https://www.capitalone.com/offers', '{capitalone.com,sephora.com}',
 '{"loyalty":false,"promotions":true,"mode":"automatic","cashback":true}',
 '{"source":"capital_one_offers","statementCredit":true,"terms":"Earn 4% statement credit on Sephora purchases of $25 or more."}'),
('capital_one_bestbuy', 'bestbuy', 'Best Buy', 'capital-one-v1', 'https://www.capitalone.com/offers', 'https://www.capitalone.com/offers', '{capitalone.com,bestbuy.com}',
 '{"loyalty":false,"promotions":true,"mode":"automatic","cashback":true}',
 '{"source":"capital_one_offers","statementCredit":true,"terms":"Earn 3% cash back on Best Buy purchases over $50."}'),
('capital_one_target', 'target', 'Target', 'capital-one-v1', 'https://www.capitalone.com/offers', 'https://www.capitalone.com/offers', '{capitalone.com,target.com}',
 '{"loyalty":false,"promotions":true,"mode":"automatic","cashback":true}',
 '{"source":"capital_one_offers","statementCredit":true,"terms":"Earn 2% cash back statement credit on Target online and Order Pickup orders."}'),
('capital_one_homedepot', 'homedepot', 'The Home Depot', 'capital-one-v1', 'https://www.capitalone.com/offers', 'https://www.capitalone.com/offers', '{capitalone.com,homedepot.com}',
 '{"loyalty":false,"promotions":true,"mode":"automatic","cashback":true}',
 '{"source":"capital_one_offers","statementCredit":true,"terms":"Earn 4% cash back on Home Depot online orders of $100 or more."}'),
('capital_one_uber_eats', 'uber_eats', 'Uber Eats', 'capital-one-v1', 'https://www.capitalone.com/offers', 'https://www.capitalone.com/offers', '{capitalone.com,ubereats.com}',
 '{"loyalty":false,"promotions":true,"mode":"automatic","cashback":true}',
 '{"source":"capital_one_offers","statementCredit":true,"terms":"Earn 5% cash back statement credit on Uber Eats orders over $15."}'),
('capital_one_booking', 'booking_com', 'Booking.com', 'capital-one-v1', 'https://www.capitalone.com/offers', 'https://www.capitalone.com/offers', '{capitalone.com,booking.com}',
 '{"loyalty":false,"promotions":true,"mode":"automatic","cashback":true}',
 '{"source":"capital_one_offers","statementCredit":true,"terms":"Earn 6% cash back on prepaid accommodations at Booking.com."}'),
('capital_one_lululemon', 'lululemon', 'Lululemon', 'capital-one-v1', 'https://www.capitalone.com/offers', 'https://www.capitalone.com/offers', '{capitalone.com,lululemon.com}',
 '{"loyalty":false,"promotions":true,"mode":"automatic","cashback":true}',
 '{"source":"capital_one_offers","statementCredit":true,"terms":"Earn 4% statement credit on Lululemon purchases of $50 or more."}')
ON CONFLICT (id) DO UPDATE SET
  capabilities = EXCLUDED.capabilities,
  policy_evidence = EXCLUDED.policy_evidence;

-- Update existing programs to indicate automated registration support
UPDATE deals.program SET
  capabilities = capabilities || '{"mode":"automatic","submission":"automated"}'::jsonb
WHERE id IN ('chipotle_rewards', 'mypanera');
