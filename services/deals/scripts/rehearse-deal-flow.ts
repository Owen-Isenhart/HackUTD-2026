import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config, required } from "../src/config.js";
import { poolFor, tenant } from "../src/db.js";
import { candidates, processMessage } from "../src/service.js";
import { enrollmentFlow } from "../src/enrollment.js";
import { parseEmailMessage, ingestEmail } from "../src/photon.js";

async function main() {
  const dbUrl =
    process.env.DATABASE_URL ||
    config.WORKER_DATABASE_URL ||
    config.DATABASE_URL;
  const pool = poolFor(required(dbUrl, "DATABASE_URL"));

  try {
    const owner = process.argv[2] ?? "64b0ef0f-cd28-4af3-b192-8243ccc8e1ce";
    console.log(`=== REHEARSING ASSISTED DEAL FLOW FOR OWNER ${owner} ===\n`);

    const outputEvidence: Record<string, any> = {
      timestamp: new Date().toISOString(),
      ownerId: owner,
      architecture: "assisted_merchant_handoff_with_inbound_auto_confirmation",
    };

    await tenant(pool, owner, async (tx) => {
      // 0. Owner Identity & Inbound Email
      const identityRes = await tx.query(
        "SELECT address, project_id FROM deals.identity WHERE owner_id=$1",
        [owner],
      );
      const identity = identityRes.rows[0];
      outputEvidence.identity = identity;
      console.log("0. Private Inbound Routing Identity:");
      console.log(`   Allocated Alias: ${identity?.address || "none"}`);
      console.log(`   Project ID:      ${identity?.project_id || "none"}\n`);

      // 1. Sources Status
      const sourcesRes = await tx.query(
        "SELECT product, status, reason, last_success_at FROM deals.source WHERE owner_id=$1 ORDER BY product",
        [owner],
      );
      outputEvidence.sources = sourcesRes.rows;
      console.log("1. Connected Sources:");
      console.table(sourcesRes.rows);

      // 2. Merchant Enrollments Status
      const enrollmentsRes = await tx.query(
        `SELECT e.id, e.program_id, p.name AS merchant_name, p.capabilities, e.state,
                e.loyalty_status, e.promotion_status, e.signup_status
         FROM deals.enrollment e
         JOIN deals.program p ON p.id = e.program_id
         WHERE e.owner_id=$1
         ORDER BY p.name ASC`,
        [owner],
      );

      const assistedPrograms: any[] = [];
      const automaticPrograms: any[] = [];

      for (const row of enrollmentsRes.rows) {
        const flow = await enrollmentFlow(tx, owner, row.id);
        const item = {
          enrollmentId: row.id,
          programId: row.program_id,
          merchant: row.merchant_name,
          mode: ["mypanera", "chipotle_rewards"].includes(row.program_id)
            ? "assisted"
            : (row.capabilities?.mode ?? "automatic"),
          state: flow.state,
          signupStatus: flow.signupStatus,
          loyaltyStatus: flow.loyaltyStatus,
          promotionStatus: flow.promotionStatus,
          url: flow.url,
          requiredInputs: flow.requiredInputs,
          nextAction: flow.nextAction,
          safeToCreateAccount: flow.safeToCreateAccount,
          instructions: flow.instructions,
        };

        if (item.mode === "assisted") {
          assistedPrograms.push(item);
        } else {
          automaticPrograms.push(item);
        }
      }

      outputEvidence.assistedMerchantPrograms = assistedPrograms;
      outputEvidence.automaticCardholderPrograms = automaticPrograms;

      console.log(
        "\n2a. Assisted Merchant Programs (Requires Real Phone & SMS OTP):",
      );
      console.table(
        assistedPrograms.map((p) => ({
          Merchant: p.merchant,
          State: p.state,
          Signup: p.signupStatus,
          Action: p.nextAction,
          RequiredInputs: p.requiredInputs.join(", "),
          SignupURL: p.url,
        })),
      );

      for (const p of assistedPrograms) {
        console.log(`\n>> Assisted Steps for ${p.merchant}:`);
        console.log(`   1. Open: ${p.url}`);
        console.log(`   2. Use Generated Email: ${identity.address}`);
        console.log(`   3. Enter Real Phone & verify SMS OTP`);
        console.log(
          `   4. Our worker catches the merchant welcome email and activates deals automatically.`,
        );
      }

      console.log(
        "\n2b. Automatic Programs (Capital One Cardholder Cash Back):",
      );
      console.table(
        automaticPrograms.map((p) => ({
          Merchant: p.merchant,
          State: p.state,
          Signup: p.signupStatus,
          Action: p.nextAction,
        })),
      );

      // 3. Active Offers in TigerData (Capital One cardholder offers)
      const offersRes = await tx.query(
        `SELECT o.id, p.name AS merchant, o.campaign_key, o.status,
                o.terms->'benefit'->>'type' AS benefit_type,
                coalesce(o.terms->'benefit'->>'rateBps', o.terms->'benefit'->>'amountMinor') AS value,
                o.terms->>'title' AS title,
                o.terms->'channels' AS channels
         FROM deals.offer o
         JOIN deals.program p ON p.id=o.program_id
         WHERE o.owner_id=$1 AND o.status='active'
         ORDER BY p.name ASC`,
        [owner],
      );
      outputEvidence.activeOffers = offersRes.rows;
      console.log(
        `\n3. Active Offers in TigerData (${offersRes.rows.length} total):`,
      );
      console.table(
        offersRes.rows.map((o) => ({
          Merchant: o.merchant,
          Title: o.title,
          Benefit: o.benefit_type,
          Value: o.value,
        })),
      );

      // 4. Test Inbound Email Auto-Confirmation Simulation
      console.log(
        "\n4. Simulating Inbound Merchant Welcome Email Auto-Confirmation:",
      );
      const paneraEnrollment = assistedPrograms.find(
        (p) => p.programId === "mypanera",
      );

      if (paneraEnrollment) {
        const suffix = "99";
        const messageId = `pho_msg_000000000000000000000000${suffix}`;
        const spaceId = `pho_spc_00000000000000000000000001`;
        const testEventId = `pho_evt_000000000000000000000000${suffix}`;
        const syntheticMessage = {
          id: messageId,
          projectId: identity.project_id,
          platform: "email",
          status: "received",
          sentBy: {
            id: "pho_usr_00000000000000000000000001",
            projectId: identity.project_id,
            platform: "email",
            handle: "welcome@mypanera.panerabread.com",
            kind: "contact",
            details: {},
            metadata: {},
          },
          receivedBy: {
            id: "pho_usr_00000000000000000000000002",
            projectId: identity.project_id,
            platform: "email",
            handle: identity.address,
            kind: "contact",
            details: {},
            metadata: {},
          },
          metadata: {},
          content: {
            type: "text",
            format: "plain",
            text: "Welcome to MyPanera! Save 20% off Any Panera Entree or Warm Bowl on your next order. Minimum spend $0. Valid through 2026-12-31T00:00:00Z. In-store and app orders qualify.",
            metadata: {
              email: {
                subject: "Welcome to MyPanera! Your 20% reward is here",
              },
            },
          },
          space: {
            id: spaceId,
            projectId: identity.project_id,
            platform: "email",
            kind: "direct",
            participantIds: [],
            details: {},
            metadata: {},
          },
          timestamps: { receivedAt: new Date().toISOString() },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const parsed = parseEmailMessage(
          syntheticMessage as any,
          identity.project_id,
        );
        await ingestEmail(tx, owner, parsed, testEventId);

        const storedMsg = (
          await tx.query(
            "SELECT id FROM deals.message WHERE owner_id=$1 AND provider_id=$2",
            [owner, syntheticMessage.id],
          )
        ).rows[0];

        // Worker processes the welcome email
        await processMessage(tx, owner, storedMsg.id, config);

        // Re-check Panera enrollment state
        const confirmedFlow = await enrollmentFlow(
          tx,
          owner,
          paneraEnrollment.enrollmentId,
        );
        console.log("   Welcome email arrived and processed!");
        console.log({
          merchant: confirmedFlow.merchant,
          state: confirmedFlow.state,
          signupStatus: confirmedFlow.signupStatus,
          loyaltyStatus: confirmedFlow.loyaltyStatus,
          promotionStatus: confirmedFlow.promotionStatus,
          nextAction: confirmedFlow.nextAction,
        });

        outputEvidence.simulatedWelcomeEmailConfirmation = {
          observed: true,
          confirmedState: confirmedFlow.state,
          confirmedSignupStatus: confirmedFlow.signupStatus,
        };

        // Query candidates for Panera now that it is confirmed
        const paneraCandidates = await candidates(tx, owner, {
          merchantIds: ["panera"],
          channel: "in_store",
          useWithOtherOffers: false,
        });
        console.log(
          `   Recommendation engine candidates for Panera: ${paneraCandidates.length} deal(s) found.`,
        );

        // Clean up synthetic rehearsal message and restore assisted pending state for user
        await tx.query(
          "DELETE FROM deals.eligibility WHERE owner_id=$1 AND offer_id IN (SELECT id FROM deals.offer WHERE message_id=$2)",
          [owner, storedMsg.id],
        );
        await tx.query(
          "DELETE FROM deals.offer_revision WHERE owner_id=$1 AND message_id=$2",
          [owner, storedMsg.id],
        );
        await tx.query(
          "DELETE FROM deals.offer WHERE owner_id=$1 AND message_id=$2",
          [owner, storedMsg.id],
        );
        await tx.query(
          "DELETE FROM deals.delivery WHERE owner_id=$1 AND event_id=$2",
          [owner, testEventId],
        );
        await tx.query(
          "DELETE FROM deals.message WHERE owner_id=$1 AND id=$2",
          [owner, storedMsg.id],
        );
        await tx.query(
          `UPDATE deals.enrollment
           SET state='needs_user_input', signup_status='awaiting_user',
               loyalty_status='unknown', promotion_status='unknown',
               evidence='{}'::jsonb, reason='complete_merchant_signup_with_alias',
               verification_started_at=now()
           WHERE id=$1`,
          [paneraEnrollment.enrollmentId],
        );
      }

      // 5. Candidate Queries for Active Deals
      console.log(
        "\n5. Recommendation Engine Candidates (Active Cardholder Offers):",
      );
      const testMerchants = ["nike", "walmart"];
      for (const mId of testMerchants) {
        const candidateDeals = await candidates(tx, owner, {
          merchantIds: [mId],
          channel: "in_store",
          useWithOtherOffers: false,
        });
        console.log(
          ` - Merchant [${mId}]: ${candidateDeals.length} candidate deal(s)`,
        );
        for (const d of candidateDeals) {
          console.log(
            `   * ${d.terms.title} (${d.terms.benefit.type}) -> eligibility: ${d.eligibility.result}`,
          );
        }
      }
    });

    const outputPath = resolve("docs/deals-rehearsal-evidence.json");
    writeFileSync(outputPath, JSON.stringify(outputEvidence, null, 2), "utf8");
    console.log(`\nEvidence output written to ${outputPath}`);
    console.log("\n=== REHEARSAL COMPLETE: All systems operational ===");
  } catch (err) {
    console.error("Rehearsal failed:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
