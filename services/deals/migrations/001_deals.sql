CREATE SCHEMA IF NOT EXISTS deals;
REVOKE ALL ON SCHEMA deals FROM PUBLIC;

CREATE TABLE deals.owner (
  id uuid PRIMARY KEY,
  timezone text NOT NULL,
  consent_version text,
  consent_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE deals.identity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES deals.owner(id),
  address text NOT NULL UNIQUE CHECK(address = lower(address)),
  project_id text NOT NULL,
  recipient_id text,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id), UNIQUE(owner_id, id)
);
CREATE TABLE deals.source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES deals.owner(id),
  product text NOT NULL CHECK(product IN ('photon_email','capital_one_offers','capital_one_shopping')),
  status text NOT NULL DEFAULT 'not_connected' CHECK(status IN ('not_connected','ready','syncing','degraded','blocked','revoked')),
  reason text,
  cursor jsonb NOT NULL DEFAULT '{}',
  last_success_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,product)
);
CREATE TABLE deals.program (
  id text PRIMARY KEY,
  merchant_id text NOT NULL UNIQUE,
  name text NOT NULL,
  adapter_version text NOT NULL,
  signup_url text NOT NULL,
  preferences_url text NOT NULL,
  sender_domains text[] NOT NULL DEFAULT '{}',
  capabilities jsonb NOT NULL,
  policy_evidence jsonb NOT NULL
);
CREATE TABLE deals.enrollment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES deals.owner(id),
  program_id text NOT NULL REFERENCES deals.program(id),
  state text NOT NULL DEFAULT 'discovered' CHECK(state IN ('discovered','queued','in_progress','needs_user_input','enrolled','unsupported','retryable_failure','inactive','unsubscribe_pending','unsubscribed')),
  loyalty_status text NOT NULL DEFAULT 'unknown' CHECK(loyalty_status IN ('unknown','existing','enrolled','unsupported')),
  promotion_status text NOT NULL DEFAULT 'unknown' CHECK(promotion_status IN ('unknown','subscribed','unsubscribe_pending','unsubscribed')),
  activation_at timestamptz NOT NULL DEFAULT now(),
  last_purchase_at timestamptz,
  inactivity_at timestamptz NOT NULL,
  suppressed_at timestamptz,
  opted_out_at timestamptz,
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,program_id), UNIQUE(owner_id,id)
);
CREATE INDEX enrollment_due ON deals.enrollment(inactivity_at) WHERE suppressed_at IS NULL;
CREATE TABLE deals.purchase_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES deals.owner(id),
  transaction_id text NOT NULL,
  merchant_id text NOT NULL,
  branch_id text,
  occurred_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK(status IN ('posted','pending','refunded','cancelled')),
  provenance text NOT NULL CHECK(provenance IN ('nessie_sandbox','verified_import','synthetic_test')),
  source_version integer NOT NULL DEFAULT 1 CHECK(source_version>0),
  UNIQUE(owner_id,transaction_id)
);
CREATE TABLE deals.message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES deals.owner(id),
  project_id text NOT NULL,
  provider_id text NOT NULL,
  sender text NOT NULL,
  received_at timestamptz NOT NULL,
  subject text NOT NULL DEFAULT '',
  sanitized_text text,
  content_hash text NOT NULL,
  classification text NOT NULL DEFAULT 'pending',
  trust jsonb NOT NULL DEFAULT '{}',
  purge_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,project_id,provider_id), UNIQUE(owner_id,id)
);
CREATE TABLE deals.delivery (
  owner_id uuid NOT NULL REFERENCES deals.owner(id),
  project_id text NOT NULL,
  event_id text NOT NULL,
  message_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,project_id,event_id),
  FOREIGN KEY(owner_id,message_id) REFERENCES deals.message(owner_id,id)
);
CREATE TABLE deals.offer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES deals.owner(id),
  program_id text NOT NULL REFERENCES deals.program(id),
  message_id uuid NOT NULL,
  fingerprint text NOT NULL,
  campaign_key text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  status text NOT NULL CHECK(status IN ('pending_extraction','needs_review','active','stale','expired','withdrawn','rejected')),
  terms jsonb NOT NULL,
  reasons text[] NOT NULL DEFAULT '{}',
  valid_from timestamptz,
  expires_at timestamptz,
  stale_at timestamptz NOT NULL,
  evidence_purge_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,program_id,fingerprint), UNIQUE(owner_id,program_id,campaign_key), UNIQUE(owner_id,id),
  CHECK(expires_at IS NULL OR valid_from IS NULL OR expires_at>valid_from),
  FOREIGN KEY(owner_id,message_id) REFERENCES deals.message(owner_id,id)
);
CREATE INDEX offer_candidates ON deals.offer(owner_id,program_id,status,expires_at);
CREATE TABLE deals.offer_revision (
  owner_id uuid NOT NULL,
  offer_id uuid NOT NULL,
  revision integer NOT NULL,
  message_id uuid NOT NULL,
  terms jsonb NOT NULL,
  status text NOT NULL,
  reasons text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,offer_id,revision),
  FOREIGN KEY(owner_id,offer_id) REFERENCES deals.offer(owner_id,id),
  FOREIGN KEY(owner_id,message_id) REFERENCES deals.message(owner_id,id)
);
CREATE TABLE deals.eligibility (
  owner_id uuid NOT NULL,
  offer_id uuid NOT NULL,
  revision integer NOT NULL,
  context_hash text NOT NULL,
  result text NOT NULL CHECK(result IN ('eligible','ineligible','unknown')),
  reasons text[] NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,offer_id,revision,context_hash),
  FOREIGN KEY(owner_id,offer_id) REFERENCES deals.offer(owner_id,id)
);
CREATE TABLE deals.job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES deals.owner(id),
  kind text NOT NULL CHECK(kind IN ('extract','enroll','unsubscribe','reconcile','maintenance','delete_content')),
  operation_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','completed','dead','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,kind,operation_key)
);
CREATE INDEX job_ready ON deals.job(available_at) WHERE state IN ('queued','running');
CREATE TABLE deals.event (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES deals.owner(id),
  type text NOT NULL,
  entity_id text NOT NULL,
  revision integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,type,entity_id,revision,reason)
);

-- Only the schema owner/migration process bypasses RLS. Application roles never own tables.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['owner','identity','source','enrollment','purchase_observation','message','delivery','offer','offer_revision','eligibility','job','event'] LOOP
    EXECUTE format('ALTER TABLE deals.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant ON deals.%I USING (%I = nullif(current_setting(''deals.owner_id'',true),'''')::uuid) WITH CHECK (%I = nullif(current_setting(''deals.owner_id'',true),'''')::uuid)',t,CASE WHEN t='owner' THEN 'id' ELSE 'owner_id' END,CASE WHEN t='owner' THEN 'id' ELSE 'owner_id' END);
  END LOOP;
END $$;

-- Narrow scheduling/recipient lookup functions; privileges granted only by provision.ts.
CREATE FUNCTION deals.route_identity(p_project text,p_address text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,deals AS $$
 SELECT i.owner_id FROM deals.identity i JOIN deals.owner o ON o.id=i.owner_id
 WHERE i.project_id=p_project AND i.address=p_address AND i.disabled_at IS NULL
 AND o.consent_at IS NOT NULL AND o.revoked_at IS NULL
$$;
CREATE FUNCTION deals.active_owners() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,deals AS $$
 SELECT id FROM deals.owner WHERE consent_at IS NOT NULL AND revoked_at IS NULL
$$;
CREATE FUNCTION deals.claim_job(p_token uuid) RETURNS SETOF deals.job
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,deals AS $$
 WITH candidate AS (
 SELECT j.id FROM deals.job j JOIN deals.owner o ON o.id=j.owner_id
 WHERE (o.revoked_at IS NULL OR j.kind IN ('unsubscribe','delete_content'))
 AND (j.state='queued' OR (j.state='running' AND j.lease_until<now()))
 AND j.attempts<j.max_attempts AND j.available_at<=now()
 ORDER BY j.available_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1
 ) UPDATE deals.job j SET state='running',attempts=j.attempts+1,lease_token=p_token,
 lease_until=now()+interval '90 seconds',updated_at=now() FROM candidate c WHERE j.id=c.id RETURNING j.*
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA deals FROM PUBLIC;

INSERT INTO deals.program(id,merchant_id,name,adapter_version,signup_url,preferences_url,sender_domains,capabilities,policy_evidence) VALUES
('chipotle_rewards','chipotle','Chipotle Rewards','assisted-v1','https://www.chipotle.com/order/create-account','https://www.chipotle.com/order/account','{chipotle.com}',
 '{"loyalty":true,"promotions":true,"mode":"assisted","requires":["existing_membership_check","name","email","phone","user_verification"]}',
 '{"url":"https://www.chipotle.com/rewards-terms","verifiedOn":"2026-11-07","automaticSubmission":"unverified","outcome":"needs_user_input"}'),
('mypanera','panera','MyPanera','assisted-v1','https://www.panerabread.com/en-us/mypanera/join-mypanera.html','https://www.panerabread.com/en-us/mypanera/my-account.html','{panerabread.com}',
 '{"loyalty":true,"promotions":true,"mode":"assisted","requires":["existing_membership_check","name","email","phone","otp"]}',
 '{"url":"https://www.panerabread.com/en-us/legal/terms-of-use.html","verifiedOn":"2026-11-07","automaticSubmission":"unverified","outcome":"needs_user_input"}');
