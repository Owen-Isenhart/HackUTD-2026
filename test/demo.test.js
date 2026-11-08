const assert = require('node:assert/strict');
const test = require('node:test');
const { merchants, recommend } = require('../scripts/demo-profile');

test('the cheaper option is compared against the price after cashback', () => {
  const result = recommend(merchants[0]);
  assert.equal(result.remaining, 300);
  assert.equal(result.reward, 31);
  assert.equal(result.netPrice, 594);
  assert.equal(result.savings, 319);
  assert.match(result.advice, /\$2.94 over budget/);
  assert.match(result.alternative, /Campus Coffee.*\$3.19/);
});
