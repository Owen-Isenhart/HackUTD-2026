const fs = require("node:fs");
async function rehearse({ baseUrl, firstName, lastName, last4, fix }) {
  const call = async (path, token, body) => {
    const r = await fetch(new URL(path, baseUrl), {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw Error("rehearsal_http_" + r.status);
    return r.json();
  };
  const start = Date.now(),
    identified = await call("/api/v1/onboarding/identify", null, {
      firstName,
      lastName,
      last4,
    });
  let stages = [];
  for (let i = 0; i < 120; i++) {
    const run = await call(
      "/api/v1/pipeline/runs/" + identified.runId,
      identified.session.token,
    );
    stages = run.stages;
    if (stages.every((s) => ["completed", "skipped", "dead"].includes(s.state)))
      break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const result = await call(
    "/api/finance-recommendation",
    identified.session.token,
    { source: "demo", fix: { coords: fix, timestamp: Date.now() } },
  );
  return {
    status: stages.some((s) => s.state === "dead")
      ? "failed"
      : stages.every((s) => ["completed", "skipped"].includes(s.state))
        ? "finished"
        : "timed_out",
    durationMs: Date.now() - start,
    stages: stages.map((s) => ({
      kind: s.kind,
      state: s.state,
      summary: s.summary,
      error: s.last_error,
      finishedAt: s.updated_at,
    })),
    recommendation: result.recommendation
      ? {
          payableCents: result.recommendation.payableCents,
          labels: result.recommendation.labels,
        }
      : null,
    reason: result.reason || null,
  };
}
if (require.main === module) {
  (async () => {
    const configured =
      process.env.PIPELINE_REHEARSAL_URL &&
      process.env.PIPELINE_DEMO_FIRST_NAME &&
      process.env.PIPELINE_DEMO_LAST_NAME &&
      process.env.PIPELINE_DEMO_LAST4;
    const result = configured
      ? await rehearse({
          baseUrl: process.env.PIPELINE_REHEARSAL_URL,
          firstName: process.env.PIPELINE_DEMO_FIRST_NAME,
          lastName: process.env.PIPELINE_DEMO_LAST_NAME,
          last4: process.env.PIPELINE_DEMO_LAST4,
          fix: {
            latitude: Number(process.env.PIPELINE_DEMO_LAT),
            longitude: Number(process.env.PIPELINE_DEMO_LON),
            accuracy: 10,
          },
        })
      : {
          status: "blocked",
          reason:
            "Configure PIPELINE_REHEARSAL_URL and demo inputs; live services are not configured in this checkout",
        };
    fs.writeFileSync(
      "docs/pipeline-rehearsal.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(result.status);
  })().catch(() => {
    console.error("Rehearsal unavailable; no credentials logged.");
    process.exitCode = 1;
  });
}
module.exports = { rehearse };
