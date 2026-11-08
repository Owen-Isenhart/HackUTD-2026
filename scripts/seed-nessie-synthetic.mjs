import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

// Load local environment files
loadEnvFile(path.resolve(process.cwd(), ".env.deals.local"));
loadEnvFile(path.resolve(process.cwd(), ".env.deals.runtime.local"));
loadEnvFile(path.resolve(process.cwd(), ".env.example"));

const BASE_URL = process.env.NESSIE_API_BASE_URL || "https://v2-prod-api.nessieisreal.com";
const API_KEY = process.env.NESSIE_API_KEY;

if (!API_KEY) {
  console.error("Error: NESSIE_API_KEY not found in environment or .env files.");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

async function api(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  let attempt = 0;
  while (attempt < 5) {
    attempt++;
    const res = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers },
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") || "3");
      console.log(`[429] Rate limited. Pausing for ${retryAfter}s before retry...`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000 + 500));
      continue;
    }

    if (res.status === 204) return null;

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Nessie API ${options.method || "GET"} ${endpoint} returned HTTP ${res.status}: ${text}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  throw new Error(`Nessie API ${endpoint} failed after max retries`);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("==========================================================");
  console.log("   Nessie v2 Comprehensive Synthetic Data Generator       ");
  console.log("==========================================================");
  console.log(`Endpoint: ${BASE_URL}`);
  console.log(`Key Prefix: ${API_KEY.slice(0, 8)}...`);

  // Step 1: Clean slate
  console.log("\n[1/7] Clearing previous tenant data via DELETE /data...");
  const purgeRes = await api("/data", { method: "DELETE" });
  console.log("Purge result:", purgeRes || "Done");
  await sleep(1000);

  // Step 2: Historical simulation spanning 2 full years (63,072,000s) with 2,500 transactions
  console.log("\n[2/7] Starting historical simulation for 1 customer across 2 years (2,500 transactions)...");
  const simReq = {
    mode: "historical",
    customers: 1,
    transactions: 2500,
    duration_seconds: 63072000, // 2 full years (730 days) of realistic history
    anomaly_rate: 0.02,
    seed: 2026,
  };
  const sim = await api("/simulations", {
    method: "POST",
    body: JSON.stringify(simReq),
  });
  console.log(`Simulation queued with ID: ${sim.id}`);

  let simStatus = sim;
  let elapsed = 0;
  while (simStatus.status === "queued" || simStatus.status === "running") {
    await sleep(2500);
    elapsed += 2.5;
    process.stdout.write(`\rGenerating banking history... (${elapsed.toFixed(1)}s elapsed)`);
    simStatus = await api(`/simulations/${sim.id}`);
  }
  console.log(`\nSimulation finished with status: ${simStatus.status}`);
  console.log(`Generated: ${simStatus.generated} transactions, ${simStatus.anomalies} anomalies`);

  // Step 3: Fetch and personalize customer
  console.log("\n[3/7] Customizing customer profile...");
  const customersRes = await api("/customers");
  // Find the primary customer (not the Encounter LLC network settlement entity)
  const primaryCustomer = customersRes.items.find((c) => c.last_name !== "LLC") || customersRes.items[0];
  console.log(`Primary Customer ID: ${primaryCustomer.id} (${primaryCustomer.first_name} ${primaryCustomer.last_name})`);

  // Update primary customer to Alex Taylor in Richardson, TX (UT Dallas area)
  const updatedCustomer = await api(`/customers/${primaryCustomer.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      first_name: "Alex",
      last_name: "Taylor",
      address: {
        street_number: "800",
        street_name: "W Campbell Rd",
        city: "Richardson",
        state: "TX",
        zip: "75080",
      },
    }),
  });
  console.log(`Updated customer: ${updatedCustomer.first_name} ${updatedCustomer.last_name}, Richardson, TX 75080`);

  // Step 4: Customize accounts
  console.log("\n[4/7] Customizing accounts...");
  const accountsRes = await api(`/customers/${primaryCustomer.id}/accounts`);
  let checking = accountsRes.items.find((a) => a.type === "Checking");
  let creditCard = accountsRes.items.find((a) => a.type === "Credit Card");

  if (checking) {
    checking = await api(`/accounts/${checking.id}`, {
      method: "PATCH",
      body: JSON.stringify({ nickname: "Everyday Checking" }),
    });
    console.log(`Checking Account: ${checking.nickname} (${checking.id}), Balance: $${(checking.balance_cents / 100).toFixed(2)}`);
  }

  if (creditCard) {
    creditCard = await api(`/accounts/${creditCard.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        nickname: "Capital One SavorOne Rewards",
        credit_limit_cents: 1000000, // $10,000 credit limit
      }),
    });
    console.log(`Credit Card: ${creditCard.nickname} (${creditCard.id}), Limit: $${(creditCard.credit_limit_cents / 100).toFixed(2)}, Balance: $${(creditCard.balance_cents / 100).toFixed(2)}`);
  }

  // Add High Yield Savings Account
  console.log("Creating High Yield Savings Account...");
  const savings = await api(`/customers/${primaryCustomer.id}/accounts`, {
    method: "POST",
    body: JSON.stringify({
      type: "Savings",
      nickname: "High Yield Savings",
      balance_cents: 1250000, // $12,500.00
      rewards: 0,
    }),
  });
  console.log(`Savings Account: ${savings.nickname} (${savings.id}), Balance: $${(savings.balance_cents / 100).toFixed(2)}`);

  // Step 5: Update generated merchants to match project brands
  console.log("\n[5/7] Updating merchants and creating project brands...");
  const merchantsRes = await api("/merchants");
  const simMerchants = merchantsRes.items;
  console.log(`Found ${simMerchants.length} merchants created by simulation.`);

  // Brand mapping for simulated merchants
  const brandProfiles = [
    {
      name: "Starbucks Coffee",
      category: "coffee",
      address: { street_number: "800", street_name: "W Campbell Rd (Student Union)", city: "Richardson", state: "TX", zip: "75080" },
      geocode: { lat: 32.98666, lng: -96.74888 },
    },
    {
      name: "Bluebird Coffee Roasters",
      category: "coffee",
      address: { street_number: "1201", street_name: "King St", city: "Richardson", state: "TX", zip: "75080" },
      geocode: { lat: 32.975, lng: -96.73 },
    },
    {
      name: "Walmart Supercenter",
      category: "groceries",
      address: { street_number: "15757", street_name: "Coit Rd", city: "Dallas", state: "TX", zip: "75248" },
      geocode: { lat: 32.963, lng: -96.77 },
    },
    {
      name: "Target",
      category: "groceries",
      address: { street_number: "16731", street_name: "Coit Rd", city: "Dallas", state: "TX", zip: "75248" },
      geocode: { lat: 32.974, lng: -96.771 },
    },
    {
      name: "Shell Fuel",
      category: "gas",
      address: { street_number: "500", street_name: "S Glebe Rd", city: "Richardson", state: "TX", zip: "75080" },
      geocode: { lat: 32.97, lng: -96.72 },
    },
    {
      name: "Chevron Fuel",
      category: "gas",
      address: { street_number: "6300", street_name: "Central Expy", city: "Richardson", state: "TX", zip: "75080" },
      geocode: { lat: 32.965, lng: -96.715 },
    },
    {
      name: "Booking.com Travel",
      category: "travel",
      address: { street_number: "28", street_name: "Liberty St", city: "New York", state: "NY", zip: "10005" },
      geocode: { lat: 40.7081, lng: -74.008 },
    },
    {
      name: "Best Buy",
      category: "electronics",
      address: { street_number: "2800", street_name: "N Central Expy", city: "Plano", state: "TX", zip: "75074" },
      geocode: { lat: 33.036, lng: -96.705 },
    },
    {
      name: "Nike Store",
      category: "retail",
      address: { street_number: "8687", street_name: "N Central Expy", city: "Dallas", state: "TX", zip: "75225" },
      geocode: { lat: 32.868, lng: -96.773 },
    },
    {
      name: "The Home Depot",
      category: "retail",
      address: { street_number: "1200", street_name: "N Central Expy", city: "Plano", state: "TX", zip: "75074" },
      geocode: { lat: 33.018, lng: -96.711 },
    },
    {
      name: "Sephora",
      category: "retail",
      address: { street_number: "6121", street_name: "W Park Blvd", city: "Plano", state: "TX", zip: "75093" },
      geocode: { lat: 33.03, lng: -96.825 },
    },
  ];

  for (let i = 0; i < Math.min(simMerchants.length, brandProfiles.length); i++) {
    const target = brandProfiles[i];
    await api(`/merchants/${simMerchants[i].id}`, {
      method: "PATCH",
      body: JSON.stringify(target),
    });
    console.log(`  Updated merchant ${simMerchants[i].id} -> ${target.name} (${target.category})`);
    await sleep(60);
  }

  // Create additional specific merchants required by the app
  const additionalMerchants = [
    {
      name: "Chipotle Mexican Grill",
      category: "restaurant",
      address: { street_number: "283", street_name: "W Campbell Rd", city: "Richardson", state: "TX", zip: "75080" },
      geocode: { lat: 32.97504, lng: -96.72106 },
    },
    {
      name: "Chick-fil-A",
      category: "restaurant",
      address: { street_number: "800", street_name: "W Campbell Rd (Student Union)", city: "Richardson", state: "TX", zip: "75080" },
      geocode: { lat: 32.98666, lng: -96.74888 },
    },
    {
      name: "Panera Bread",
      category: "restaurant",
      address: { street_number: "1405", street_name: "E Campbell Rd", city: "Richardson", state: "TX", zip: "75081" },
      geocode: { lat: 32.979, lng: -96.7 },
    },
    {
      name: "Uber Eats",
      category: "restaurant",
      address: { street_number: "1515", street_name: "3rd St", city: "San Francisco", state: "CA", zip: "94158" },
      geocode: { lat: 37.7749, lng: -122.4194 },
    },
    {
      name: "Lululemon",
      category: "retail",
      address: { street_number: "8687", street_name: "N Central Expy", city: "Dallas", state: "TX", zip: "75225" },
      geocode: { lat: 32.868, lng: -96.773 },
    },
    {
      name: "Macy's",
      category: "retail",
      address: { street_number: "6121", street_name: "W Park Blvd", city: "Plano", state: "TX", zip: "75093" },
      geocode: { lat: 33.029, lng: -96.827 },
    },
  ];

  const createdExtraMerchants = [];
  for (const m of additionalMerchants) {
    const created = await api("/merchants", {
      method: "POST",
      body: JSON.stringify(m),
    });
    createdExtraMerchants.push(created);
    console.log(`  Created merchant ${created.name} (${created.id})`);
    await sleep(60);
  }

  // Anchor recent purchases on the credit card for Chipotle, Starbucks, Chick-fil-A, Panera
  console.log("\n[6/7] Creating anchor purchases, bills and loans...");
  const chipotle = createdExtraMerchants.find((m) => m.name === "Chipotle Mexican Grill");
  const cfa = createdExtraMerchants.find((m) => m.name === "Chick-fil-A");
  const panera = createdExtraMerchants.find((m) => m.name === "Panera Bread");
  const starbucks = simMerchants[0]; // Updated to Starbucks Coffee

  const targetAccount = creditCard || checking;

  if (chipotle && targetAccount) {
    await api(`/accounts/${targetAccount.id}/purchases`, {
      method: "POST",
      body: JSON.stringify({
        merchant_id: chipotle.id,
        amount_cents: 1475,
        description: "CHIPOTLE 1283 CAMPBELL RD RICHARDSON TX",
      }),
    });
    console.log(`  Added recent purchase at Chipotle ($14.75)`);
  }

  if (starbucks && targetAccount) {
    await api(`/accounts/${targetAccount.id}/purchases`, {
      method: "POST",
      body: JSON.stringify({
        merchant_id: starbucks.id,
        amount_cents: 645,
        description: "STARBUCKS #11422 UTD STUDENT UNION RICHARDSON TX",
      }),
    });
    console.log(`  Added recent purchase at Starbucks ($6.45)`);
  }

  if (cfa && targetAccount) {
    await api(`/accounts/${targetAccount.id}/purchases`, {
      method: "POST",
      body: JSON.stringify({
        merchant_id: cfa.id,
        amount_cents: 1125,
        description: "CHICK-FIL-A #03822 UTD CAMPUS RICHARDSON TX",
      }),
    });
    console.log(`  Added recent purchase at Chick-fil-A ($11.25)`);
  }

  if (panera && targetAccount) {
    await api(`/accounts/${targetAccount.id}/purchases`, {
      method: "POST",
      body: JSON.stringify({
        merchant_id: panera.id,
        amount_cents: 1680,
        description: "PANERA BREAD #2041 E CAMPBELL RICHARDSON TX",
      }),
    });
    console.log(`  Added recent purchase at Panera Bread ($16.80)`);
  }

  // Create Monthly Recurring Bills on the Checking Account
  const billsToCreate = [
    {
      payee: "Cortland Apartments",
      nickname: "Apartment Rent - Cortland Campbell",
      payment_amount: 1450.0,
      recurring_date: 1,
      status: "recurring",
    },
    {
      payee: "TXU Energy",
      nickname: "Electric Utility - TXU",
      payment_amount: 115.5,
      recurring_date: 12,
      status: "recurring",
    },
    {
      payee: "AT&T",
      nickname: "Home Internet - AT&T Fiber 1Gbps",
      payment_amount: 70.0,
      recurring_date: 18,
      status: "recurring",
    },
    {
      payee: "Verizon Wireless",
      nickname: "Mobile Phone - Unlimited Plus",
      payment_amount: 85.0,
      recurring_date: 22,
      status: "recurring",
    },
    {
      payee: "Geico Insurance",
      nickname: "Auto Insurance - Comprehensive",
      payment_amount: 135.0,
      recurring_date: 25,
      status: "recurring",
    },
    {
      payee: "Spotify",
      nickname: "Spotify Premium Family",
      payment_amount: 11.99,
      recurring_date: 15,
      status: "recurring",
    },
  ];

  for (const b of billsToCreate) {
    const createdBill = await api(`/accounts/${checking.id}/bills`, {
      method: "POST",
      body: JSON.stringify(b),
    });
    console.log(`  Created recurring bill: ${createdBill.nickname} ($${createdBill.payment_amount}/mo, day ${createdBill.recurring_date})`);
    await sleep(60);
  }

  // Create Loan attached to Checking Account
  const loanToCreate = {
    type: "Student Loan",
    status: "in_repayment",
    credit_score: 745,
    amount_cents: 1850000, // $18,500.00
    monthly_payment_cents: 22500, // $225.00/mo
    description: "Federal Direct Student Loan - Standard 10-Yr Plan",
  };
  const createdLoan = await api(`/accounts/${checking.id}/loans`, {
    method: "POST",
    body: JSON.stringify(loanToCreate),
  });
  console.log(`  Created loan: ${createdLoan.type} ($${(createdLoan.amount_cents / 100).toFixed(2)}, credit score ${createdLoan.credit_score})`);

  // Step 7: Gather final audit and transaction metrics
  console.log("\n[7/7] Gathering final synthetic data audit...");
  const finalAccounts = await api(`/customers/${primaryCustomer.id}/accounts`);
  const finalBills = await api(`/accounts/${checking.id}/bills`);
  const finalLoans = await api(`/accounts/${checking.id}/loans`);
  const allMerchants = await api("/merchants");

  // Read transactions sample and date range
  const txnsPage1 = await api(`/transactions?limit=100`);
  const latestTxn = txnsPage1.items[0];
  const oldestTxn = txnsPage1.items[txnsPage1.items.length - 1];

  const evidence = {
    generatedAt: new Date().toISOString(),
    customer: {
      id: updatedCustomer.id,
      name: `${updatedCustomer.first_name} ${updatedCustomer.last_name}`,
      address: updatedCustomer.address,
    },
    accounts: finalAccounts.items.map((a) => ({
      id: a.id,
      type: a.type,
      nickname: a.nickname,
      balance_cents: a.balance_cents,
      balance_formatted: `$${(a.balance_cents / 100).toFixed(2)}`,
      credit_limit_cents: a.credit_limit_cents,
      credit_limit_formatted: a.credit_limit_cents ? `$${(a.credit_limit_cents / 100).toFixed(2)}` : null,
      available_cents: a.available_cents,
      available_formatted: `$${(a.available_cents / 100).toFixed(2)}`,
    })),
    bills: finalBills.items.map((b) => ({
      id: b.id,
      payee: b.payee,
      nickname: b.nickname,
      payment_amount: b.payment_amount,
      recurring_date: b.recurring_date,
      status: b.status,
    })),
    loans: finalLoans.items.map((l) => ({
      id: l.id,
      type: l.type,
      amount_cents: l.amount_cents,
      amount_formatted: `$${(l.amount_cents / 100).toFixed(2)}`,
      monthly_payment_cents: l.monthly_payment_cents,
      monthly_payment_formatted: `$${(l.monthly_payment_cents / 100).toFixed(2)}`,
      credit_score: l.credit_score,
      status: l.status,
    })),
    merchantsCount: allMerchants.items.length,
    merchantsSample: allMerchants.items.map((m) => ({
      id: m.id,
      name: m.name,
      category: m.category,
      city: m.address?.city,
      state: m.address?.state,
      geocode: m.geocode,
    })),
    transactions: {
      totalSimulated: simStatus.generated,
      latestDate: latestTxn?.created_at,
      oldestInFirst100: oldestTxn?.created_at,
      sampleLatest: txnsPage1.items.slice(0, 5).map((t) => ({
        id: t.id,
        kind: t.kind,
        description: t.description,
        amount_cents: t.amount_cents,
        amount_formatted: `$${(t.amount_cents / 100).toFixed(2)}`,
        created_at: t.created_at,
      })),
    },
  };

  const evidencePath = path.resolve(process.cwd(), "docs/nessie-synthetic-evidence.json");
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(`\nAudit evidence saved to: ${evidencePath}`);

  console.log("\n==========================================================");
  console.log("             SYNTHETIC DATA CREATION COMPLETE             ");
  console.log("==========================================================");
  console.log(`Customer: ${evidence.customer.name} (${evidence.customer.id})`);
  console.log("Accounts:");
  for (const acct of evidence.accounts) {
    console.log(`  - [${acct.type}] ${acct.nickname}: ${acct.balance_formatted} (ID: ${acct.id})`);
  }
  console.log(`Recurring Monthly Bills: ${evidence.bills.length}`);
  console.log(`Active Loans: ${evidence.loans.length}`);
  console.log(`Total Merchants Configured: ${evidence.merchantsCount}`);
  console.log(`Total Historical Transactions: ${evidence.transactions.totalSimulated}`);
  console.log(`Transaction Date Horizon: ${evidence.transactions.latestDate} back across 2 years`);
  console.log("==========================================================\n");
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
