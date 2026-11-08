import { Temporal } from "@js-temporal/polyfill";
export function calendarYearAfter(
  activation: string | Date,
  purchase: string | Date | null,
  timezone: string,
): string {
  const start = Temporal.Instant.from(new Date(activation).toISOString());
  const last = purchase
    ? Temporal.Instant.from(new Date(purchase).toISOString())
    : start;
  const later = Temporal.Instant.compare(start, last) >= 0 ? start : last;
  // Calendar addition preserves local wall time through DST and clamps Feb 29 to Feb 28.
  return later
    .toZonedDateTimeISO(timezone)
    .add({ years: 1 }, { overflow: "constrain" })
    .toInstant()
    .toString();
}
export function validateTimezone(timezone: string) {
  Temporal.Now.zonedDateTimeISO(timezone);
  return timezone;
}
