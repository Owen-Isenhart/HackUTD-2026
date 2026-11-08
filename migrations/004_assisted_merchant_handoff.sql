-- Assisted Merchant Handoff Migration
-- Restores Chipotle and Panera to assisted mode requiring real merchant verification and SMS OTP,
-- while maintaining Capital One partner programs in automatic cardholder mode.

UPDATE deals.program SET
  capabilities = jsonb_build_object(
    'loyalty', true,
    'promotions', true,
    'mode', 'assisted',
    'submission', 'assisted',
    'requires', jsonb_build_array('existing_membership_check', 'name', 'email', 'phone', 'otp')
  ),
  signup_url = 'https://www.panerabread.com/en-us/mypanera/meet-mypanera.html',
  preferences_url = 'https://www.panerabread.com/en-us/mypanera/meet-mypanera.html'
WHERE id = 'mypanera';

UPDATE deals.program SET
  capabilities = jsonb_build_object(
    'loyalty', true,
    'promotions', true,
    'mode', 'assisted',
    'submission', 'assisted',
    'requires', jsonb_build_array('existing_membership_check', 'name', 'email', 'phone', 'user_verification')
  ),
  signup_url = 'https://www.chipotle.com/order/create-account',
  preferences_url = 'https://www.chipotle.com/order/account'
WHERE id = 'chipotle_rewards';

-- Reset any synthetic enrollments for assisted programs that were auto-enrolled without real evidence
UPDATE deals.enrollment
SET
  state = 'needs_user_input',
  signup_status = 'awaiting_user',
  loyalty_status = 'unknown',
  promotion_status = 'unknown',
  reason = 'complete_merchant_signup_with_alias',
  evidence = '{}'::jsonb,
  updated_at = now()
WHERE program_id IN ('mypanera', 'chipotle_rewards')
  AND evidence->>'kind' IN ('automated_merchant_registration', 'automated_preference_sync');
