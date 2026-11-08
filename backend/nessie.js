const NESSIE_ORIGIN = 'https://prod-api.nessieisreal.com';

async function readNessie({ accountId, apiKey, fetchImpl = fetch }) {
  if (!accountId || !apiKey) throw new Error('Set NESSIE_ACCOUNT_ID and NESSIE_API_KEY.');
  if (!/^[a-z0-9-]+$/i.test(accountId)) throw new Error('NESSIE_ACCOUNT_ID is invalid.');

  async function get(path, resource) {
    const url = new URL(path, NESSIE_ORIGIN);
    url.searchParams.set('key', apiKey);
    let response;
    try {
      response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    } catch {
      throw new Error(`Nessie ${resource} request failed.`);
    }
    if (!response.ok) throw new Error(`Nessie ${resource} returned HTTP ${response.status}.`);
    try {
      return await response.json();
    } catch {
      throw new Error(`Nessie ${resource} returned invalid JSON.`);
    }
  }

  const path = `/accounts/${encodeURIComponent(accountId)}`;
  const [account, purchases, bills, deposits] = await Promise.allSettled([
    get(path, 'account'),
    get(`${path}/purchases`, 'purchases'),
    get(`${path}/bills`, 'bills'),
    get(`${path}/deposits`, 'deposits'),
  ]);
  if (account.status === 'rejected') throw account.reason;
  if (purchases.status === 'rejected') throw purchases.reason;
  if (account.value?._id !== accountId || !Array.isArray(purchases.value)) {
    throw new Error('Nessie returned an unexpected account or purchase response.');
  }

  function countRecords(result) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) return result.value.length;
    return null;
  }

  return {
    account: account.value,
    purchases: purchases.value,
    billCount: countRecords(bills),
    depositCount: countRecords(deposits),
    async getMerchants(merchantIds) {
      const merchants = new Map();
      for (let i = 0; i < merchantIds.length; i += 6) {
        await Promise.all(merchantIds.slice(i, i + 6).map(async (id) => {
          if (!/^[a-z0-9-]+$/i.test(id)) return;
          try {
            const merchant = await get(`/merchants/${encodeURIComponent(id)}`, 'merchant');
            if (merchant?._id === id && typeof merchant.name === 'string' && merchant.name.trim()) {
              merchants.set(id, { name: merchant.name.trim(), category: merchant.category });
            }
          } catch {
            // Keep the purchase in spending totals. Its merchant stays unresolved.
          }
        }));
      }
      return merchants;
    },
  };
}

module.exports = { readNessie };
