# Nessie Synthetic Banking Data Handoff

This document describes the synthetic financial dataset created in the **Nessie v2 API** (`https://v2-prod-api.nessieisreal.com`) for the HackUTD 2026 Nessiessential project. It covers the primary user profile, accounts, live entity IDs, 2-year transaction history, recurring bills, active loans, geocoded merchants, and integration recipes.

---

## 1. Quick Connection & Credentials

- **API Base URL:** `https://v2-prod-api.nessieisreal.com`
- **Documentation & OpenAPI:** [Nessie v2 Docs](https://v2.nessieisreal.com/docs#description/introduction) / [OpenAPI Spec](https://v2.nessieisreal.com/openapi.json)
- **Authentication:** `Authorization: Bearer <NESSIE_API_KEY>` (in HTTP header, never in query string)
- **Local Secret Storage:** Saved in `.env.deals.local` (`NESSIE_API_KEY` and `NESSIE_API_BASE_URL`).

---

## 2. Primary User / Customer Profile

The synthetic dataset represents **Alex Taylor**, a student/resident located on the UT Dallas campus in Richardson, TX.

| Attribute | Value | Context |
| :--- | :--- | :--- |
| **Customer ID** | `cust_01m6x5w635z27trg3dfbhjxjvx` | Nessie primary customer record |
| **First Name** | `Alex` | Natural identifier for bank lookup |
| **Last Name** | `Taylor` | Natural identifier for bank lookup |
| **Street Address** | `800 W Campbell Rd` | UT Dallas campus address |
| **City, State, Zip** | `Richardson`, `TX` `75080` | Anchors the GPS bubble & routine center |
| **Credit Score** | `745` | High-prime student/young professional tier |

---

## 3. Account Hierarchy & Balances

All three accounts belong to `cust_01m6x5w635z27trg3dfbhjxjvx`:

| Type | Nickname | Account ID | 16-Digit Number (Last 4) | Posted Balance | Available / Limit |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Checking** | Everyday Checking | `acct_01m6x5w635z27trg3dfew69af9` | `4994065455602583` (`2583`) | \$150,717.17 | \$150,717.17 spendable |
| **Credit Card** | Capital One SavorOne Rewards | `acct_01m6x5w635z27trg3dfh0d2rk1` | `4364054625056619` (`6619`) | -\$3,278.77 | \$13,229.52 avail. / \$10,000 credit limit |
| **Savings** | High Yield Savings | `acct_01m6x5y6m078g0k6fme5aamaa1` | `7239437675341517` (`1517`) | \$12,500.00 | \$12,500.00 reserve |

> **Recommended Environment Configuration:**
> If your service expects a single `NESSIE_ACCOUNT_ID` in `.env`, use the Credit Card account:
> ```env
> NESSIE_ACCOUNT_ID=acct_01m6x5w635z27trg3dfh0d2rk1
> ```

---

## 4. Recurring Monthly Bills (Checking Account)

Tied to `acct_01m6x5w635z27trg3dfew69af9`. These feed the deterministic liquidity and forecast obligation engines:

| Payee | Nickname | Amount | Due Day | Status | Bill ID |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cortland Apartments** | Apartment Rent - Cortland Campbell | \$1,450.00 | 1st | `recurring` | `bill_01m6x5y9aj5p7k9ex13vfe3g14` |
| **TXU Energy** | Electric Utility - TXU | \$115.50 | 12th | `recurring` | `bill_01m6x5y9ejzb9fza441nq987yx` |
| **Spotify** | Spotify Premium Family | \$11.99 | 15th | `recurring` | `bill_01m6x5y9yv7zmwr0endhfkrktd` |
| **AT&T** | Home Internet - AT&T Fiber 1Gbps | \$70.00 | 18th | `recurring` | `bill_01m6x5y9jhy176sdgn0098kzqk` |
| **Verizon Wireless** | Mobile Phone - Unlimited Plus | \$85.00 | 22nd | `recurring` | `bill_01m6x5y9ptrpz5jbe4tpwy5a9f` |
| **Geico Insurance** | Auto Insurance - Comprehensive | \$135.00 | 25th | `recurring` | `bill_01m6x5y9ttqgm8bye3bn0hv7x2` |

**Total Scheduled Monthly Overhead:** \$1,867.49

---

## 5. Active Loan Record (Checking Account)

Tied to `acct_01m6x5w635z27trg3dfew69af9`:
- **Loan ID:** `loan_01m6x5ya2ttpf88zgh14xvj8yp`
- **Type:** `Student Loan`
- **Description:** `Federal Direct Student Loan - Standard 10-Yr Plan`
- **Principal Balance:** \$18,500.00 (`amount_cents: 1850000`)
- **Monthly Payment:** \$225.00 (`monthly_payment_cents: 22500`)
- **Credit Score:** `745`
- **Status:** `in_repayment`

---

## 6. Two-Year Transaction History & Spending Profile

- **Total Historical Transactions:** 2,500 transactions.
- **Span:** Generated across 2 full years (730 days: November 2024 to November 8, 2026).
- **Composition:**
  - **Payroll Deposits:** Regular direct deposits into Checking (`INOVA HEALTH SYSTEMS PAYROLL`, ~\$900 to \$1,800).
  - **Merchant Purchases:** Daily routine and discretionary spending across coffee, dining, groceries, gas, electronics, travel, and apparel.
  - **Account Transfers:** Periodic payments from Checking to settle Credit Card balances (`TRANSFER TO EVERYDAY CHECKING`).
  - **Dispute Postings & Refunds:** Realistic refunds with parent transaction links.
  - **ATM Withdrawals:** Periodic local cash withdrawals with fee records.

---

## 7. Geocoded Merchants & Reward Targets (17 Brands)

All merchants are registered in Nessie with real addresses and coordinates matching the Dallas/Richardson GPS area:

| Merchant Name | Category | Nessie Merchant ID | Address | Geocode (Lat, Lng) |
| :--- | :--- | :--- | :--- | :--- |
| **Chipotle Mexican Grill** | `restaurant` | `merch_01m6x5y8660pn59kpagnkemsqg` | 283 W Campbell Rd, Richardson, TX | `32.97504`, `-96.72106` |
| **Starbucks Coffee** | `coffee` | `merch_01m6x5w635z27trg3dfkzxgbqz` | 800 W Campbell Rd (UTD SU), Richardson, TX | `32.98666`, `-96.74888` |
| **Chick-fil-A** | `restaurant` | `merch_01m6x5y8a45vmjqsn5059dyyyr` | 800 W Campbell Rd (UTD SU), Richardson, TX | `32.98666`, `-96.74888` |
| **Panera Bread** | `restaurant` | `merch_01m6x5y8e0yk332s28ndv0y810` | 1405 E Campbell Rd, Richardson, TX | `32.97900`, `-96.70000` |
| **Walmart Supercenter** | `groceries` | `merch_01m6x5w635z27trg3dfq5mpk6j` | 15757 Coit Rd, Dallas, TX | `32.96300`, `-96.77000` |
| **Target** | `groceries` | `merch_01m6x5w635z27trg3dftqp54a7` | 16731 Coit Rd, Dallas, TX | `32.97400`, `-96.77100` |
| **Shell Fuel** | `gas` | `merch_01m6x5w635z27trg3dfwer19r5` | 500 S Glebe Rd, Richardson, TX | `32.97000`, `-96.72000` |
| **Chevron Fuel** | `gas` | `merch_01m6x5w635z27trg3dfzaa0xqt` | 6300 Central Expy, Richardson, TX | `32.96500`, `-96.71500` |
| **Booking.com Travel** | `travel` | `merch_01m6x5w635z27trg3dg113tk7f` | 28 Liberty St, New York, NY | `40.70810`, `-74.00800` |
| **Best Buy** | `electronics` | `merch_01m6x5w635z27trg3dg1efpvce` | 2800 N Central Expy, Plano, TX | `33.03600`, `-96.70500` |
| **Nike Store** | `retail` | `merch_01m6x5w635z27trg3dg29brsyw` | 8687 N Central Expy, Dallas, TX | `32.86800`, `-96.77300` |
| **The Home Depot** | `retail` | `merch_01m6x5w635z27trg3dg2pqmftd` | 1200 N Central Expy, Plano, TX | `33.01800`, `-96.71100` |
| **Sephora** | `retail` | `merch_01m6x5w635z27trg3dg4qehx1t` | 6121 W Park Blvd, Plano, TX | `33.03000`, `-96.82500` |
| **Uber Eats** | `restaurant` | `merch_01m6x5y8hvypa3x4xm4p6n79zd` | 1515 3rd St, San Francisco, CA | `37.77490`, `-122.41940` |
| **Lululemon** | `retail` | `merch_01m6x5y8nwxgmnebw8q756ps4b` | 8687 N Central Expy, Dallas, TX | `32.86800`, `-96.77300` |
| **Macy's** | `retail` | `merch_01m6x5y8stgyvd3t1vm01z8sdr` | 6121 W Park Blvd, Plano, TX | `33.02900`, `-96.82700` |
| **Bluebird Coffee** | `coffee` | `merch_01m6x5w635z27trg3dfpwwa2p0` | 1201 King St, Richardson, TX | `32.97500`, `-96.73000` |

---

## 8. Onboarding & Traversal Integration Recipe

When onboarding a user into the mobile app:
1. **Google OAuth / App Identity:** Collect user full name (`Alex Taylor`) and mobile phone number (for Photon).
2. **Card Knowledge Verification:** User confirms the last 4 digits of their card (`6619`).
3. **Traverse Nessie Dynamically:**

```typescript
const headers = { Authorization: `Bearer ${process.env.NESSIE_API_KEY}` };

// 1. Resolve Customer ID by Name
const { items: customers } = await fetch(
  `${process.env.NESSIE_API_BASE_URL}/customers`,
  { headers }
).then((r) => r.json());

const customer = customers.find(
  (c) => c.first_name.toLowerCase() === "alex" && c.last_name.toLowerCase() === "taylor"
);

// 2. Discover all accounts & verify last 4
const { items: accounts } = await fetch(
  `${process.env.NESSIE_API_BASE_URL}/customers/${customer.id}/accounts`,
  { headers }
).then((r) => r.json());

const card = accounts.find((a) => a.account_number.endsWith("6619"));
if (!card) throw new Error("Card verification failed");

// 3. Load entire financial reality
const checking = accounts.find((a) => a.type === "Checking");
const [txRes, billsRes, loansRes] = await Promise.all([
  fetch(`${process.env.NESSIE_API_BASE_URL}/accounts/${card.id}/transactions?limit=100`, { headers }),
  fetch(`${process.env.NESSIE_API_BASE_URL}/accounts/${checking.id}/bills`, { headers }),
  fetch(`${process.env.NESSIE_API_BASE_URL}/accounts/${checking.id}/loans`, { headers }),
]);
```

---

## 9. Reproducibility & Local Artifacts

- **Pipeline Script:** [`scripts/seed-nessie-synthetic.mjs`](../scripts/seed-nessie-synthetic.mjs)
  - Run anytime with: `node scripts/seed-nessie-synthetic.mjs`
  - Completely idempotent: clears existing tenant data, runs deterministic simulation (seed `2026`), personalizes customer, updates merchants, links anchor purchases, and binds bills/loans.
- **Full JSON Audit Evidence:** [`docs/nessie-synthetic-evidence.json`](nessie-synthetic-evidence.json)
