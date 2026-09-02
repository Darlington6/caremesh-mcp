import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAlerts } from "../src/alerts.js";
import type { CheckIn, MedicationEvent } from "../src/types.js";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");

function checkIn(hoursAgo: number): CheckIn {
  return {
    id: "c1",
    person: "Mom",
    timestamp: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  };
}

function med(hoursAgo: number, taken: boolean, medication = "Lisinopril"): MedicationEvent {
  return {
    id: "m1",
    person: "Mom",
    medication,
    taken,
    timestamp: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  };
}

test("no alerts when recent check-in and all meds taken", () => {
  const alerts = computeAlerts("Mom", [checkIn(2)], [med(2, true)], NOW);
  assert.deepEqual(alerts, []);
});

test("flags no check-in ever recorded", () => {
  const alerts = computeAlerts("Mom", [], [], NOW);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /No check-in has ever been recorded/);
});

test("flags an overdue check-in (> 24h)", () => {
  const alerts = computeAlerts("Mom", [checkIn(30)], [], NOW);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /No check-in for Mom in 30 hours/);
});

test("does not flag a check-in within the 24h window", () => {
  const alerts = computeAlerts("Mom", [checkIn(10)], [], NOW);
  assert.deepEqual(alerts, []);
});

test("flags a missed medication with no follow-up taken dose", () => {
  const alerts = computeAlerts("Mom", [checkIn(1)], [med(5, false)], NOW);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /Missed medication "Lisinopril"/);
});

test("does not flag a missed medication once a later dose was taken", () => {
  const alerts = computeAlerts("Mom", [checkIn(1)], [med(10, false), med(4, true)], NOW);
  assert.deepEqual(alerts, []);
});

test("does not flag a missed medication older than the stale window", () => {
  const alerts = computeAlerts("Mom", [checkIn(1)], [med(9 * 24, false)], NOW);
  assert.deepEqual(alerts, []);
});

test("can flag both an overdue check-in and a missed medication at once", () => {
  const alerts = computeAlerts("Mom", [checkIn(48)], [med(6, false)], NOW);
  assert.equal(alerts.length, 2);
});
