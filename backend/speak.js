// Deterministic spoken forms for phone calls. The voice model reads `_spoken` fields exactly,
// so money, dates and percentages are formatted here in code, never by the model.
const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORDINAL_SMALL = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const ORDINAL_TENS = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function speakNumber(value) {
  if (!Number.isSafeInteger(value)) throw new TypeError('speakNumber needs a safe integer.');
  if (value < 0) return `minus ${speakNumber(-value)}`;
  if (value < 20) return SMALL[value];
  if (value < 100) return TENS[Math.floor(value / 10)] + (value % 10 ? ` ${SMALL[value % 10]}` : '');
  for (const [size, word] of [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1000, 'thousand'], [100, 'hundred']]) {
    if (value >= size) return `${speakNumber(Math.floor(value / size))} ${word}${value % size ? ` ${speakNumber(value % size)}` : ''}`;
  }
  return '';
}

function speakOrdinal(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 99) throw new RangeError('speakOrdinal supports 1 to 99.');
  if (value < 20) return ORDINAL_SMALL[value];
  return value % 10 ? `${TENS[Math.floor(value / 10)]} ${ORDINAL_SMALL[value % 10]}` : ORDINAL_TENS[value / 10];
}

const UNITS = { USD: ['dollar', 'dollars', 'cent', 'cents'] };

// Money stays in integer minor units (project rule). 24050 -> "two hundred forty dollars and fifty cents".
function speakMoney(minorUnits, currency = 'USD') {
  if (!Number.isSafeInteger(minorUnits)) throw new TypeError('speakMoney needs integer minor units.');
  const [one, many, centOne, centMany] = UNITS[currency] ?? UNITS.USD;
  if (minorUnits < 0) return `minus ${speakMoney(-minorUnits, currency)}`;
  const major = Math.floor(minorUnits / 100);
  const minor = minorUnits % 100;
  const majorText = `${speakNumber(major)} ${major === 1 ? one : many}`;
  const minorText = `${speakNumber(minor)} ${minor === 1 ? centOne : centMany}`;
  if (major === 0 && minor > 0) return minorText;
  return minor ? `${majorText} and ${minorText}` : majorText;
}

function dayNumber(iso) {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
}

function validIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

// "today", "yesterday", "tomorrow", otherwise "Tuesday, November eleventh" (year added only when it differs).
function speakDate(iso, today) {
  if (!validIsoDate(iso) || !validIsoDate(today)) throw new TypeError('speakDate needs YYYY-MM-DD dates.');
  const offset = dayNumber(iso) - dayNumber(today);
  if (offset === 0) return 'today';
  if (offset === -1) return 'yesterday';
  if (offset === 1) return 'tomorrow';
  const date = new Date(`${iso}T00:00:00Z`);
  const text = `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${speakOrdinal(date.getUTCDate())}`;
  return iso.slice(0, 4) === today.slice(0, 4) ? text : `${text}, ${speakNumber(date.getUTCFullYear())}`;
}

function speakPercent(value) {
  if (!Number.isFinite(value)) throw new TypeError('speakPercent needs a number.');
  const rounded = Math.round(value * 10) / 10;
  const whole = Math.trunc(Math.abs(rounded));
  const tenth = Math.round((Math.abs(rounded) - whole) * 10);
  const text = `${speakNumber(whole)}${tenth ? ` point ${SMALL[tenth]}` : ''} percent`;
  return rounded < 0 ? `minus ${text}` : text;
}

function speakDays(count) {
  return `${speakNumber(count)} ${count === 1 ? 'day' : 'days'}`;
}

module.exports = { speakNumber, speakOrdinal, speakMoney, speakDate, speakPercent, speakDays, validIsoDate, dayNumber };
