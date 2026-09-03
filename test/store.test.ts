import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ensureLocalTablesExist } from "../src/dynamodb.js";
import * as store from "../src/store.js";

before(async () => {
  await ensureLocalTablesExist();
});

// Each test uses its own unique "person" partition key rather than a fresh table/file per test,
// since DynamoDB Local table creation is too slow to repeat per test.
function testPerson(label: string): string {
  return `test-${label}-${randomUUID()}`;
}

test("addCheckIn persists and is retrievable via getDayData", async () => {
  const person = testPerson("checkin");
  await store.addCheckIn(person, "Feeling fine", "good");
  const today = new Date().toISOString().slice(0, 10);
  const day = await store.getDayData(person, today);
  assert.equal(day.checkIns.length, 1);
  assert.equal(day.checkIns[0].note, "Feeling fine");
});

test("addMedicationEvent and addCareTask persist independently per person", async () => {
  const mom = testPerson("mom");
  const dad = testPerson("dad");
  await store.addMedicationEvent(mom, "Lisinopril", false);
  await store.addCareTask(mom, "Refill prescription");
  await store.addCareTask(dad, "Book checkup");

  const momTasks = await store.listCareTasks(mom);
  const dadTasks = await store.listCareTasks(dad);
  assert.equal(momTasks.length, 1);
  assert.equal(dadTasks.length, 1);
  assert.equal(momTasks[0].task, "Refill prescription");

  const activity = await store.getRecentActivity(mom);
  assert.equal(activity.medicationEvents.length, 1);
  assert.equal(activity.medicationEvents[0].taken, false);
});

test("getDayData only returns check-ins/medication events from the requested day", async () => {
  const person = testPerson("yesterday");
  await store.addCheckIn(person, "Today's note");
  const yesterday = new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 10);
  const day = await store.getDayData(person, yesterday);
  assert.equal(day.checkIns.length, 0);
});

test("concurrent writes don't clobber each other", async () => {
  const person = testPerson("concurrent");
  await Promise.all(Array.from({ length: 10 }, (_, i) => store.addCareTask(person, `Task ${i}`)));
  const tasks = await store.listCareTasks(person);
  assert.equal(tasks.length, 10);
});
