const { createHash } = require("node:crypto");
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (code, status = 400) =>
  Object.assign(new Error(code), { code, status });
const quantile = (values, q) =>
  values.length
    ? [...values].sort((a, b) => a - b)[
        Math.max(0, Math.ceil(values.length * q) - 1)
      ]
    : 0;
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function localParts(value, timeZone = "America/Chicago") {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((x) => [x.type, x.value]),
  );
  const date = p.year + "-" + p.month + "-" + p.day;
  const weekday = ((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
  return {
    date,
    month: date.slice(0, 7),
    weekday,
    minute: Number(p.hour) * 60 + Number(p.minute),
  };
}
function addDays(date, n) {
  return new Date(Date.parse(date + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
}
function localToUTC(date, minute, timeZone) {
  const target = Date.parse(date + "T00:00:00Z") + minute * 60000;
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, timeZone);
    guess += target - (Date.parse(p.date + "T00:00:00Z") + p.minute * 60000);
  }
  return new Date(guess).toISOString();
}
const net = (r) =>
  Math.max(0, Number(r.amount_cents) - Number(r.reversed_cents || 0));
const baseline = (r) =>
  r.kind === "purchase" &&
  r.direction === "outflow" &&
  r.status === "completed" &&
  !r.screen_flags?.length;
async function transaction(pool, fn) {
  if (pool.isPipelineTransaction) return fn(pool);
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (e) {
    await tx.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    tx.release();
  }
}
module.exports = {
  hash,
  fail,
  quantile,
  random,
  localParts,
  localToUTC,
  addDays,
  net,
  baseline,
  transaction,
};
