import test from "node:test";
import assert from "node:assert/strict";
import { calendarDate, calendarDayStart, sameCalendarDay } from "../src/shared/calendar-time.ts";

test("calendar grouping and boundaries use the selected zone across UTC day edges", () => {
  const instant = new Date("2026-10-26T02:00:00Z");
  const day = calendarDate(instant, "America/Los_Angeles");
  assert.equal(day.toISOString(), "2026-10-25T00:00:00.000Z");
  assert.equal(
    calendarDayStart(day, "America/Los_Angeles").toISOString(),
    "2026-10-25T07:00:00.000Z",
  );
  assert.equal(sameCalendarDay(instant.toISOString(), day, "America/Los_Angeles"), true);
  assert.equal(sameCalendarDay(instant.toISOString(), day, "Pacific/Auckland"), false);
  assert.equal(sameCalendarDay(undefined, day, "Pacific/Auckland"), false);
});

test("Calendar daily ranges include all 23 or 25 hours at daylight saving transitions", () => {
  for (const [date, next, hours] of [
    ["2026-03-08", "2026-03-09", 23],
    ["2026-11-01", "2026-11-02", 25],
  ]) {
    const from = calendarDayStart(new Date(`${date}T00:00Z`), "America/New_York");
    const to = calendarDayStart(new Date(`${next}T00:00Z`), "America/New_York");
    assert.equal((to - from) / 3600000, hours);
    assert.equal(
      sameCalendarDay(
        new Date(to.getTime() - 1).toISOString(),
        new Date(`${date}T00:00Z`),
        "America/New_York",
      ),
      true,
    );
    assert.equal(
      sameCalendarDay(to.toISOString(), new Date(`${date}T00:00Z`), "America/New_York"),
      false,
    );
  }
});

test("Calendar boundaries handle skipped midnight and skipped civil dates", () => {
  assert.equal(
    calendarDayStart(new Date("2026-09-06T00:00Z"), "America/Santiago").toISOString(),
    "2026-09-06T04:00:00.000Z",
  );
  assert.equal(
    calendarDayStart(new Date("2011-12-30T00:00Z"), "Pacific/Apia").toISOString(),
    "2011-12-30T10:00:00.000Z",
  );
});
