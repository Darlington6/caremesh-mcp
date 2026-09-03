import { test } from "node:test";
import assert from "node:assert/strict";
import { fallbackSummary } from "../src/bedrock.js";

const base = { person: "Mom", date: "2026-09-10" };

test("summarizes a clean day", () => {
  const text = fallbackSummary({
    ...base,
    checkIns: [{ id: "1", person: "Mom", mood: "good", timestamp: "2026-09-10T09:00:00.000Z" }],
    medicationEvents: [
      { id: "2", person: "Mom", medication: "Lisinopril", taken: true, timestamp: "2026-09-10T09:05:00.000Z" },
    ],
    careTasks: [],
  });
  assert.match(text, /checked in 1 time/);
  assert.match(text, /All logged medications were taken/);
  assert.match(text, /No open care tasks/);
});

test("calls out no check-ins, missed meds, and open tasks", () => {
  const text = fallbackSummary({
    ...base,
    checkIns: [],
    medicationEvents: [
      { id: "2", person: "Mom", medication: "Lisinopril", taken: false, timestamp: "2026-09-10T09:05:00.000Z" },
    ],
    careTasks: [
      { id: "3", person: "Mom", task: "Refill prescription", done: false, createdAt: "2026-09-09T00:00:00.000Z" },
    ],
  });
  assert.match(text, /No check-ins recorded/);
  assert.match(text, /1 medication dose\(s\) were missed: Lisinopril/);
  assert.match(text, /1 care task\(s\) still open: Refill prescription/);
});
