import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { bootstrapOwner, consent, enrollmentHandoff } from "../src/service.js";
import { requestEnrollment } from "../src/enrollment.js";
import { seedCapitalOneOffers } from "../src/capital_one.js";
import { cfg } from "./fixtures.js";
test("PostgreSQL program kinds, labeled simulations, assisted handoffs and seed repairs", async () => {
  const db = new PGlite();
  const query = async (sql: string, p?: any[]): Promise<any> => {
    const r = p?.length ? await db.query(sql, p) : (await db.exec(sql)).at(-1);
    return { ...r, rowCount: r?.affectedRows ?? r?.rows?.length ?? 0 };
  };
  const pool: any = { query, connect: async () => ({ query, release() {} }) };
  try {
    const directory = new URL("../migrations/", import.meta.url);
    for (const f of fs
      .readdirSync(directory)
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(fs.readFileSync(new URL(f, directory), "utf8"));
    const a = randomUUID(),
      b = randomUUID();
    await bootstrapOwner(pool, a, "America/Chicago", true);
    await bootstrapOwner(pool, b, "America/Chicago", false);
    await consent(pool, a, cfg, "America/Chicago", "deals-v1");
    await consent(pool, b, cfg, "America/Chicago", "deals-v1");
    const input = {
      programId: "chipotle_rewards",
      existingMembership: "unknown" as const,
      intent: "loyalty_and_promotions" as const,
      initiation: "store_selection" as const,
    };
    const sim = await requestEnrollment(pool, a, input);
    await enrollmentHandoff(pool, a, sim.id, {
      ...cfg,
      DEALS_DEMO_SIMULATED_SIGNUP: true,
    });
    let e: any = (
      await query("SELECT * FROM deals.enrollment WHERE id=$1", [sim.id])
    ).rows[0];
    assert.equal(e.simulated, true);
    assert.equal(e.loyalty_status, "simulated");
    assert.equal(e.promotion_status, "unknown");
    assert.equal(e.evidence.kind, "simulated_demo_signup");
    await assert.rejects(
      query("UPDATE deals.enrollment SET evidence='{}' WHERE id=$1", [e.id]),
    );
    const real = await requestEnrollment(pool, b, input);
    await enrollmentHandoff(pool, b, real.id, cfg);
    e = (await query("SELECT * FROM deals.enrollment WHERE id=$1", [real.id]))
      .rows[0];
    assert.equal(e.state, "needs_user_input");
    assert.equal(e.signup_status, "awaiting_user");
    await seedCapitalOneOffers(pool, b);
    const {candidates}=await import('../src/service.js');
    const context={merchantIds:['panera'],channel:'in_store' as const,eligibleSpendMinor:2000,useWithOtherOffers:false};
    const sample=await candidates(pool,b,context,new Date('2026-11-08T12:00Z'),true);
    assert.equal(sample[0].program_id,'capital_one_panera');
    assert.equal(sample[0].provenance,'synthetic_fixture');
    assert.equal((await candidates(pool,b,context,new Date('2026-11-08T12:00Z'),false)).length,0);

    e = (await query("SELECT * FROM deals.enrollment WHERE id=$1", [real.id]))
      .rows[0];
    assert.equal(e.signup_status, "awaiting_user");
    const m: any = (
      await query(
        "SELECT * FROM deals.message WHERE owner_id=$1 AND project_id='capital_one'",
        [b],
      )
    ).rows[0];
    assert.equal(m.trust.verified, false);
    assert.equal(m.classification, "synthetic_fixture");
    assert.equal(m.sender, "synthetic-fixture@invalid");
    assert.equal(
      (
        await query(
          "SELECT count(*)::int n FROM deals.program WHERE merchant_id='chipotle'",
        )
      ).rows[0].n,
      2,
    );
    await assert.rejects(
      query(
        "INSERT INTO deals.program SELECT 'duplicate',merchant_id,name,adapter_version,signup_url,preferences_url,sender_domains,capabilities,policy_evidence,kind,provenance,assisted_supported,paid_membership,earn_terms FROM deals.program WHERE id='chipotle_rewards'",
      ),
    );
  } finally {
    await db.close();
  }
});

test("finance gateway contracts provision separate owners and batch labeled sandbox observations", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { createDealsGateway } = require("../../../backend/deals-gateway");
  const { buildApp } = await import("../src/app.js");
  const db = new PGlite();
  const query = async (sql: string, p?: any[]): Promise<any> => {
    const r = p?.length ? await db.query(sql, p) : (await db.exec(sql)).at(-1);
    return { ...r, rowCount: r?.affectedRows ?? r?.rows?.length ?? 0 };
  };
  const pool: any = { query, connect: async () => ({ query, release() {} }) };
  let app: any;
  try {
    const dir = new URL("../migrations/", import.meta.url);
    for (const f of fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(fs.readFileSync(new URL(f, dir), "utf8"));
    app = await buildApp(pool, cfg);
    const gateway = createDealsGateway(
      {
        DEALS_API_URL: "http://127.0.0.1:3001",
        DEALS_AUTH_SECRET: cfg.DEALS_AUTH_SECRET,
      },
      async (url: URL, init: any) => {
        const r = await app.inject({
          url: url.pathname,
          method: init.method,
          headers: init.headers,
          payload: init.body,
        });
        return new Response(r.body, {
          status: r.statusCode,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const a = randomUUID(),
      b = randomUUID();
    await gateway.provision({
      id: a,
      time_zone: "America/Chicago",
      is_synthetic_person: true,
      first_name: "Alex",
    });
    await gateway.provision({
      id: b,
      time_zone: "America/Chicago",
      is_synthetic_person: true,
    });
    assert.equal((await gateway.status(a)).consented, false);
    await gateway.request(a, "/v1/deals/consent", "POST", {
      timezone: "America/Chicago",
      version: "deals-v1",
    });
    assert.equal((await gateway.status(a)).consented, true);
    await gateway.purchases(a, [
      {
        id: "txn_fixture",
        brand_key: "chipotle",
        merchant_id: "branch",
        occurred_at: new Date().toISOString(),
        status: "completed",
        amount_cents: 1000,
        reversed_cents: 0,
        provenance: "nessie_sandbox",
        version: 1,
      },
    ]);
    assert.equal(
      (
        await query(
          "SELECT provenance FROM deals.purchase_observation WHERE owner_id=$1",
          [a],
        )
      ).rows[0].provenance,
      "nessie_sandbox",
    );
    assert.equal(
      (
        await query(
          "SELECT count(*)::int n FROM deals.enrollment WHERE owner_id=$1",
          [a],
        )
      ).rows[0].n,
      0,
    );
    const e = await gateway.enroll(a, "chipotle_rewards");
    assert.equal(
      (
        await query(
          "SELECT initiation FROM deals.enrollment WHERE owner_id=$1 AND id=$2",
          [a, e.enrollmentId],
        )
      ).rows[0].initiation,
      "store_selection",
    );
    assert.equal(
      (
        await query(
          "SELECT count(*)::int n FROM deals.enrollment WHERE owner_id=$1",
          [b],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await app?.close();
    await db.close();
  }
});

test("welcome confirmation requires current domain/time/program evidence and never assumes marketing consent", async () => {
  const { matchWelcomeEmail } = await import("../src/service.js");
  const owner = randomUUID();
  const e = {
    id: randomUUID(),
    version: 2,
    verification_started_at: new Date("2026-11-01T12:00Z"),
    activation_at: new Date("2026-11-01T12:00Z"),
    sender_domains: ["chipotle.com"],
  };
  const message = {
    id: randomUUID(),
    sender: "rewards@chipotle.com",
    received_at: new Date("2026-11-02T12:00Z"),
    sanitized_text: "Chipotle Rewards membership is active.",
    trust: { origin: "synthetic_test" },
  };
  const program = {
    id: "chipotle_rewards",
    name: "Chipotle Rewards",
    sender_domains: ["chipotle.com"],
  };
  const updates: any[] = [];
  const tx: any = {
    query: async (sql: string, params: any[]) => {
      if (sql.includes("FROM deals.owner"))
        return { rows: [{ consent_at: new Date(), revoked_at: null }] };
      if (sql.includes("FROM deals.enrollment")) return { rows: [e] };
      if (sql.includes("FROM deals.message")) return { rows: [message] };
      updates.push({ sql, params });
      return { rows: [] };
    },
  };
  const classify = async () => message.sanitized_text;
  assert.equal(
    await matchWelcomeEmail(
      tx,
      owner,
      { ...message, sender: "rewards@evil.test" },
      program,
      cfg,
      classify,
    ),
    false,
  );
  assert.equal(
    await matchWelcomeEmail(
      tx,
      owner,
      { ...message, received_at: new Date("2026-10-30T12:00Z") },
      program,
      cfg,
      classify,
    ),
    false,
  );
  assert.equal(
    await matchWelcomeEmail(
      tx,
      owner,
      message,
      program,
      cfg,
      async () => "Other Rewards membership is active.",
    ),
    false,
  );
  assert.equal(
    await matchWelcomeEmail(
      tx,
      owner,
      { ...message, sanitized_text: "Welcome to Chipotle Rewards newsletter." },
      program,
      cfg,
      async () => "Welcome to Chipotle Rewards newsletter.",
    ),
    false,
  );
  assert.equal(updates.length, 0);
  assert.equal(
    await matchWelcomeEmail(tx, owner, message, program, cfg, classify),
    true,
  );
  const confirmed = updates.find((u) =>
    u.sql.includes("signup_status='confirmed'"),
  );
  assert.equal(confirmed.params[3], false);
  assert.ok(
    updates.some((u) =>
      u.params?.some(
        (p: any) =>
          typeof p === "string" && p.includes("merchant_welcome_email"),
      ),
    ),
  );
});
