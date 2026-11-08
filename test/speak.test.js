const test = require('node:test');
const assert = require('node:assert/strict');
const { speakMoney, speakDate, speakPercent, speakNumber, speakOrdinal } = require('../backend/speak');

test('speak money cases', () => {
  assert.equal(speakMoney(0), 'zero dollars');
  assert.equal(speakMoney(1), 'one cent');
  assert.equal(speakMoney(99), 'ninety nine cents');
  assert.equal(speakMoney(100), 'one dollar');
  assert.equal(speakMoney(101), 'one dollar and one cent');
  assert.equal(speakMoney(24050), 'two hundred forty dollars and fifty cents');
  assert.equal(speakMoney(100000), 'one thousand dollars');
  assert.equal(speakMoney(-24050), 'minus two hundred forty dollars and fifty cents');
  assert.equal(speakMoney(123456789), 'one million two hundred thirty four thousand five hundred sixty seven dollars and eighty nine cents');
  assert.throws(() => speakMoney(10.5));
});

test('speak relative dates and weekdays', () => {
  const today = '2026-11-08';
  assert.equal(speakDate('2026-11-08', today), 'today');
  assert.equal(speakDate('2026-11-07', today), 'yesterday');
  assert.equal(speakDate('2026-11-09', today), 'tomorrow');
  assert.equal(speakDate('2026-11-11', today), 'Wednesday, November eleventh');
  assert.equal(speakDate('2026-11-03', today), 'Tuesday, November third');
  assert.equal(speakDate('2026-10-21', today), 'Wednesday, October twenty first');
  assert.equal(speakDate('2026-10-30', today), 'Friday, October thirtieth');
  assert.equal(speakDate('2025-12-31', today), 'Wednesday, December thirty first, two thousand twenty five');
  assert.throws(() => speakDate('2026-02-30', today));
});

test('speak percent and numbers', () => {
  assert.equal(speakPercent(12), 'twelve percent');
  assert.equal(speakPercent(12.5), 'twelve point five percent');
  assert.equal(speakPercent(-3), 'minus three percent');
  assert.equal(speakNumber(0), 'zero');
  assert.equal(speakOrdinal(22), 'twenty second');
  assert.equal(speakOrdinal(20), 'twentieth');
});
