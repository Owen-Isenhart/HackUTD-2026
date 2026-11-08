import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { Webhook } from "standardwebhooks";
import { migrate } from "../../scripts/migrate.js";
import { poolFor, tenant, enqueue } from "../../src/db.js";
import {
  bootstrapOwner,
  consent,
  observePurchase,
  processMessage,
  maintenance,
  suppressEnrollment,
  withdrawConsent,
  reviewOffer,
  resumeEnrollment,
  enrollmentHandoff,
  unsubscribeHandoff,
  confirmEnrollment,
  confirmUnsubscribe,
} from "../../src/service.js";
import {
  requestEnrollment,
  enrollmentFlow,
  setExistingMembership,
  recordEnrollmentAttempt,
} from "../../src/enrollment.js";
import { buildApp } from "../../src/app.js";
import { issueToken } from "../../src/auth.js";
import {
  ingestEmail,
  parseEmailMessage,
  PhotonClient,
  reconcileOwner,
} from "../../src/photon.js";
import { runOne } from "../../src/worker.js";
import { cfg, event, message, terms, webhookSecret } from "../fixtures.js";

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "TEST_DATABASE_URL required: use a disposable local database ending in _test",
  );
const parsed = new URL(url);
if (
  !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
  !parsed.pathname.endsWith("_test")
)
  throw new Error("Refusing non-local/non-test database");
let admin: pg.Pool,
  api: pg.Pool,
  worker: pg.Pool,
  app: Awaited<ReturnType<typeof buildApp>>;
const a = randomUUID(),
  b = randomUUID();
let tokenA: string,
  tokenB: string,
  purchaseToken: string,
  optimizerToken: string,
  addressA: string,
  addressB: string;
const purchase = (
  id: string,
  merchantId = "chipotle",
  extra: Record<string, unknown> = {},
) => ({
  transactionId: id,
  merchantId,
  occurredAt: new Date().toISOString(),
  status: "posted" as const,
  provenance: "verified_import" as const,
  sourceVersion: 1,
  ...extra,
});
before(async () => {
  admin = poolFor(url!);
  await admin.query("DROP SCHEMA IF EXISTS deals CASCADE");
  await migrate(url!);
  for (const role of ["deals_test_api", "deals_test_worker"]) {
    if (
      !(await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]))
        .rowCount
    )
      await admin.query(
        `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
      );
    await admin.query(`GRANT USAGE ON SCHEMA deals TO ${role}`);
    await admin.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA deals TO ${role}`,
    );
    await admin.query(
      `REVOKE ALL ON deals.schema_migration,deals.program FROM ${role}`,
    );
    await admin.query(`GRANT SELECT ON deals.program TO ${role}`);
    await admin.query(
      `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA deals TO ${role}`,
    );
    await admin.query(
      `GRANT EXECUTE ON FUNCTION deals.route_identity(text,text) TO ${role}`,
    );
  }
  await admin.query(
    "GRANT EXECUTE ON FUNCTION deals.claim_job(uuid),deals.active_owners() TO deals_test_worker",
  );
  const apiUrl = new URL(url!);
  apiUrl.username = "deals_test_api";
  api = poolFor(apiUrl.toString());
  const workerUrl = new URL(url!);
  workerUrl.username = "deals_test_worker";
  worker = poolFor(workerUrl.toString());
  for (const id of [a, b]) {
    await bootstrapOwner(api, id, "America/Chicago");
    await tenant(api, id, (tx) =>
      consent(tx, id, cfg, "America/Chicago", "deals-v1"),
    );
  }
  addressA = (
    await tenant(api, a, (tx) =>
      tx.query("SELECT address FROM deals.identity WHERE owner_id=$1", [a]),
    )
  ).rows[0].address;
  addressB = (
    await tenant(api, b, (tx) =>
      tx.query("SELECT address FROM deals.identity WHERE owner_id=$1", [b]),
    )
  ).rows[0].address;
  tokenA = await issueToken(a, cfg);
  tokenB = await issueToken(b, cfg);
  purchaseToken = await issueToken(a, cfg, "deals:purchase");
  optimizerToken = await issueToken(a, cfg, "deals:optimizer");
  app = await buildApp(api, cfg);
});
after(async () => {
  await app?.close();
  await api?.end();
  await worker?.end();
  await admin?.end();
});

test("migrations replay without changes; failed schema transaction rolls back", async () => {
  await migrate(url!);
  const count = await admin.query(
    "SELECT count(*)::int AS n FROM deals.schema_migration",
  );
  assert.equal(count.rows[0].n, 3);
  const tx = await admin.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("CREATE TABLE deals.rollback_probe(id int)");
    await tx.query("ROLLBACK");
  } finally {
    tx.release();
  }
  assert.equal(
    (await admin.query("SELECT to_regclass('deals.rollback_probe') AS t"))
      .rows[0].t,
    null,
  );
});
test("RLS hides all tenant rows without scope and rejects a forged write", async () => {
  assert.equal((await api.query("SELECT * FROM deals.owner")).rowCount, 0);
  await assert.rejects(() =>
    tenant(api, a, (tx) =>
      tx.query(
        "INSERT INTO deals.source(owner_id,product) VALUES($1,'photon_email')",
        [b],
      ),
    ),
  );
  assert.equal(
    (
      await tenant(api, a, (tx) =>
        tx.query("SELECT * FROM deals.owner WHERE id=$1", [b]),
      )
    ).rowCount,
    0,
  );
  await assert.rejects(() => api.query("SELECT deals.active_owners()"));
  await assert.rejects(() =>
    api.query("UPDATE deals.program SET name='tampered'"),
  );
});
test("API requires authentication and purchase integration scope", async () => {
  assert.equal((await app.inject("/v1/deals/status")).statusCode, 401);
  const denied = await app.inject({
    method: "POST",
    url: "/v1/deals/purchases",
    headers: { authorization: `Bearer ${tokenA}` },
    payload: { purchases: [purchase("scope-test")] },
  });
  assert.equal(denied.statusCode, 403);
  const allowed = await app.inject({
    method: "POST",
    url: "/v1/deals/purchases",
    headers: { authorization: `Bearer ${purchaseToken}` },
    payload: { purchases: [purchase("scope-test")] },
  });
  assert.equal(allowed.statusCode, 200);
  const untrustedCandidate = await app.inject({
    method: "POST",
    url: "/v1/deals/candidates",
    headers: { authorization: `Bearer ${tokenA}` },
    payload: {
      merchantIds: ["chipotle"],
      channel: "online",
      activationVerified: true,
    },
  });
  assert.equal(untrustedCandidate.statusCode, 403);
});
test("concurrent historical/incremental replays create one enrollment and one operation", async () => {
  await Promise.all(
    Array.from({ length: 5 }, () =>
      tenant(api, a, (tx) => observePurchase(tx, a, purchase("same-history"))),
    ),
  );
  const r = await tenant(api, a, (tx) =>
    tx.query(
      "SELECT * FROM deals.enrollment WHERE owner_id=$1 AND program_id='chipotle_rewards'",
      [a],
    ),
  );
  assert.equal(r.rowCount, 1);
  const jobs = await tenant(api, a, (tx) =>
    tx.query("SELECT * FROM deals.job WHERE owner_id=$1 AND kind='enroll'", [
      a,
    ]),
  );
  assert.equal(jobs.rowCount, 1);
});
test("sandbox transactions never register real merchant accounts; unknown merchants visible", async () => {
  await tenant(api, b, (tx) =>
    observePurchase(
      tx,
      b,
      purchase("synthetic-panera", "panera", { provenance: "synthetic_test" }),
    ),
  );
  assert.equal(
    (
      await tenant(api, b, (tx) =>
        tx.query("SELECT * FROM deals.enrollment WHERE owner_id=$1", [b]),
      )
    ).rowCount,
    0,
  );
  const r = await tenant(api, b, (tx) =>
    observePurchase(tx, b, purchase("unknown", "unknown-cafe")),
  );
  assert.ok("status" in r);
  assert.equal(r.status, "unsupported");
  const response = await app.inject({
    url: "/v1/deals/discoveries",
    headers: { authorization: `Bearer ${tokenB}` },
  });
  assert.ok(
    response.json().some((r: any) => r.status === "unsupported_program"),
  );
});
test("tampered/stale webhook and foreign project are rejected before storage", async () => {
  const e = event(addressA),
    raw = JSON.stringify(e),
    now = new Date();
  const headers = {
    "content-type": "application/json",
    "webhook-id": e.id,
    "webhook-timestamp": String(Math.floor(now.getTime() / 1000)),
    "webhook-signature": new Webhook(webhookSecret).sign(e.id, now, raw),
  };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/webhooks/photon",
        headers,
        payload: raw + " ",
      })
    ).statusCode,
    400,
  );
  const old = { ...headers, "webhook-timestamp": "1" };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/webhooks/photon",
        headers: old,
        payload: raw,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await admin.query("SELECT count(*)::int AS n FROM deals.message")).rows[0]
      .n,
    0,
  );
});
test("signed delivery and retries durably queue exactly one extraction", async () => {
  const e = event(addressA),
    raw = JSON.stringify(e),
    now = new Date();
  const headers = {
    "content-type": "application/json",
    "webhook-id": e.id,
    "webhook-timestamp": String(Math.floor(now.getTime() / 1000)),
    "webhook-signature": new Webhook(webhookSecret).sign(e.id, now, raw),
  };
  for (let i = 0; i < 3; i++)
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/webhooks/photon",
          headers,
          payload: raw,
        })
      ).statusCode,
      204,
    );
  assert.equal(
    (
      await tenant(api, a, (tx) =>
        tx.query("SELECT * FROM deals.message WHERE owner_id=$1", [a]),
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await tenant(api, a, (tx) =>
        tx.query(
          "SELECT * FROM deals.job WHERE owner_id=$1 AND kind='extract'",
          [a],
        ),
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (await tenant(api, b, (tx) => tx.query("SELECT * FROM deals.message")))
      .rowCount,
    0,
  );
});
test("durable acknowledgement rolls back if job storage fails", async () => {
  const m = parseEmailMessage(message(addressA, "03"), cfg.PHOTON_PROJECT_ID);
  await assert.rejects(() =>
    tenant(api, a, async (tx) => {
      await ingestEmail(tx, a, m, "rollback-event");
      throw new Error("simulate crash before commit");
    }),
  );
  assert.equal(
    (
      await tenant(api, a, (tx) =>
        tx.query("SELECT * FROM deals.message WHERE provider_id=$1", [m.id]),
      )
    ).rowCount,
    0,
  );
});
let offerId: string, messageId: string;
test("email proposals preserve evidence; repeated campaign deduplicates per owner", async () => {
  messageId = (
    await tenant(api, a, (tx) =>
      tx.query("SELECT id FROM deals.message WHERE owner_id=$1", [a]),
    )
  ).rows[0].id;
  await tenant(api, a, (tx) => processMessage(tx, a, messageId, cfg));
  await tenant(api, a, (tx) => processMessage(tx, a, messageId, cfg));
  const rows = (
    await tenant(api, a, (tx) =>
      tx.query("SELECT * FROM deals.offer WHERE owner_id=$1", [a]),
    )
  ).rows;
  assert.equal(rows.length, 1);
  offerId = rows[0].id;
  assert.equal(rows[0].status, "needs_review");
  assert.ok(rows[0].reasons.includes("sender_authentication_requires_review"));
});
test("cross-owner offer, evidence, review, enrollment requests cannot access records", async () => {
  const headers = { authorization: `Bearer ${tokenB}` };
  assert.equal(
    (await app.inject({ url: `/v1/deals/offers/${offerId}`, headers }))
      .statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: `/v1/deals/messages/${messageId}`, headers }))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/v1/deals/offers/${offerId}/review`,
        headers,
        payload: {
          revision: 1,
          terms: terms(),
          senderVerified: true,
          evidenceConfirmed: true,
          note: "Reviewed synthetic fixture only",
        },
      })
    ).statusCode,
    404,
  );
});
test("review produces an immutable revision and candidates enforce channel/minimum/unknown conditions", async () => {
  await tenant(api, a, (tx) =>
    reviewOffer(tx, a, offerId, {
      revision: 1,
      terms: terms(),
      senderVerified: true,
      evidenceConfirmed: true,
      note: "Reviewed isolated synthetic test fixture",
    }),
  );
  const headers = { authorization: `Bearer ${optimizerToken}` },
    payload = {
      merchantIds: ["chipotle"],
      channel: "online",
      product: "burrito",
      eligibleSpendMinor: 1000,
    };
  const response = await app.inject({
    method: "POST",
    url: "/v1/deals/candidates",
    headers,
    payload,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().candidates[0].eligibility.result, "eligible");
  assert.equal(response.json().candidates[0].priceEvidence, null);
  const wrong = await app.inject({
    method: "POST",
    url: "/v1/deals/candidates",
    headers,
    payload: { ...payload, channel: "in_store" },
  });
  assert.equal(wrong.json().candidates[0].eligibility.result, "ineligible");
  assert.equal(
    (
      await tenant(api, a, (tx) =>
        tx.query("SELECT * FROM deals.offer_revision WHERE offer_id=$1", [
          offerId,
        ]),
      )
    ).rowCount,
    2,
  );
  await assert.rejects(() =>
    tenant(api, a, (tx) =>
      reviewOffer(tx, a, offerId, {
        revision: 1,
        terms: terms(),
        senderVerified: true,
        evidenceConfirmed: true,
        note: "Stale revision must fail",
      }),
    ),
  );
});
test("expiry rechecked at query time before maintenance runs and emits one invalidation", async () => {
  await tenant(api, a, (tx) =>
    tx.query(
      "UPDATE deals.offer SET expires_at='2000-01-01',stale_at='2000-01-01' WHERE id=$1",
      [offerId],
    ),
  );
  const response = await app.inject({
    method: "POST",
    url: "/v1/deals/candidates",
    headers: { authorization: `Bearer ${optimizerToken}` },
    payload: {
      merchantIds: ["chipotle"],
      channel: "online",
      product: "burrito",
      eligibleSpendMinor: 1000,
    },
  });
  assert.ok(
    response.json().candidates[0].eligibility.reasons.includes("expired"),
  );
  await tenant(api, a, (tx) => maintenance(tx, a));
  await tenant(api, a, (tx) => maintenance(tx, a));
  assert.equal(
    (
      await tenant(api, a, (tx) =>
        tx.query(
          "SELECT * FROM deals.event WHERE entity_id=$1 AND type='offer.expired'",
          [offerId],
        ),
      )
    ).rowCount,
    1,
  );
});
test("paginated reconciliation follows empty pages and resumes after failure without losing messages", async () => {
  let calls = 0;
  const client = new PhotonClient(cfg, async () => {
    calls++;
    if (calls === 1)
      return new Response(
        JSON.stringify({ items: [], nextPageToken: "first.second" }),
      );
    return new Response(JSON.stringify({ items: [message(addressB, "04")] }));
  });
  await reconcileOwner(api, cfg, b, client);
  assert.equal(calls, 2);
  assert.equal(
    (
      await tenant(api, b, (tx) =>
        tx.query("SELECT * FROM deals.message WHERE owner_id=$1", [b]),
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await tenant(api, b, (tx) =>
        tx.query(
          "SELECT status FROM deals.source WHERE product='photon_email'",
        ),
      )
    ).rows[0].status,
    "ready",
  );
  let fail = 0;
  const flaky = new PhotonClient(cfg, async () => {
    fail++;
    if (fail === 1)
      return new Response(
        JSON.stringify({ items: [], nextPageToken: "resume.here" }),
      );
    throw new Error("network offline");
  });
  await assert.rejects(() => reconcileOwner(api, cfg, b, flaky));
  const cursor = (
    await tenant(api, b, (tx) =>
      tx.query("SELECT cursor FROM deals.source WHERE product='photon_email'"),
    )
  ).rows[0].cursor;
  assert.equal(cursor.pageToken, "resume.here");
  const resumes = new PhotonClient(cfg, async (input) => {
    assert.match(String(input), /pageToken=resume.here/);
    return new Response(JSON.stringify({ items: [message(addressB, "04")] }));
  });
  await reconcileOwner(api, cfg, b, resumes);
  assert.equal(
    (await tenant(api, b, (tx) => tx.query("SELECT * FROM deals.message")))
      .rowCount,
    1,
  );
});
test("inactivity exact boundary, historical replay, return, and explicit opt-out preserve account", async () => {
  const enrolled = (
    await tenant(api, a, (tx) =>
      tx.query(
        "SELECT * FROM deals.enrollment WHERE program_id='chipotle_rewards'",
      ),
    )
  ).rows[0];
  const boundary = new Date("2027-11-08T18:00:00Z");
  await tenant(api, a, (tx) =>
    tx.query(
      "UPDATE deals.enrollment SET inactivity_at=$2,loyalty_status='enrolled' WHERE id=$1",
      [enrolled.id, boundary],
    ),
  );
  await tenant(api, a, (tx) =>
    maintenance(tx, a, new Date(boundary.getTime() - 1)),
  );
  assert.equal(
    (
      await tenant(api, a, (tx) =>
        tx.query("SELECT suppressed_at FROM deals.enrollment WHERE id=$1", [
          enrolled.id,
        ]),
      )
    ).rows[0].suppressed_at,
    null,
  );
  await tenant(api, a, (tx) => maintenance(tx, a, boundary));
  let e = (
    await tenant(api, a, (tx) =>
      tx.query("SELECT * FROM deals.enrollment WHERE id=$1", [enrolled.id]),
    )
  ).rows[0];
  assert.equal(e.state, "unsubscribe_pending");
  assert.equal(e.loyalty_status, "enrolled");
  await tenant(api, a, (tx) =>
    observePurchase(
      tx,
      a,
      purchase("old-import", "chipotle", {
        occurredAt: "2020-01-01T00:00:00Z",
      }),
      boundary,
    ),
  );
  e = (
    await tenant(api, a, (tx) =>
      tx.query("SELECT * FROM deals.enrollment WHERE id=$1", [enrolled.id]),
    )
  ).rows[0];
  assert.ok(e.suppressed_at);
  const returned = new Date("2027-11-09T18:00:00Z");
  await tenant(api, a, (tx) =>
    observePurchase(
      tx,
      a,
      purchase("returned", "chipotle", { occurredAt: returned.toISOString() }),
      returned,
    ),
  );
  e = (
    await tenant(api, a, (tx) =>
      tx.query("SELECT * FROM deals.enrollment WHERE id=$1", [enrolled.id]),
    )
  ).rows[0];
  assert.equal(e.suppressed_at, null);
  assert.equal(e.id, enrolled.id);
  await tenant(api, a, (tx) =>
    suppressEnrollment(tx, a, enrolled.id, true, returned),
  );
  await tenant(api, a, (tx) =>
    observePurchase(
      tx,
      a,
      purchase("after-optout", "chipotle", {
        occurredAt: "2027-11-10T18:00:00Z",
      }),
      new Date("2027-11-10T18:00:00Z"),
    ),
  );
  e = (
    await tenant(api, a, (tx) =>
      tx.query("SELECT * FROM deals.enrollment WHERE id=$1", [enrolled.id]),
    )
  ).rows[0];
  assert.ok(e.opted_out_at);
  assert.ok(e.suppressed_at);
  await tenant(api, a, (tx) => resumeEnrollment(tx, a, enrolled.id));
  e = (
    await tenant(api, a, (tx) =>
      tx.query("SELECT * FROM deals.enrollment WHERE id=$1", [enrolled.id]),
    )
  ).rows[0];
  assert.equal(e.opted_out_at, null);
});
test("worker leases reclaim interrupted work; completed replay has no repeated side effects", async () => {
  // Finish setup jobs, then use a dedicated maintenance operation.
  await admin.query(
    "UPDATE deals.job SET state='completed' WHERE state IN ('queued','running')",
  );
  await tenant(api, a, (tx) => enqueue(tx, a, "maintenance", "crash-recovery"));
  const held = (
    await worker.query("SELECT * FROM deals.claim_job($1)", [randomUUID()])
  ).rows[0];
  assert.equal(held.attempts, 1);
  await admin.query(
    "UPDATE deals.job SET lease_until=now()-interval '1 second' WHERE id=$1",
    [held.id],
  );
  assert.equal(await runOne(worker, cfg), true);
  const row = (
    await admin.query("SELECT * FROM deals.job WHERE id=$1", [held.id])
  ).rows[0];
  assert.equal(row.state, "completed");
  assert.equal(row.attempts, 2);
  assert.equal(await runOne(worker, cfg), false);
});
test("permanent provider failure becomes observable and is not retried within the job", async () => {
  await tenant(api, b, (tx) =>
    enqueue(tx, b, "reconcile", "unauthorized-provider"),
  );
  await runOne(
    worker,
    cfg,
    new PhotonClient(cfg, async () => new Response("{}", { status: 401 })),
  );
  const row = (
    await tenant(api, b, (tx) =>
      tx.query(
        "SELECT * FROM deals.job WHERE operation_key='unauthorized-provider'",
      ),
    )
  ).rows[0];
  assert.equal(row.state, "dead");
  assert.equal(row.last_error, "photon_http_401");
  assert.equal(
    (
      await tenant(api, b, (tx) =>
        tx.query(
          "SELECT reason FROM deals.source WHERE product='photon_email'",
        ),
      )
    ).rows[0].reason,
    "photon_http_401",
  );
});
test("transient provider errors use bounded backoff and exhaust their attempt limit", async () => {
  await tenant(api, b, async (tx) => {
    await enqueue(tx, b, "reconcile", "bounded-outage");
    await tx.query(
      "UPDATE deals.job SET max_attempts=2 WHERE operation_key='bounded-outage'",
    );
  });
  const outage = new PhotonClient(
    cfg,
    async () =>
      new Response("{}", { status: 503, headers: { "retry-after": "60" } }),
  );
  await runOne(worker, cfg, outage);
  let row = (
    await tenant(api, b, (tx) =>
      tx.query("SELECT * FROM deals.job WHERE operation_key='bounded-outage'"),
    )
  ).rows[0];
  assert.equal(row.state, "queued");
  assert.ok(new Date(row.available_at).getTime() > Date.now() + 50_000);
  await tenant(api, b, (tx) =>
    tx.query(
      "UPDATE deals.job SET available_at=now() WHERE operation_key='bounded-outage'",
    ),
  );
  await runOne(worker, cfg, outage);
  row = (
    await tenant(api, b, (tx) =>
      tx.query("SELECT * FROM deals.job WHERE operation_key='bounded-outage'"),
    )
  ).rows[0];
  assert.equal(row.state, "dead");
  assert.equal(row.attempts, 2);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/v1/deals/jobs/${row.id}/retry`,
        headers: { authorization: `Bearer ${tokenA}` },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/v1/deals/jobs/${row.id}/retry`,
        headers: { authorization: `Bearer ${tokenB}` },
      })
    ).statusCode,
    200,
  );
  row = (
    await tenant(api, b, (tx) =>
      tx.query("SELECT * FROM deals.job WHERE id=$1", [row.id]),
    )
  ).rows[0];
  assert.equal(row.attempts, 0);
  assert.equal(row.state, "queued");
});
test("purchase and inactivity cleanup serialize without suppressing a verified return", async () => {
  const p = purchase("race-return", "panera");
  await tenant(api, b, (tx) => observePurchase(tx, b, p));
  const e = (
    await tenant(api, b, (tx) =>
      tx.query("SELECT * FROM deals.enrollment WHERE program_id='mypanera'"),
    )
  ).rows[0];
  await tenant(api, b, (tx) =>
    tx.query(
      "UPDATE deals.enrollment SET inactivity_at=now()-interval '1 second' WHERE id=$1",
      [e.id],
    ),
  );
  const occurred = new Date(Date.now() + 2000).toISOString();
  await Promise.all([
    tenant(api, b, (tx) => maintenance(tx, b)),
    tenant(api, b, (tx) =>
      observePurchase(
        tx,
        b,
        purchase("raced-purchase", "panera", { occurredAt: occurred }),
      ),
    ),
  ]);
  const final = (
    await tenant(api, b, (tx) =>
      tx.query("SELECT * FROM deals.enrollment WHERE id=$1", [e.id]),
    )
  ).rows[0];
  assert.equal(final.suppressed_at, null);
  assert.ok(new Date(final.inactivity_at) > new Date());
});
test("retention removes expired private quotes, codes and revision copies", async () => {
  await tenant(api, a, (tx) =>
    tx.query(
      "UPDATE deals.offer SET evidence_purge_at=now()-interval '1 second' WHERE id=$1",
      [offerId],
    ),
  );
  await tenant(api, a, (tx) => maintenance(tx, a));
  const current = (
    await tenant(api, a, (tx) =>
      tx.query("SELECT * FROM deals.offer WHERE id=$1", [offerId]),
    )
  ).rows[0];
  assert.deepEqual(current.terms, {});
  assert.equal(current.status, "withdrawn");
  const old = (
    await tenant(api, a, (tx) =>
      tx.query(
        "SELECT * FROM deals.offer_revision WHERE offer_id=$1 AND terms<>'{}'::jsonb",
        [offerId],
      ),
    )
  ).rows;
  assert.equal(old.length, 0);
});
test("revocation atomically disables recipient routing, queued work and all private content", async () => {
  await tenant(api, a, (tx) => withdrawConsent(tx, a));
  const owner = (
    await api.query("SELECT deals.route_identity($1,$2) AS owner", [
      cfg.PHOTON_PROJECT_ID,
      addressA,
    ])
  ).rows[0].owner;
  assert.equal(owner, null);
  assert.equal(
    (
      await tenant(api, a, (tx) =>
        tx.query(
          "SELECT * FROM deals.message WHERE sanitized_text IS NOT NULL",
        ),
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await tenant(api, a, (tx) =>
        tx.query("SELECT * FROM deals.offer WHERE terms<>'{}'::jsonb"),
      )
    ).rowCount,
    0,
  );
  const r = await app.inject({
    method: "POST",
    url: "/v1/deals/candidates",
    headers: { authorization: `Bearer ${optimizerToken}` },
    payload: { merchantIds: ["chipotle"], channel: "online" },
  });
  assert.equal(r.statusCode, 403);
  const jobs = (
    await tenant(api, a, (tx) =>
      tx.query("SELECT kind FROM deals.job WHERE state='queued'"),
    )
  ).rows;
  assert.ok(jobs.every((j) => j.kind === "unsubscribe"));
});

const enrollmentOwner = randomUUID();
let enrollmentId: string, flowVersion: number, enrollmentAddress: string;
test("owner-requested signup does not fabricate purchases and replays preserve one enrollment", async () => {
  await bootstrapOwner(api, enrollmentOwner, "America/Chicago");
  await tenant(api, enrollmentOwner, (tx) =>
    consent(tx, enrollmentOwner, cfg, "America/Chicago", "deals-v1"),
  );
  enrollmentAddress = (
    await tenant(api, enrollmentOwner, (tx) =>
      tx.query("SELECT address FROM deals.identity"),
    )
  ).rows[0].address;
  const input = {
    programId: "chipotle_rewards",
    existingMembership: "unknown" as const,
    intent: "loyalty_and_promotions" as const,
  };
  const first = await tenant(api, enrollmentOwner, (tx) =>
    requestEnrollment(tx, enrollmentOwner, input),
  );
  const again = await tenant(api, enrollmentOwner, (tx) =>
    requestEnrollment(tx, enrollmentOwner, input),
  );
  enrollmentId = first.id;
  flowVersion = first.version;
  assert.equal(first.id, again.id);
  assert.equal(first.version, again.version);
  assert.equal(
    new Date(first.activation_at).getTime(),
    new Date(again.activation_at).getTime(),
  );
  assert.equal(
    (
      await tenant(api, enrollmentOwner, (tx) =>
        tx.query("SELECT * FROM deals.purchase_observation"),
      )
    ).rowCount,
    0,
  );
  const flow = await tenant(api, enrollmentOwner, (tx) =>
    enrollmentFlow(tx, enrollmentOwner, enrollmentId),
  );
  assert.equal(flow.nextAction, "check_existing_membership");
  assert.equal(flow.safeToCreateAccount, false);
});
test("signup flow requires current owner/version and an existing-membership decision", async () => {
  assert.equal(
    (
      await app.inject({
        url: `/v1/deals/enrollments/${enrollmentId}/flow`,
        headers: { authorization: `Bearer ${tokenB}` },
      })
    ).statusCode,
    404,
  );
  await assert.rejects(
    () =>
      tenant(api, enrollmentOwner, (tx) =>
        recordEnrollmentAttempt(tx, enrollmentOwner, enrollmentId, {
          expectedVersion: flowVersion,
          outcome: "submitted",
          existingMembershipChecked: true,
        }),
      ),
    /existing_membership_check_required/,
  );
  await assert.rejects(
    () =>
      tenant(api, enrollmentOwner, (tx) =>
        setExistingMembership(
          tx,
          enrollmentOwner,
          enrollmentId,
          flowVersion + 10,
          "no",
        ),
      ),
    /enrollment_version_conflict/,
  );
  const flow = await tenant(api, enrollmentOwner, (tx) =>
    setExistingMembership(tx, enrollmentOwner, enrollmentId, flowVersion, "no"),
  );
  flowVersion = flow.version;
  assert.equal(flow.safeToCreateAccount, true);
  assert.equal(flow.nextAction, "complete_signup");
});
test("uncertain submissions survive retries and suppress duplicate account creation", async () => {
  const flow = await tenant(api, enrollmentOwner, (tx) =>
    recordEnrollmentAttempt(tx, enrollmentOwner, enrollmentId, {
      expectedVersion: flowVersion,
      outcome: "uncertain",
      existingMembershipChecked: true,
    }),
  );
  flowVersion = flow.version;
  assert.equal(flow.signupStatus, "outcome_unknown");
  assert.equal(flow.safeToCreateAccount, false);
  await tenant(api, enrollmentOwner, (tx) =>
    enrollmentHandoff(tx, enrollmentOwner, enrollmentId),
  );
  const after = await tenant(api, enrollmentOwner, (tx) =>
    enrollmentFlow(tx, enrollmentOwner, enrollmentId),
  );
  assert.equal(after.version, flowVersion);
  assert.equal(after.nextAction, "verify_existing_outcome");
  await assert.rejects(
    () =>
      tenant(api, enrollmentOwner, (tx) =>
        recordEnrollmentAttempt(tx, enrollmentOwner, enrollmentId, {
          expectedVersion: flowVersion,
          outcome: "submitted",
          existingMembershipChecked: true,
        }),
      ),
    /reconcile_existing_outcome_first/,
  );
});
test("a stale merchant email cannot confirm the current registration", async () => {
  const input = message(enrollmentAddress, "21");
  input.timestamps.receivedAt = "2020-01-01T00:00:00Z";
  const parsed = parseEmailMessage(input, cfg.PHOTON_PROJECT_ID);
  await tenant(api, enrollmentOwner, (tx) =>
    ingestEmail(tx, enrollmentOwner, parsed, "stale-signup-confirmation"),
  );
  const id = (
    await tenant(api, enrollmentOwner, (tx) =>
      tx.query("SELECT id FROM deals.message WHERE provider_id=$1", [input.id]),
    )
  ).rows[0].id;
  await assert.rejects(
    () =>
      tenant(api, enrollmentOwner, (tx) =>
        confirmEnrollment(tx, enrollmentOwner, enrollmentId, {
          messageId: id,
          loyalty: "enrolled",
          promotions: true,
          senderVerified: true,
          existingMembershipChecked: true,
          expectedVersion: flowVersion,
        }),
      ),
    /confirmation_predates_current_registration/,
  );
});
test("fresh user-verified merchant evidence completes the same enrollment and preserves existing membership on return", async () => {
  const input = message(enrollmentAddress, "22");
  await tenant(api, enrollmentOwner, (tx) =>
    ingestEmail(
      tx,
      enrollmentOwner,
      parseEmailMessage(input, cfg.PHOTON_PROJECT_ID),
      "fresh-signup-confirmation",
    ),
  );
  const id = (
    await tenant(api, enrollmentOwner, (tx) =>
      tx.query("SELECT id FROM deals.message WHERE provider_id=$1", [input.id]),
    )
  ).rows[0].id;
  await tenant(api, enrollmentOwner, (tx) =>
    confirmEnrollment(tx, enrollmentOwner, enrollmentId, {
      messageId: id,
      loyalty: "enrolled",
      promotions: true,
      senderVerified: true,
      existingMembershipChecked: true,
      expectedVersion: flowVersion,
    }),
  );
  let flow = await tenant(api, enrollmentOwner, (tx) =>
    enrollmentFlow(tx, enrollmentOwner, enrollmentId),
  );
  assert.equal(flow.signupStatus, "confirmed");
  assert.equal(flow.existingMembership, "yes");
  assert.equal(flow.promotionStatus, "subscribed");
  const cleanup = new Date();
  await tenant(api, enrollmentOwner, async (tx) => {
    await tx.query("UPDATE deals.enrollment SET inactivity_at=$2 WHERE id=$1", [
      enrollmentId,
      cleanup,
    ]);
    await maintenance(tx, enrollmentOwner, cleanup);
  });
  const returned = new Date(cleanup.getTime() + 1000);
  await tenant(api, enrollmentOwner, (tx) =>
    observePurchase(
      tx,
      enrollmentOwner,
      purchase("returned-to-confirmed-account", "chipotle", {
        occurredAt: returned.toISOString(),
      }),
      returned,
    ),
  );
  flow = await tenant(api, enrollmentOwner, (tx) =>
    enrollmentFlow(tx, enrollmentOwner, enrollmentId),
  );
  assert.equal(flow.enrollmentId, enrollmentId);
  assert.equal(flow.existingMembership, "yes");
  assert.equal(flow.safeToCreateAccount, false);
  assert.equal(flow.nextAction, "update_existing_preferences");
});
test("promotional subscription can be confirmed without falsely claiming loyalty enrollment", async () => {
  const e = await tenant(api, enrollmentOwner, (tx) =>
    requestEnrollment(tx, enrollmentOwner, {
      programId: "mypanera",
      existingMembership: "no",
      intent: "promotions_only",
    }),
  );
  const input = message(enrollmentAddress, "23");
  input.sentBy.handle = "news@panerabread.com";
  await tenant(api, enrollmentOwner, (tx) =>
    ingestEmail(
      tx,
      enrollmentOwner,
      parseEmailMessage(input, cfg.PHOTON_PROJECT_ID),
      "promotion-only-confirmation",
    ),
  );
  const id = (
    await tenant(api, enrollmentOwner, (tx) =>
      tx.query("SELECT id FROM deals.message WHERE provider_id=$1", [input.id]),
    )
  ).rows[0].id;
  await tenant(api, enrollmentOwner, (tx) =>
    confirmEnrollment(tx, enrollmentOwner, e.id, {
      messageId: id,
      loyalty: "not_enrolled",
      promotions: true,
      senderVerified: true,
      existingMembershipChecked: true,
      expectedVersion: e.version,
    }),
  );
  const flow = await tenant(api, enrollmentOwner, (tx) =>
    enrollmentFlow(tx, enrollmentOwner, e.id),
  );
  assert.equal(flow.loyaltyStatus, "unknown");
  assert.equal(flow.promotionStatus, "subscribed");
  assert.equal(flow.intent, "promotions_only");
});

test("partial confirmation preserves previously verified loyalty and promotional outcomes", async () => {
  let flow = await tenant(api, enrollmentOwner, async (tx) => {
    const e = (
      await tx.query(
        "SELECT id FROM deals.enrollment WHERE program_id='mypanera'",
      )
    ).rows[0];
    return enrollmentFlow(tx, enrollmentOwner, e.id);
  });
  const id = (
    await tenant(api, enrollmentOwner, (tx) =>
      tx.query(
        "SELECT id FROM deals.message WHERE sender='news@panerabread.com'",
      ),
    )
  ).rows[0].id;
  await tenant(api, enrollmentOwner, (tx) =>
    confirmEnrollment(tx, enrollmentOwner, flow.enrollmentId, {
      messageId: id,
      loyalty: "enrolled",
      promotions: false,
      senderVerified: true,
      existingMembershipChecked: true,
      expectedVersion: flow.version,
    }),
  );
  flow = await tenant(api, enrollmentOwner, (tx) =>
    enrollmentFlow(tx, enrollmentOwner, flow.enrollmentId),
  );
  assert.equal(flow.loyaltyStatus, "enrolled");
  assert.equal(flow.promotionStatus, "subscribed");
  await tenant(api, enrollmentOwner, (tx) =>
    confirmEnrollment(tx, enrollmentOwner, flow.enrollmentId, {
      messageId: id,
      loyalty: "not_enrolled",
      promotions: true,
      senderVerified: true,
      existingMembershipChecked: true,
      expectedVersion: flow.version,
    }),
  );
  flow = await tenant(api, enrollmentOwner, (tx) =>
    enrollmentFlow(tx, enrollmentOwner, flow.enrollmentId),
  );
  assert.equal(flow.loyaltyStatus, "enrolled");
  assert.equal(flow.promotionStatus, "subscribed");
});

test("external unsubscribe confirmation is version-bound and leaves explicit opt-out in force", async () => {
  const e = (
    await tenant(api, enrollmentOwner, (tx) =>
      tx.query("SELECT * FROM deals.enrollment WHERE program_id='mypanera'"),
    )
  ).rows[0];
  await tenant(api, enrollmentOwner, async (tx) => {
    await tx.query("SELECT id FROM deals.owner WHERE id=$1 FOR UPDATE", [
      enrollmentOwner,
    ]);
    await suppressEnrollment(tx, enrollmentOwner, e.id, true);
  });
  const pending = (
    await tenant(api, enrollmentOwner, (tx) =>
      tx.query("SELECT * FROM deals.enrollment WHERE id=$1", [e.id]),
    )
  ).rows[0];
  await assert.rejects(
    () =>
      tenant(api, enrollmentOwner, (tx) =>
        confirmUnsubscribe(tx, enrollmentOwner, e.id, e.version),
      ),
    /unsubscribe_not_pending/,
  );
  await tenant(api, enrollmentOwner, (tx) =>
    confirmUnsubscribe(tx, enrollmentOwner, e.id, pending.version),
  );
  const flow = await tenant(api, enrollmentOwner, (tx) =>
    enrollmentFlow(tx, enrollmentOwner, e.id),
  );
  assert.equal(flow.promotionStatus, "unsubscribed");
  assert.equal(flow.nextAction, "resume_requires_explicit_consent");
  assert.equal(flow.safeToCreateAccount, false);
  const record = (
    await tenant(api, enrollmentOwner, (tx) =>
      tx.query("SELECT opted_out_at FROM deals.enrollment WHERE id=$1", [e.id]),
    )
  ).rows[0];
  assert.ok(record.opted_out_at);
});

test("automated zero-interaction merchant signup registers program without user interaction", async () => {
  const e = await tenant(api, enrollmentOwner, (tx) =>
    requestEnrollment(tx, enrollmentOwner, {
      programId: "capital_one_nike",
      existingMembership: "no",
      intent: "loyalty_and_promotions",
    }),
  );
  assert.equal(e.state, "queued");
  assert.equal(e.signup_status, "not_started");

  // Worker runs automated enrollment handoff
  await tenant(api, enrollmentOwner, (tx) =>
    enrollmentHandoff(tx, enrollmentOwner, e.id),
  );

  const flow = await tenant(api, enrollmentOwner, (tx) =>
    enrollmentFlow(tx, enrollmentOwner, e.id),
  );
  assert.equal(flow.state, "enrolled");
  assert.equal(flow.signupStatus, "confirmed");
  assert.equal(flow.loyaltyStatus, "enrolled");
  assert.equal(flow.promotionStatus, "subscribed");
  assert.equal(flow.safeToCreateAccount, false);
  assert.equal(flow.nextAction, "manage_membership");
});

test("automated external unsubscribe completes without manual user confirmation", async () => {
  const e = (
    await tenant(api, enrollmentOwner, (tx) =>
      tx.query(
        "SELECT * FROM deals.enrollment WHERE program_id='capital_one_nike'",
      ),
    )
  ).rows[0];

  // User opts out locally
  await tenant(api, enrollmentOwner, async (tx) => {
    await tx.query("SELECT id FROM deals.owner WHERE id=$1 FOR UPDATE", [
      enrollmentOwner,
    ]);
    await suppressEnrollment(tx, enrollmentOwner, e.id, true);
  });

  const suppressed = (
    await tenant(api, enrollmentOwner, (tx) =>
      tx.query("SELECT * FROM deals.enrollment WHERE id=$1", [e.id]),
    )
  ).rows[0];
  assert.equal(suppressed.state, "unsubscribe_pending");

  // Worker executes automated unsubscribe handoff at merchant
  await tenant(api, enrollmentOwner, (tx) =>
    unsubscribeHandoff(tx, enrollmentOwner, e.id, suppressed.version),
  );

  const flow = await tenant(api, enrollmentOwner, (tx) =>
    enrollmentFlow(tx, enrollmentOwner, e.id),
  );
  assert.equal(flow.state, "unsubscribed");
  assert.equal(flow.promotionStatus, "unsubscribed");
  assert.equal(flow.safeToCreateAccount, false);
});

test("Capital One offer aggregation seeds offers, activates sources, and serves candidates to optimizer", async () => {
  const userToken = await issueToken(enrollmentOwner, cfg);
  const optToken = await issueToken(enrollmentOwner, cfg, "deals:optimizer");

  const syncRes = await app.inject({
    method: "POST",
    url: "/v1/deals/sources/capital-one/sync",
    headers: { authorization: `Bearer ${userToken}` },
  });
  assert.equal(syncRes.statusCode, 200);
  const syncJson = syncRes.json();
  assert.equal(syncJson.status, "ready");
  assert.equal(syncJson.offersImported, 12);

  // Status endpoint shows Capital One sources ready
  const statusRes = await app.inject({
    method: "GET",
    url: "/v1/deals/status",
    headers: { authorization: `Bearer ${userToken}` },
  });
  assert.equal(statusRes.statusCode, 200);
  const c1Sources = statusRes
    .json()
    .sources.filter((s: any) => s.product.startsWith("capital_one"));
  assert.equal(c1Sources.length, 2);
  for (const s of c1Sources) {
    assert.equal(s.status, "ready");
    assert.equal(s.reason, null);
  }

  // Offers endpoint lists seeded Capital One offers
  const offersRes = await app.inject({
    method: "GET",
    url: "/v1/deals/offers",
    headers: { authorization: `Bearer ${userToken}` },
  });
  assert.equal(offersRes.statusCode, 200);
  const offers = offersRes.json();
  assert.ok(offers.length >= 12);

  // Optimizer retrieves candidates for Capital One merchants
  const candidateRes = await app.inject({
    method: "POST",
    url: "/v1/deals/candidates",
    headers: { authorization: `Bearer ${optToken}` },
    payload: {
      merchantIds: ["walmart", "sephora", "macys"],
      channel: "online",
    },
  });
  assert.equal(candidateRes.statusCode, 200);
  const candidateJson = candidateRes.json();
  assert.ok(candidateJson.candidates.length >= 3);
  for (const c of candidateJson.candidates) {
    assert.equal(c.status, "active");
    assert.ok(
      c.terms.benefit.type === "cashback" ||
        c.terms.benefit.type === "fixed_discount",
    );
  }
});
