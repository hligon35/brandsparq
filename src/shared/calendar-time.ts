import { zonedParts, zonedTime } from "./zoned-time";

// A calendar date uses UTC solely as a carrier for year/month/day arithmetic.
// It becomes a real instant only when a query boundary is converted in its zone.
export function calendarDate(instant: Date, timezone: string) {
  return new Date(`${zonedParts(instant, timezone).date}T00:00:00Z`);
}

export function sameCalendarDay(instant: string | undefined, day: Date, timezone: string) {
  return (
    !!instant && zonedParts(new Date(instant), timezone).date === day.toISOString().slice(0, 10)
  );
}

export function calendarDayStart(day: Date, timezone: string) {
  const date = day.toISOString().slice(0, 10);
  const midnight = zonedTime(date, "00:00", timezone);
  if (Number.isFinite(midnight.getTime())) return midnight;
  // Some zones skip midnight, or an entire date. Find the first instant on or
  // after this civil date rather than omitting its first valid hour/minute.
  let low = day.getTime() - 36 * 3600000;
  let high = day.getTime() + 36 * 3600000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (zonedParts(new Date(middle), timezone).date < date) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
}
