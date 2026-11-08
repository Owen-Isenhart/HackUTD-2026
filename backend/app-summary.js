// One owner-scoped payload for the app's four original tabs (Deals, Spending,
// Upcoming, Account). Everything is computed from the signed-in owner's most
// recent Nessie v2 rows and Tiger Data budgets/forecast; Nemotron only chooses
// among server-written, verified choices, so it cannot invent amounts.
const { BRANDS } = require("./brands");
const { localParts } = require("./pipeline-utils");
const { requestInsight } = require("./nemotron");
const terms = require("../data/card-terms.json");

const DAY = 86400000;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (cents) => usd.format(cents / 100);
const dollars = (cents) => Math.round(cents) / 100;
const net = (r) => Number(r.amount_cents) - Number(r.reversed_cents || 0);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const CATEGORY = {
  dining: { name: "Food & Dining", sub: "Restaurants, quick service, delivery", short: "Dining", icon: "silverware-fork-knife", color: "#206774" },
  coffee: { name: "Coffee & Cafes", sub: "Coffee shops, bakeries", short: "Coffee", icon: "coffee-outline", color: "#90d1df" },
  groceries: { name: "Groceries & Essentials", sub: "Markets, superstores", short: "Groceries", icon: "basket-outline", color: "#629e82" },
  fuel: { name: "Fuel & Transport", sub: "Gas stations, transit", short: "Fuel", icon: "gas-station-outline", color: "#041920" },
  travel: { name: "Travel", sub: "Airlines, lodging, booking", short: "Travel", icon: "airplane", color: "#b4cad3" },
  retail: { name: "Shopping & Retail", sub: "Apparel, department stores", short: "Shopping", icon: "shopping-outline", color: "#dddad2" },
  electronics: { name: "Electronics", sub: "Devices, accessories", short: "Tech", icon: "cellphone", color: "#7a9aa3" },
  other: { name: "Everything Else", sub: "Uncategorized purchases", short: "Other", icon: "dots-horizontal-circle-outline", color: "#c9c4b8" },
};
const cat = (key) => CATEGORY[key] || CATEGORY.other;
const PINS = [{ x: 140, y: 130 }, { x: 295, y: 210 }, { x: 265, y: 75 }, { x: 245, y: 315 }, { x: 90, y: 260 }, { x: 330, y: 360 }];

const title = (s) => s.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());
// Bank descriptors look like "CHICK-FIL-A #03822 UTD CAMPUS RICHARDSON TX"; keep the merchant part.
function merchantName(r) {
  const brand = r.brand_key && BRANDS.find((b) => b[0] === r.brand_key);
  const raw = String(r.descriptor || "").replace(/^(SQ|TST|PAYPAL)\s*\*\s*/i, "");
  let cut = raw.split(/\s+(?:#|\*|\d{3,})/)[0].trim();
  // Drop a trailing "CITY ST" location (e.g. "EMPIRE COFFEE NEW YORK NY").
  const loc = /\s+(?:NEW YORK|WASHINGTON|ALEXANDRIA|ARLINGTON|FAIRFAX|MCLEAN|RESTON|BETHESDA|SILVER SPRING|BALTIMORE|RICHARDSON|PLANO|DALLAS|ADDISON|AUSTIN|HOUSTON|UTD CAMPUS|[A-Z]+)\s+[A-Z]{2}$/;
  if (/\s[A-Z]{2}$/.test(cut) && cut.split(/\s+/).length > 3) cut = cut.replace(loc, "");
  else if (/\s[A-Z]{2}$/.test(cut)) cut = cut.replace(/\s+[A-Z]{2}$/, "");
  if (cut && cut.length >= 3) return title(cut).slice(0, 40);
  return brand ? brand[1] : "Card purchase";
}
function whenText(iso, tz, now) {
  const p = localParts(iso, tz), today = localParts(now, tz).date;
  const yesterday = localParts(new Date(+now - DAY), tz).date;
  const h = Math.floor(p.minute / 60), m = String(p.minute % 60).padStart(2, "0");
  const clock = `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
  if (p.date === today) return `Today, ${clock}`;
  if (p.date === yesterday) return `Yesterday, ${clock}`;
  return `${MONTHS[Number(p.date.slice(5, 7)) - 1].slice(0, 3)} ${Number(p.date.slice(8))}, ${clock}`;
}
const shortDate = (date) => `${MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3)} ${date.slice(8)}`;
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DAY);
const addDays = (date, n) => new Date(Date.parse(date + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
const rewardBps = (category) => terms.categoryCashbackBps[category] ?? terms.baseCashbackBps;

function spendingSection(ledger, budgets, tz, now) {
  const today = localParts(now, tz);
  const month = today.month, dayOfMonth = Number(today.date.slice(8));
  const prev = localParts(new Date(Date.parse(month + "-01T12:00:00Z") - DAY), tz).month;
  const purchases = ledger
    .filter((r) => r.kind === "purchase" && r.status === "completed" && r.provenance === "nessie_sandbox" && net(r) > 0)
    .map((r) => ({ ...r, local: localParts(r.occurred_at, tz) }));
  const thisMonth = purchases.filter((r) => r.local.month === month);
  const lastPace = purchases.filter((r) => r.local.month === prev && Number(r.local.date.slice(8)) <= dayOfMonth);
  const total = thisMonth.reduce((s, r) => s + net(r), 0);
  const prevTotal = lastPace.reduce((s, r) => s + net(r), 0);
  const byCat = new Map();
  for (const r of thisMonth) byCat.set(r.category || "other", (byCat.get(r.category || "other") || 0) + net(r));
  const categories = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([key, cents]) => ({
    key, ...cat(key), amt: dollars(cents), pct: total ? Math.round((cents / total) * 100) : 0,
  }));
  const overall = budgets.find((b) => b.category === "all");
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const pacedLimit = overall ? (Number(overall.limit_cents) * dayOfMonth) / daysInMonth : null;
  const change = prevTotal ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10 : null;
  const budgetRows = budgets.filter((b) => b.category !== "all").map((b) => {
    const spent = byCat.get(b.category) || 0;
    return { category: b.category, spent, limit: Number(b.limit_cents), share: Number(b.limit_cents) ? spent / Number(b.limit_cents) : 0 };
  }).sort((a, b) => b.share - a.share);
  return {
    monthLabel: `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`,
    prevMonthLabel: MONTHS[Number(prev.slice(5, 7)) - 1],
    total: dollars(total),
    dailyAverage: dollars(total / Math.max(1, dayOfMonth)),
    changePct: change,
    status: pacedLimit === null ? "No budget yet" : total <= pacedLimit ? "On Target" : "Over Pace",
    budgetLine: overall
      ? `${money(total)} of your ${money(Number(overall.limit_cents))} monthly budget so far (${Math.round((total / Number(overall.limit_cents)) * 100)}%).`
      : "Budgets appear after the first full bank import.",
    categories,
    transactions: purchases.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at)).slice(0, 6).map((r) => ({
      id: r.id, name: merchantName(r), when: whenText(r.occurred_at, tz, now), cat: cat(r.category).short,
      amt: -dollars(net(r)), icon: cat(r.category).icon,
    })),
    budgetRows,
    purchases,
  };
}

function upcomingSection(data, tz, now) {
  const today = localParts(now, tz).date;
  const horizon = addDays(today, 30);
  const commitments = (data.forecast?.commitments || []).filter((c) => c.source !== "pending" && c.date >= today && c.date <= horizon);
  const merged = new Map();
  for (const c of commitments) {
    const k = c.payee + "|" + c.date;
    if (!merged.has(k)) merged.set(k, c);
  }
  const accounts = data.accounts || [];
  const acctLabel = (id) => {
    const a = accounts.find((x) => x.account_id === id);
    return a ? `${a.account_type} •• ${a.last4}` : "Checking";
  };
  const billMeta = new Map((data.bank?.bills || []).map((b) => [b.payee, b]));
  const bills = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)).map((c) => {
    const inDays = daysBetween(today, c.date);
    const bill = billMeta.get(c.payee);
    const icon = c.source === "loan" ? "school-outline" : /rent|apartment/i.test((bill?.nickname || "") + c.payee) ? "home-outline"
      : /energy|electric|water|gas/i.test(c.payee) ? "flash-outline" : /at&t|internet|verizon|t-mobile/i.test(c.payee) ? "wifi"
      : "receipt-text-outline";
    return {
      name: bill?.nickname || c.payee, icon,
      line: c.estimated ? "Estimated monthly payment" : `Due ${shortDate(c.date)}`,
      // Nessie v2 loans have no due date: the forecast reserves them early, so
      // label them as a monthly estimate rather than "due today".
      tag: c.estimated ? "Monthly reserve" : inDays <= 0 ? "Due today" : `In ${inDays} day${inDays === 1 ? "" : "s"}`,
      tagErr: !c.estimated && inDays <= 5, amt: dollars(c.amount), date: c.date,
      acct: bill ? acctLabel(bill.account_id) : c.source === "loan" ? "Loan" : "Bill",
      autopay: bill?.status === "recurring", pay: c.estimated,
    };
  });
  // Payroll cadence from the most recent deposits only.
  const payroll = (data.profile?.bankCashflow?.incomeHistory || []).filter((i) => i.source === "payroll").slice(-8);
  const incomes = [];
  const payDeposit = [...(data.ledger || [])].reverse().find((r) => r.kind === "deposit" && /PAYROLL/i.test(r.descriptor || ""));
  const employer = payDeposit ? title(payDeposit.descriptor.replace(/\s*PAYROLL.*$/i, "")) : "Employer";
  if (payroll.length >= 3) {
    const gaps = payroll.slice(1).map((p, i) => daysBetween(payroll[i].date, p.date)).sort((a, b) => a - b);
    const gap = Math.max(7, gaps[Math.floor(gaps.length / 2)]);
    const amounts = payroll.slice(-4).map((p) => p.amountCents).sort((a, b) => a - b);
    const amount = amounts[Math.floor(amounts.length / 2)];
    let next = addDays(payroll.at(-1).date, gap);
    while (next < today) next = addDays(next, gap);
    for (; next <= addDays(today, 14) && incomes.length < 3; next = addDays(next, gap))
      incomes.push({ name: "Payroll Direct Deposit", icon: "bank-outline", line: employer, date: shortDate(next), iso: next, amt: dollars(amount), status: "Estimated" });
  }
  const billDates = new Set([...merged.values()].map((c) => c.date));
  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(today, i);
    const outDay = billDates.has(d);
    const inDay = incomes.some((x) => x.iso === d);
    days.push({ key: d, dow: i === 0 ? "TODAY" : DOW[(new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7], d: d.slice(8), kind: i === 0 ? "today" : outDay ? "out" : inDay ? "in" : "none" });
  }
  const out = bills.reduce((s, b) => s + b.amt, 0), inn = incomes.reduce((s, b) => s + b.amt, 0);
  const end = addDays(today, 30);
  return {
    rangeLabel: `${MONTHS[Number(today.slice(5, 7)) - 1]} — ${MONTHS[Number(end.slice(5, 7)) - 1]}`,
    bills, incomes, days, out, inn,
    safeToSpend: Number.isSafeInteger(data.forecast?.safeToSpendCents) ? dollars(data.forecast.safeToSpendCents) : null,
    balance: Number.isSafeInteger(data.forecast?.startingBalanceCents) ? dollars(data.forecast.startingBalanceCents) : null,
  };
}

function dealsSection(purchases, now) {
  const recent = purchases.filter((r) => Date.parse(r.occurred_at) >= +now - 90 * DAY);
  const groups = new Map();
  for (const r of recent) {
    const name = merchantName(r);
    const g = groups.get(name) || { name, category: r.category || "other", visits: 0, cents: 0 };
    g.visits++;
    g.cents += net(r);
    groups.set(name, g);
  }
  return [...groups.values()].sort((a, b) => b.visits - a.visits || b.cents - a.cents).slice(0, 6).map((g, i) => {
    const bps = rewardBps(g.category), avg = g.cents / g.visits;
    return {
      id: i + 1, merchant: g.name, icon: cat(g.category).icon, reward: `${bps / 100}% Back`,
      dist: `${g.visits} visit${g.visits === 1 ? "" : "s"} in 90 days`, area: cat(g.category).short,
      title: `${bps / 100}% cash back on ${cat(g.category).short.toLowerCase()} with SavorOne`,
      sub: `Avg ticket ${money(avg)} • ~${money((avg * bps) / 10000)} back per visit`,
      note: terms.label, cta: "Use SavorOne", pin: PINS[i % PINS.length], cat: cat(g.category).short,
      visits: g.visits, monthlyBackCents: Math.round((g.cents / 3) * bps / 10000), bps,
    };
  });
}

async function chooseRecommendation({ spending, upcoming, deals }, { env, fetchImpl }) {
  const choices = [];
  const add = (id, t, text, facts) => choices.push({ id, title: t, text, facts });
  const hot = spending.budgetRows.find((b) => b.share >= 0.8);
  if (hot) add("budget_watch", `Ease off ${cat(hot.category).short.toLowerCase()}`,
    `${cat(hot.category).name} is at ${Math.round(hot.share * 100)}% of its ${money(hot.limit)} monthly budget with ${spending.monthLabel} still running.`,
    { category: hot.category, shareOfBudgetPct: Math.round(hot.share * 100) });
  const soon = upcoming.bills.find((b) => b.tagErr);
  if (soon) add("bill_soon", `${soon.name} is ${soon.tag.toLowerCase()}`,
    `${money(soon.amt * 100)} is due ${shortDate(soon.date)}. Keep it covered in ${soon.acct}.`, { daysUntil: soon.tag });
  const best = [...deals].sort((a, b) => b.monthlyBackCents - a.monthlyBackCents)[0];
  if (best && best.bps > terms.baseCashbackBps) add("card_reward", `Keep using SavorOne at ${best.merchant}`,
    `${best.reward} on ${best.area.toLowerCase()} — your ${best.visits} recent visits earn about ${money(best.monthlyBackCents)} a month.`,
    { merchantVisits90d: best.visits, rewardPct: best.bps / 100 });
  if (spending.changePct !== null && spending.changePct > 15) add("pace_up", "Spending is running ahead",
    `You're ${spending.changePct}% above your ${spending.prevMonthLabel} pace at this point in the month.`, { changePct: spending.changePct });
  if (upcoming.safeToSpend !== null) add("cushion", "Bills are covered",
    `After every scheduled bill in the next 30 days, about ${money(upcoming.safeToSpend * 100)} stays available.`, { coveredAfterBills: true });
  if (!choices.length) return { recommendation: null, featuredDealId: deals[0]?.id ?? null };
  let pick, featured;
  if (env.NEMOTRON_BASE_URL) {
    const ids = choices.map((c) => c.id);
    const dealIds = deals.map((d) => String(d.id));
    const { insight } = await requestInsight({
      name: "app_recommendation",
      prompt: "You are a personal-finance assistant. Pick the single most useful action for this user right now from the listed choices, preferring budget pressure or bills due soon over general tips. Also pick the reward offer that best fits their recent habits. Return only IDs.",
      facts: {
        choices: choices.map((c) => ({ id: c.id, ...c.facts })),
        offers: deals.map((d) => ({ id: String(d.id), category: d.area, visits90d: d.visits, rewardPct: d.bps / 100 })),
      },
      properties: {
        action: { type: "string", enum: ids },
        offer: { type: "string", enum: dealIds.length ? dealIds : ["none"] },
      },
      timeout: 5000,
      maxTokens: 64,
    }, { env, fetchImpl });
    pick = choices.find((c) => c.id === insight?.action);
    featured = deals.find((d) => String(d.id) === insight?.offer)?.id;
  }
  const chosen = pick || choices[0];
  return {
    recommendation: { id: chosen.id, title: chosen.title, text: chosen.text, source: pick ? "nemotron" : "profile" },
    featuredDealId: featured ?? deals[0]?.id ?? null,
  };
}

async function appSummary(pool, data, { env, fetchImpl, nessie, now = new Date() }) {
  const tz = data.owner.time_zone || "America/Chicago";
  const accounts = (await pool.query(
    "SELECT account_id,account_type,last4,nickname FROM hackutd_finance.owner_account WHERE owner_id=$1 ORDER BY account_type",
    [data.owner.id],
  )).rows;
  let fullName = data.owner.first_name || "";
  try {
    const c = await nessie?.request("/customers/" + data.owner.nessie_customer_id);
    if (c?.first_name) fullName = `${c.first_name} ${c.last_name || ""}`.trim();
  } catch { /* the first name from sign-in is enough */ }
  const ctx = { ...data, accounts };
  const spending = spendingSection(data.ledger, data.budgets || [], tz, now);
  const upcoming = upcomingSection(ctx, tz, now);
  const deals = dealsSection(spending.purchases, now);
  const { recommendation, featuredDealId } = await chooseRecommendation({ spending, upcoming, deals }, { env, fetchImpl });
  const bal = (type) => {
    const a = accounts.find((x) => x.account_type === type);
    const b = a && (data.bank?.balances || []).find((x) => x.id === a.account_id);
    return a ? { ...a, cents: b?.available_cents ?? null } : null;
  };
  const checking = bal("Checking"), savings = bal("Savings"), card = bal("Credit Card");
  const { purchases, budgetRows, ...spendingOut } = spending;
  return {
    asOf: data.profile?.asOf ?? null,
    source: "nessie_v2_sandbox",
    recommendation,
    featuredDealId,
    deals,
    dealCategories: ["All", ...new Set(deals.map((d) => d.cat))],
    spending: { ...spendingOut, budgets: budgetRows.map((b) => ({ category: cat(b.category).short, spent: dollars(b.spent), limit: dollars(b.limit) })) },
    upcoming,
    account: {
      name: fullName,
      initials: fullName.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase(),
      tier: "Nessie v2 sandbox customer",
      checking: checking ? `${checking.nickname || "Checking"} •• ${checking.last4}` : "Checking",
      balance: checking?.cents != null ? money(checking.cents) : "—",
      cardName: card?.nickname || "Credit Card",
      cardLast4: card?.last4 || "••••",
      cardholder: fullName.toUpperCase(),
      linked: [savings, card].filter(Boolean).map((a) => ({
        name: a.nickname || a.account_type,
        sub: `${a.account_type} •• ${a.last4}`,
        amt: a.cents != null ? money(a.cents) : "—",
        badge: a.account_type === "Credit Card" ? "Available credit" : "Synced",
        icon: a.account_type === "Credit Card" ? "credit-card-outline" : "piggy-bank-outline",
      })),
    },
  };
}

module.exports = { appSummary, merchantName };
