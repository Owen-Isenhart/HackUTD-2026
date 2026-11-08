const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildWorld,
  checkOptimizerAgainstGuards,
} = require("../backend/optimizer-world");
const now = new Date();
function context() {
  const owner = {
      id: "00000000-0000-4000-8000-000000000001",
      time_zone: "America/Chicago",
    },
    ledger = [1, 2, 3].map((i) => ({
      id: "p" + i,
      kind: "purchase",
      status: "completed",
      direction: "outflow",
      amount_cents: 1500,
      occurred_at: new Date(+now - i * 86400000).toISOString(),
      brand_key: "chipotle",
      category: "dining",
      provenance: "synthetic_persona",
    })),
    routines = [
      {
        id: "r",
        version: 1,
        purpose: "purchase",
        brand_key: "chipotle",
        weekdays: [1, 2, 3, 4, 5],
        window_start_minute: 660,
        window_end_minute: 685,
        typical_low_cents: 1150,
        typical_mid_cents: 1500,
        typical_high_cents: 1600,
        evidence: "Synthetic lunch habit",
        support: { n: 20 },
      },
    ];
  return {
    owner,
    ledger,
    routines,
    budgets: [
      { category: "all", period: "month", version: 1, limit_cents: 100000 },
    ],
    selections: [
      {
        selected: true,
        brand_key: "chipotle",
        branches: [{ id: "branch", name: "Chipotle", lat: 32.98, lon: -96.75 }],
      },
    ],
    forecast: {
      version: 1,
      asOf: now.toISOString(),
      validUntil: new Date(+now + 1800000).toISOString(),
      startingBalanceCents: 100000,
      minimumBalanceLowCents: 90000,
      safeToSpendCents: 90000,
    },
    request: {
      source: "demo",
      fix: {
        coords: { latitude: 32.981, longitude: -96.75, accuracy: 5 },
        timestamp: +now,
      },
    },
    now,
  };
}
module.exports = { context };
test("world uses demo marker, typed budgets and card rewards with labeled fixture gate", () => {
  const args = context();
  const sample = {
    id: "s",
    provenance: "synthetic_fixture",
    merchant_id: "chipotle",
    source: "synthetic_fixture",
    terms_text: "Sample $3 off",
    kind: "amount_off",
    value: 300,
    expires_at: new Date(+now + 60000).toISOString(),
    verified: true,
  };
  const off = buildWorld({ ...args, offers: [sample] });
  assert.equal(off.world.offers.length, 0);
  const on = buildWorld({ ...args, offers: [sample], allowFixtures: true });
  assert.equal(on.world.offers[0].source, "synthetic_fixture");
  assert.equal(on.world.fix.source, "demo");
  assert.equal(on.world.payment_methods[0].category_cashback_bps.dining, 300);
  assert.equal(on.world.constraints.budgets[0].all_spending, true);
  const far = buildWorld({
    ...args,
    request: {
      ...args.request,
      fix: {
        coords: { latitude: 33.01, longitude: -96.75, accuracy: 5 },
        timestamp: +now,
      },
    },
  });
  assert.equal(far.reason, "no_matching_routine");
});
test("Node guards reject forged optimizer amounts and budget violations", () => {
  const { world, meta } = buildWorld(context());
  const ranked = [
    {
      item_id: world.items[0].id,
      place_id: world.places[0].id,
      payment_method_id: "card",
      applied_offer_ids: [],
      payable_now: { minor: 1500 },
      verified_cashback: { minor: 45 },
      effective_cost: { minor: 1455 },
    },
  ];
  assert.equal(
    checkOptimizerAgainstGuards(
      { decision: "recommend", ranked },
      world,
      meta,
      now,
    ),
    true,
  );
  ranked[0].verified_cashback.minor = 999999;
  assert.equal(
    checkOptimizerAgainstGuards(
      { decision: "recommend", ranked },
      world,
      meta,
      now,
    ),
    false,
  );
});

test(
  "fixture world validates and optimizes with the actual Python engine",
  { skip: !require("fs").existsSync("optimizer/.venv/Scripts/python.exe") },
  () => {
    const { world, meta } = buildWorld(context());
    const run = require("child_process").spawnSync(
      "optimizer/.venv/Scripts/python.exe",
      [
        "-c",
        "import sys,json; from datetime import datetime,timezone; from optimizer.server import EvaluationRequest; from optimizer.engine import optimize; req=EvaluationRequest.model_validate_json(sys.stdin.read()); print(optimize(req.inputs(), datetime.now(timezone.utc)).model_dump_json())",
      ],
      { input: JSON.stringify(world), encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.decision, "recommend");
    assert.equal(result.chosen.payment_method_id, "card");
    assert.equal(result.chosen.verified_cashback.minor, 45);
    assert.equal(
      checkOptimizerAgainstGuards(result, world, meta, new Date()),
      true,
    );
  },
);

test(
  "a verified cheaper meal wins when the routine purchase exceeds remaining dining budget",
  { skip: !require("fs").existsSync("optimizer/.venv/Scripts/python.exe") },
  () => {
    const args = context();
    args.ledger.push(
      ...[1, 2, 3].map((i) => ({
        id: "taco" + i,
        kind: "purchase",
        status: "completed",
        direction: "outflow",
        amount_cents: 900,
        occurred_at: new Date(Date.now() - i * 86400000).toISOString(),
        brand_key: "taco_bell",
        category: "dining",
        provenance: "synthetic_persona",
      })),
    );
    args.budgets.push({
      category: "dining",
      period: "month",
      version: 1,
      limit_cents: 8200,
    });
    args.selections.push({
      selected: true,
      brand_key: "taco_bell",
      branches: [{ id: "taco", name: "Taco Bell", lat: 32.9811, lon: -96.75 }],
    });
    const { world, meta } = buildWorld(args);
    const alternative = world.items.find((i) => i.place_id === "taco");
    world.judgements.push({
      item_id: alternative.id,
      verdict: "suitable",
      reasons: ["Test fixture: verified meal alternative"],
    });
    const run = require("child_process").spawnSync(
      "optimizer/.venv/Scripts/python.exe",
      [
        "-c",
        "import sys; from datetime import datetime,timezone; from optimizer.server import EvaluationRequest; from optimizer.engine import optimize; r=EvaluationRequest.model_validate_json(sys.stdin.read()); print(optimize(r.inputs(),datetime.now(timezone.utc)).model_dump_json())",
      ],
      { input: JSON.stringify(world), encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.chosen.place_id, "taco");
    assert.equal(result.chosen.payable_now.minor, 900);
    assert.equal(
      checkOptimizerAgainstGuards(result, world, meta, new Date()),
      true,
    );
  },
);

test('sample discount, card category cashback and automatic simulated loyalty earn survive the full world contract',{skip:!require('fs').existsSync('optimizer/.venv/Scripts/python.exe')},()=>{
 const args=context();const expiry=new Date(Date.now()+60000).toISOString();args.allowFixtures=true;
 args.offers=[{id:'sample',source:'synthetic_fixture',provenance:'synthetic_fixture',merchant_id:'chipotle',terms_text:'Sample $3 off $15',kind:'amount_off',value:300,min_spend:{minor:1500,currency:'USD'},expires_at:expiry,required_payment_method_ids:['card'],stack_group:'card_linked',verified:true}];
 args.loyalty=[{id:'chipotle_rewards',merchant_id:'chipotle',enrolled:true,simulated:true,earn_terms:{pointsPerDollar:10,pointsProgram:'Chipotle Rewards',cashValue:null}}];
 const {world,meta}=buildWorld(args);const run=require('child_process').spawnSync('optimizer/.venv/Scripts/python.exe',['-c',"import sys; from datetime import datetime,timezone; from optimizer.server import EvaluationRequest; from optimizer.engine import optimize; r=EvaluationRequest.model_validate_json(sys.stdin.read()); print(optimize(r.inputs(),datetime.now(timezone.utc)).model_dump_json())"],{input:JSON.stringify(world),encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);assert.equal(result.chosen.payable_now.minor,1200);assert.equal(result.chosen.verified_cashback.minor,36);assert.deepEqual(result.chosen.points,{'Chipotle Rewards':120});assert.equal(checkOptimizerAgainstGuards(result,world,meta,new Date()),true);
});

test('superstore grocery intent remains eligible while the card keeps its base earn rate',()=>{
 const args=context();args.ledger=args.ledger.map(r=>({...r,brand_key:'walmart',category:'groceries'}));args.routines=args.routines.map(r=>({...r,brand_key:'walmart'}));args.selections=args.selections.map(s=>({...s,brand_key:'walmart'}));const {world}=buildWorld(args);assert.equal(world.items[0].category,'groceries_superstore');assert.ok(world.intent.categories.includes(world.items[0].category));assert.equal(world.payment_methods[0].category_cashback_bps[world.items[0].category],undefined);
});
