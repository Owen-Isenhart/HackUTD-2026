function daypart(hour) {
  if (hour === null) return null;
  if (hour < 5) return 'overnight';
  if (hour < 11) return 'morning';
  if (hour < 14) return 'midday';
  if (hour < 17) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

module.exports = { daypart };
