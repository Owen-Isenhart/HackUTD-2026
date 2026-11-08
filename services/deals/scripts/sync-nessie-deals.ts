/** Deprecated: the finance pipeline now imports owner-scoped Nessie v2 data.
 * This compatibility entry point queues that pipeline; it never reads tenant-wide
 * transactions or relabels sandbox purchases as verified imports.
 */
async function main() {
  const base = new URL(process.env.FINANCE_API_URL || "http://127.0.0.1:8787");
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    (base.protocol !== "https:" &&
      !(
        base.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(base.hostname)
      ))
  )
    throw Error("invalid_finance_origin");
  const token =
    process.env.FINANCE_SESSION_TOKEN || process.env.FINANCE_DEMO_TOKEN;
  if (!token) throw Error("finance_session_required");
  const response = await fetch(new URL("/api/v1/finance/sync", base), {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: "{}",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw Error("finance_sync_http_" + response.status);
  const body: any = await response.json();
  console.log(
    JSON.stringify({
      runId: body.runId,
      status: "queued",
      notice: "Sandbox observations cannot start a real signup.",
    }),
  );
}
main().catch(() => {
  console.error(
    "Finance sync unavailable. Configure FINANCE_API_URL and FINANCE_SESSION_TOKEN (or an operator-bound FINANCE_DEMO_TOKEN).",
  );
  process.exitCode = 1;
});
export {};
