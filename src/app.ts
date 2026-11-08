import Fastify, { LogController, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z, ZodError } from "zod";
import type pg from "pg";
import { authenticate } from "./auth.js";
import type { Config } from "./config.js";
import {
  purchaseSchema,
  purchaseContextSchema,
  reviewSchema,
  enrollmentRequestSchema,
  enrollmentAttemptSchema,
} from "./contracts.js";
import {
  requestEnrollment,
  enrollmentFlow,
  setExistingMembership,
  recordEnrollmentAttempt,
} from "./enrollment.js";
import { DomainError, enqueue, tenant } from "./db.js";
import { routeAndIngest, verifyEvent } from "./photon.js";
import {
  assertConsent,
  candidates,
  confirmEnrollment,
  confirmUnsubscribe,
  consent,
  observePurchase,
  resumeEnrollment,
  reviewOffer,
  suppressEnrollment,
  withdrawConsent,
} from "./service.js";
const uuid = z.object({ id: z.uuid() }).strict();
declare module "fastify" {
  interface FastifyRequest {
    owner: string;
  }
}

export async function buildApp(pool: pg.Pool, cfg: Config, logging = false) {
  const app = Fastify({
    bodyLimit: 1_000_000,
    logger: logging
      ? {
          level: "info",
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.headers.webhook-signature",
          ],
          serializers: {
            req: (r: any) => ({
              method: r.method,
              url: r.url?.split("?")[0],
              id: r.id,
            }),
            res: (r: any) => ({ statusCode: r.statusCode }),
          },
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: false,
  });
  app.decorateRequest("owner", "");
  await app.register(helmet);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof DomainError)
      return reply
        .code(error.status)
        .send({ error: error.code, requestId: req.id });
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: "invalid_request",
        fields: error.issues.map((i) => i.path.join(".")),
        requestId: req.id,
      });
    const status = (error as any).statusCode;
    if (status && status < 500)
      return reply.code(status).send({
        error: status === 429 ? "rate_limit" : "invalid_request",
        requestId: req.id,
      });
    req.log.error({ requestId: req.id }, "Request failed");
    return reply
      .code(503)
      .send({ error: "service_unavailable", requestId: req.id });
  });
  app.get("/health", async () => ({ service: "deals", status: "ok" }));
  app.get("/ready", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return { database: "ready" };
    } catch {
      return reply.code(503).send({ database: "unavailable" });
    }
  });
  // Encapsulation preserves the original body only for the webhook, before JSON middleware.
  await app.register(async (webhook) => {
    webhook.removeContentTypeParser("application/json");
    webhook.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (_req, body, done) => done(null, body),
    );
    webhook.post("/webhooks/photon", async (req, reply) => {
      if (!cfg.PHOTON_WEBHOOK_SECRET)
        return reply.code(503).send({ error: "webhook_not_configured" });
      const headers = Object.fromEntries(
        ["webhook-id", "webhook-timestamp", "webhook-signature"].map((k) => [
          k,
          String(req.headers[k] ?? ""),
        ]),
      );
      const event = verifyEvent(req.body as string, headers, cfg);
      await routeAndIngest(pool, cfg, event.message, event.eventId);
      return reply.code(204).send();
    });
  });
  await app.register(async (api) => {
    api.addHook("onRequest", async (req, reply) => {
      const scope =
        req.routeOptions.url === "/v1/deals/purchases"
          ? "deals:purchase"
          : req.routeOptions.url === "/v1/deals/candidates"
            ? "deals:optimizer"
            : "deals:user";
      req.owner = await authenticate(req.headers.authorization, cfg, scope);
      reply.header("Cache-Control", "private, no-store");
    });
    const scoped = <T>(
      req: FastifyRequest,
      fn: (tx: pg.PoolClient, owner: string) => Promise<T>,
    ) => tenant(pool, req.owner, (tx) => fn(tx, req.owner));
    api.get("/v1/deals/status", async (req) =>
      scoped(req, async (tx, owner) => {
        const profile = (
          await tx.query(
            "SELECT id,timezone,consent_version,consent_at,revoked_at FROM deals.owner WHERE id=$1",
            [owner],
          )
        ).rows[0];
        if (!profile) throw new DomainError("owner_not_found", 404);
        const identity =
          (
            await tx.query(
              "SELECT address,disabled_at FROM deals.identity WHERE owner_id=$1",
              [owner],
            )
          ).rows[0] ?? null;
        const sources = (
          await tx.query(
            "SELECT product,status,reason,last_success_at FROM deals.source WHERE owner_id=$1 ORDER BY product",
            [owner],
          )
        ).rows;
        const jobs = (
          await tx.query(
            "SELECT id,kind,state,attempts,last_error FROM deals.job WHERE owner_id=$1 AND state IN ('dead','queued','running') ORDER BY created_at DESC LIMIT 30",
            [owner],
          )
        ).rows;
        return {
          profile,
          identity,
          sources,
          jobs,
          providerDeletion:
            "Photon message deletion is not documented in the pinned API; local erasure cannot prove provider erasure.",
        };
      }),
    );
    api.post("/v1/deals/consent", async (req) => {
      const body = z
        .object({
          timezone: z.string().max(100),
          version: z.literal("deals-v1"),
        })
        .strict()
        .parse(req.body);
      return scoped(req, async (tx, owner) => {
        await consent(tx, owner, cfg, body.timezone, body.version);
        return { status: "consented" };
      });
    });
    api.delete("/v1/deals/consent", async (req) =>
      scoped(req, async (tx, owner) => {
        await withdrawConsent(tx, owner);
        return {
          status: "revoked",
          externalUnsubscribe: "pending_confirmation",
          providerDeletion: "unsupported",
        };
      }),
    );
    api.get("/v1/deals/programs", async (req) =>
      scoped(
        req,
        async (tx) =>
          (await tx.query("SELECT * FROM deals.program ORDER BY name")).rows,
      ),
    );
    api.get("/v1/deals/enrollments", async (req) =>
      scoped(
        req,
        async (tx, owner) =>
          (
            await tx.query(
              `SELECT e.*,p.name,p.merchant_id,p.signup_url,p.preferences_url,p.capabilities
      FROM deals.enrollment e JOIN deals.program p ON p.id=e.program_id WHERE e.owner_id=$1 ORDER BY p.name`,
              [owner],
            )
          ).rows,
      ),
    );
    api.get("/v1/deals/discoveries", async (req) =>
      scoped(
        req,
        async (tx, owner) =>
          (
            await tx.query(
              `SELECT t.merchant_id,max(t.occurred_at) AS last_purchase_at,
      CASE WHEN p.id IS NULL THEN 'unsupported_program' WHEN bool_and(t.provenance<>'verified_import') THEN 'test_only_no_external_signup' ELSE 'supported' END AS status
      FROM deals.purchase_observation t LEFT JOIN deals.program p ON p.merchant_id=t.merchant_id WHERE t.owner_id=$1 GROUP BY t.merchant_id,p.id`,
              [owner],
            )
          ).rows,
      ),
    );
    api.post("/v1/deals/purchases", async (req) => {
      const body = z
        .object({ purchases: z.array(purchaseSchema).min(1).max(200) })
        .strict()
        .parse(req.body);
      return scoped(req, async (tx, owner) => {
        const results = [];
        for (const p of body.purchases)
          results.push(await observePurchase(tx, owner, p));
        return { results };
      });
    });
    api.post("/v1/deals/enrollments/:id/retry", async (req) => {
      const { id } = uuid.parse(req.params);
      return scoped(req, async (tx, owner) => {
        await assertConsent(tx, owner, true);
        const e = (
          await tx.query(
            "SELECT * FROM deals.enrollment WHERE owner_id=$1 AND id=$2 FOR UPDATE",
            [owner, id],
          )
        ).rows[0];
        if (!e) throw new DomainError("enrollment_not_found", 404);
        if (e.suppressed_at || e.opted_out_at)
          throw new DomainError("explicit_resume_required", 409);
        await enqueue(tx, owner, "enroll", `${id}:retry:${e.version}`, {
          enrollmentId: id,
        });
        return { status: "queued" };
      });
    });
    api.post("/v1/deals/enrollments", async (req) => {
      const input = enrollmentRequestSchema.parse(req.body);
      return scoped(req, async (tx, owner) => {
        const e = await requestEnrollment(tx, owner, input);
        return enrollmentFlow(tx, owner, e.id);
      });
    });
    api.get("/v1/deals/enrollments/:id/flow", async (req) => {
      const { id } = uuid.parse(req.params);
      return scoped(req, (tx, owner) => enrollmentFlow(tx, owner, id));
    });
    api.post("/v1/deals/enrollments/:id/existing-membership", async (req) => {
      const { id } = uuid.parse(req.params);
      const input = z
        .object({
          expectedVersion: z.number().int().positive(),
          existingMembership: z.enum(["yes", "no"]),
        })
        .strict()
        .parse(req.body);
      return scoped(req, (tx, owner) =>
        setExistingMembership(
          tx,
          owner,
          id,
          input.expectedVersion,
          input.existingMembership,
        ),
      );
    });
    api.post("/v1/deals/enrollments/:id/attempt", async (req) => {
      const { id } = uuid.parse(req.params);
      const input = enrollmentAttemptSchema.parse(req.body);
      return scoped(req, (tx, owner) =>
        recordEnrollmentAttempt(tx, owner, id, input),
      );
    });
    api.post("/v1/deals/enrollments/:id/confirm", async (req) => {
      const { id } = uuid.parse(req.params);
      const body = z
        .object({
          messageId: z.uuid(),
          loyalty: z.enum(["existing", "enrolled", "not_enrolled"]),
          promotions: z.boolean(),
          senderVerified: z.literal(true),
          existingMembershipChecked: z.literal(true),
          expectedVersion: z.number().int().positive(),
        })
        .strict()
        .parse(req.body);
      return scoped(req, async (tx, owner) => {
        await confirmEnrollment(tx, owner, id, body);
        return { status: "confirmed_with_user_verified_evidence" };
      });
    });
    api.post("/v1/deals/enrollments/:id/opt-out", async (req) => {
      const { id } = uuid.parse(req.params);
      return scoped(req, async (tx, owner) => {
        await tx.query("SELECT id FROM deals.owner WHERE id=$1 FOR UPDATE", [
          owner,
        ]);
        await suppressEnrollment(tx, owner, id, true);
        return {
          status: "suppressed",
          externalUnsubscribe: "pending_confirmation",
        };
      });
    });
    api.post("/v1/deals/enrollments/:id/resume", async (req) => {
      const { id } = uuid.parse(req.params);
      return scoped(req, async (tx, owner) => {
        await resumeEnrollment(tx, owner, id);
        return { status: "queued" };
      });
    });
    api.post("/v1/deals/enrollments/:id/confirm-unsubscribe", async (req) => {
      const { id } = uuid.parse(req.params);
      const body = z
        .object({
          completedAtMerchant: z.literal(true),
          expectedVersion: z.number().int().positive(),
        })
        .strict()
        .parse(req.body);
      return scoped(req, async (tx, owner) => {
        if (body.completedAtMerchant)
          await confirmUnsubscribe(tx, owner, id, body.expectedVersion);
        return { status: "unsubscribed", evidence: "user_confirmation" };
      });
    });
    api.get("/v1/deals/messages", async (req) =>
      scoped(
        req,
        async (tx, owner) =>
          (
            await tx.query(
              "SELECT id,sender,received_at,subject,classification,trust,purge_at FROM deals.message WHERE owner_id=$1 ORDER BY received_at DESC LIMIT 100",
              [owner],
            )
          ).rows,
      ),
    );
    api.get("/v1/deals/messages/:id", async (req) => {
      const { id } = uuid.parse(req.params);
      return scoped(req, async (tx, owner) => {
        const r = (
          await tx.query(
            "SELECT * FROM deals.message WHERE owner_id=$1 AND id=$2",
            [owner, id],
          )
        ).rows[0];
        if (!r) throw new DomainError("message_not_found", 404);
        return r;
      });
    });
    api.get("/v1/deals/offers", async (req) =>
      scoped(
        req,
        async (tx, owner) =>
          (
            await tx.query(
              `SELECT o.*,p.name AS merchant_name FROM deals.offer o
      JOIN deals.program p ON p.id=o.program_id WHERE o.owner_id=$1 ORDER BY o.created_at DESC LIMIT 100`,
              [owner],
            )
          ).rows,
      ),
    );
    api.get("/v1/deals/offers/:id", async (req) => {
      const { id } = uuid.parse(req.params);
      return scoped(req, async (tx, owner) => {
        const offer = (
          await tx.query(
            "SELECT * FROM deals.offer WHERE owner_id=$1 AND id=$2",
            [owner, id],
          )
        ).rows[0];
        if (!offer) throw new DomainError("offer_not_found", 404);
        const revisions = (
          await tx.query(
            "SELECT * FROM deals.offer_revision WHERE owner_id=$1 AND offer_id=$2 ORDER BY revision",
            [owner, id],
          )
        ).rows;
        return {
          offer,
          revisions,
          audience: "private_owner",
          priceEvidence: null,
        };
      });
    });
    api.post("/v1/deals/offers/:id/review", async (req) => {
      const { id } = uuid.parse(req.params),
        body = reviewSchema.parse(req.body);
      return scoped(req, (tx, owner) => reviewOffer(tx, owner, id, body));
    });
    api.post("/v1/deals/candidates", async (req) => {
      const context = purchaseContextSchema.parse(req.body);
      return scoped(req, async (tx, owner) => ({
        candidates: await candidates(tx, owner, context),
        affordability: "optimizer_must_enforce_budget_liquidity_and_price",
      }));
    });
    api.post("/v1/deals/sources/:product/retry", async (req) => {
      const { product } = z
        .object({ product: z.literal("photon_email") })
        .parse(req.params);
      return scoped(req, async (tx, owner) => {
        await assertConsent(tx, owner, true);
        await tx.query(
          "UPDATE deals.source SET status='syncing',reason=NULL,cursor='{}' WHERE owner_id=$1 AND product=$2",
          [owner, product],
        );
        await enqueue(tx, owner, "reconcile", `manual:${Date.now()}`);
        return { status: "queued" };
      });
    });
    api.post("/v1/deals/jobs/:id/retry", async (req) => {
      const { id } = uuid.parse(req.params);
      return scoped(req, async (tx, owner) => {
        await tx.query("SELECT id FROM deals.owner WHERE id=$1 FOR UPDATE", [
          owner,
        ]);
        const job = (
          await tx.query(
            "SELECT * FROM deals.job WHERE owner_id=$1 AND id=$2 FOR UPDATE",
            [owner, id],
          )
        ).rows[0];
        if (!job) throw new DomainError("job_not_found", 404);
        if (!["unsubscribe", "delete_content"].includes(job.kind))
          await assertConsent(tx, owner);
        if (job.state !== "dead")
          throw new DomainError("only_failed_jobs_can_retry", 409);
        await tx.query(
          "UPDATE deals.job SET state='queued',attempts=0,last_error=NULL,available_at=now(),lease_until=NULL,lease_token=NULL,updated_at=now() WHERE owner_id=$1 AND id=$2",
          [owner, id],
        );
        return { status: "queued" };
      });
    });
    api.get("/v1/deals/events", async (req) => {
      const query = z
        .object({ after: z.coerce.number().int().nonnegative().default(0) })
        .strict()
        .parse(req.query);
      return scoped(req, async (tx, owner) => {
        const events = (
          await tx.query(
            "SELECT * FROM deals.event WHERE owner_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 200",
            [owner, query.after],
          )
        ).rows;
        return {
          events,
          nextCursor: events.at(-1)?.sequence ?? String(query.after),
        };
      });
    });
  });
  return app;
}
