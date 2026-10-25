export function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}
export function zonedTime(date: string, time: string, timezone: string): Date {
  try {
    const target = Date.parse(`${date}T${time}:00Z`);
    if (!Number.isFinite(target)) return new Date(NaN);
    let instant = target;
    for (let i = 0; i < 4; i++) {
      const parts = zonedParts(new Date(instant), timezone);
      const asUTC = Date.parse(`${parts.date}T${parts.time}:00Z`);
      const adjustment = target - asUTC;
      if (!adjustment) break;
      instant += adjustment;
    }
    const check = zonedParts(new Date(instant), timezone);
    return check.date === date && check.time === time ? new Date(instant) : new Date(NaN);
  } catch {
    return new Date(NaN);
  }
}
