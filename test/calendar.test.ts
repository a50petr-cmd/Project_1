import assert from "node:assert/strict";
import test from "node:test";
import { isWorkingDay, moscowParts } from "../src/calendar.ts";

test("wednesday in october is a working day in Moscow", () => {
  const date = new Date("2026-10-07T06:00:00Z");
  assert.equal(moscowParts(date).iso, "2026-10-07");
  assert.equal(moscowParts(date).weekday, 3);
  assert.equal(isWorkingDay(date), true);
});

test("saturday and public holidays are not working days", () => {
  assert.equal(isWorkingDay(new Date("2026-10-10T06:00:00Z")), false);
  assert.equal(isWorkingDay(new Date("2026-11-04T06:00:00Z")), false);
  assert.equal(isWorkingDay(new Date("2026-03-09T06:00:00Z")), false);
  assert.equal(isWorkingDay(new Date("2026-03-10T06:00:00Z")), true);
  assert.equal(isWorkingDay(new Date("2027-05-03T06:00:00Z")), false);
});
