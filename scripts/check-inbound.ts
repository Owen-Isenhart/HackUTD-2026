import { readFile, writeFile } from "node:fs/promises";
import { config } from "../src/config.js";
import { poolFor, tenant } from "../src/db.js";
import { PhotonClient } from "../src/photon.js";
const subject = process.argv[2] ?? "DEALS-INBOUND-TEST";
const { owner } = JSON.parse(
  await readFile(".local/deals-debug-session.json", "utf8"),
);
const client = new PhotonClient(config);
const page = await client.listMessages({
  platform: "email",
  direction: "received",
  order: "desc",
  pageSize: "100",
});
const matching = page.items.filter(
  (m: any) => m.content?.metadata?.email?.subject === subject,
);
const pool = poolFor(config.WORKER_DATABASE_URL!);
try {
  const stored = await tenant(pool, owner, async (tx) => {
    const messages = (
      await tx.query(
        "SELECT id,provider_id,received_at,created_at,classification FROM deals.message WHERE owner_id=$1 AND subject=$2",
        [owner, subject],
      )
    ).rows;
    const traces = [];
    for (const m of messages) {
      const deliveries = (
        await tx.query(
          "SELECT event_id,accepted_at FROM deals.delivery WHERE owner_id=$1 AND message_id=$2 ORDER BY accepted_at",
          [owner, m.id],
        )
      ).rows;
      const jobs = (
        await tx.query(
          "SELECT state,attempts,last_error FROM deals.job WHERE owner_id=$1 AND kind='extract' AND payload->>'messageId'=$2",
          [owner, m.id],
        )
      ).rows;
      traces.push({
        messageId: m.id,
        providerMessageId: m.provider_id,
        receivedAt: m.received_at,
        storedAt: m.created_at,
        receiveToStoreMs:
          new Date(m.created_at).getTime() - new Date(m.received_at).getTime(),
        classification: m.classification,
        signedWebhookObserved: deliveries.some((d) =>
          d.event_id.startsWith("pho_evt_"),
        ),
        reconciliationObserved: deliveries.some((d) =>
          d.event_id.startsWith("reconcile:"),
        ),
        extractionJobs: jobs,
      });
    }
    return traces;
  });
  const report = {
    observedAt: new Date().toISOString(),
    subject,
    actualUserSentEmail: true,
    providerMatches: matching.map((m: any) => ({
      id: m.id,
      status: m.status,
      receivedByAvailable: !!m.receivedBy,
      format: m.content?.format,
      originalHtmlAvailable:
        typeof m.content?.metadata?.email?.originalHtml === "string",
    })),
    stored,
    complete:
      matching.length > 0 &&
      stored.some(
        (m) =>
          m.signedWebhookObserved &&
          m.extractionJobs.some((j) => j.state === "completed"),
      ),
  };
  await writeFile(
    "docs/deals-inbound-evidence.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  if (!report.complete) process.exitCode = 1;
} finally {
  await pool.end();
}
