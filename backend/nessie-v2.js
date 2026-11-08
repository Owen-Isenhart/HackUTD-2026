const { setTimeout: wait } = require("node:timers/promises");
const { fail } = require("./pipeline-utils");
const id = (value, prefix) => {
  if (
    typeof value !== "string" ||
    !new RegExp("^" + prefix + "_[0-9a-z]{26}$").test(value)
  )
    throw fail("invalid_nessie_id");
  return value;
};
function createNessieV2({
  baseUrl = "https://v2-prod-api.nessieisreal.com",
  apiKey,
  fetchImpl = fetch,
  waitImpl = wait,
} = {}) {
  const origin = new URL(baseUrl);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw fail("invalid_nessie_origin");
  async function request(path, params = {}, body) {
    if (!apiKey) throw fail("nessie_not_configured", 503);
    const url = new URL(path, origin);
    for (const [k, v] of Object.entries(params))
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await fetchImpl(url, {
          method: body ? "POST" : "GET",
          headers: {
            Authorization: "Bearer " + apiKey,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          redirect: "error",
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        throw fail("nessie_unreachable", 503);
      }
      if (res.status === 429) {
        if (attempt === 2) throw fail("nessie_rate_limited", 503);
        const retry = res.headers.get("retry-after");
        const seconds = Number(retry);
        const ms = Number.isFinite(seconds)
          ? seconds * 1000
          : Math.max(0, Date.parse(retry) - Date.now());
        if (!Number.isFinite(ms) || ms > 60000)
          throw fail("nessie_rate_limited", 503);
        await waitImpl(ms + 500);
        continue;
      }
      if (!res.ok) {
        const problem = await res.json().catch(() => ({}));
        throw fail(
          typeof problem.type === "string"
            ? problem.type
            : "nessie_http_" + res.status,
          503,
        );
      }
      return res.json();
    }
  }
  const rows = (page) =>
    Array.isArray(page) ? page : (page.data ?? page.items ?? []);
  async function pages(path, cap = 1000) {
    let cursor,
      all = [];
    const seen = new Set();
    for (let n = 0; n < cap; n++) {
      const page = await request(path, { limit: 100, cursor });
      all.push(...rows(page));
      cursor = page.next_cursor;
      if (!cursor) return all;
      if (seen.has(cursor)) throw fail("nessie_cursor_loop", 503);
      seen.add(cursor);
    }
    throw fail("nessie_page_cap", 503);
  }
  return {
    request,
    rows,
    listCustomers: () => pages("/customers", 5),
    customerAccounts: (c) => pages("/customers/" + id(c, "cust") + "/accounts"),
    account: (a) => request("/accounts/" + id(a, "acct")),
    accountTransactions: async (a, { limit = 5000 } = {}) =>
      rows(
        await request("/accounts/" + id(a, "acct") + "/transactions", {
          limit,
        }),
      ),
    tenantTransactions: (p) => request("/transactions", p),
    bills: (a) => pages("/accounts/" + id(a, "acct") + "/bills"),
    loans: (a) => pages("/accounts/" + id(a, "acct") + "/loans"),
    merchants: () => pages("/merchants"),
    events: ({ after, accountId, limit = 100 }) =>
      request("/events", { after, account_id: id(accountId, "acct"), limit }),
    createMerchant: (body) => request("/merchants", {}, body),
  };
}
module.exports = { createNessieV2 };
