const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveBudgets,
  shouldDerive,
  historyInputs,
} = require("../backend/budget-derive");
test("derived budgets match the plan example and unknown income stays explicit", () => {
  const inputs = {
    normal: { dining: 24000, coffee: 9000, groceries: 30000, retail: 15000 },
    income: 300000,
    fixed: 209249,
  };
  const a = deriveBudgets([], {}, [], { inputs });
  assert.deepEqual(
    Object.fromEntries(a.map((b) => [b.category, b.limit_cents])),
    { dining: 14000, coffee: 5000, groceries: 18000, retail: 9000, all: 46500 },
  );
  assert.ok(a[0].evidence.flags.includes("spending_above_income"));
  const b = deriveBudgets([], {}, [], { inputs: { ...inputs, income: null } });
  assert.equal(b[0].limit_cents, 24000);
  assert.ok(b[0].evidence.flags.includes("income_unknown"));
});
test("spending does not reset budgets, material income does; user edits survive", () => {
  const old = {
      source: "derived",
      effective_from: "2026-11-01T12:00Z",
      evidence: { income: 300000, fixed: 200000 },
    },
    next = { evidence: { income: 300000, fixed: 200000 } };
  assert.equal(
    shouldDerive(old, next, new Date("2026-11-08"), "America/Chicago"),
    false,
  );
  assert.equal(
    shouldDerive(
      old,
      { evidence: { income: 340000, fixed: 200000 } },
      new Date("2026-11-08"),
      "America/Chicago",
    ),
    true,
  );
  assert.equal(
    shouldDerive(
      { ...old, source: "user" },
      next,
      new Date("2026-12-08"),
      "America/Chicago",
    ),
    false,
  );
});

test('six-month budgets average the center months and do not mistake three payroll months for zero income',()=>{
 const rows=[];for(let i=0;i<6;i++){const occurred_at='2026-'+String(i+5).padStart(2,'0')+'-01T12:00Z';rows.push({kind:'purchase',status:'completed',direction:'outflow',category:'dining',amount_cents:(i+1)*1000,reversed_cents:0,screen_flags:[],occurred_at});if(i<3)rows.push({kind:'deposit',status:'completed',direction:'inflow',amount_cents:300000,descriptor:'PAYROLL',occurred_at});}
 const result=historyInputs(rows,new Date('2026-11-08T12:00Z'),'America/Chicago');assert.equal(result.normal.dining,3500);assert.equal(result.income,150000);
});
