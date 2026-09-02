import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "caremesh-test-"));
  process.env.DATA_FILE = join(tmpDir, "store.json");
});

afterEach(async () => {
  delete process.env.DATA_FILE;
  await rm(tmpDir, { recursive: true, force: true });
});

// Imported dynamically after DATA_FILE is set, since store.ts reads it at module load time.
async function freshStore() {
  return import(`../src/store.js?t=${Date.now()}-${Math.random()}`);
}

test("addCheckIn persists and is retrievable via getDayData", async () => {
  const store = await freshStore();
  await store.addCheckIn("Mom", "Feeling fine", "good");
  const today = new Date().toISOString().slice(0, 10);
  const day = await store.getDayData("Mom", today);
  assert.equal(day.checkIns.length, 1);
  assert.equal(day.checkIns[0].note, "Feeling fine");
});

test("addMedicationEvent and addCareTask persist independently per person", async () => {
  const store = await freshStore();
  await store.addMedicationEvent("Mom", "Lisinopril", false);
  await store.addCareTask("Mom", "Refill prescription");
  await store.addCareTask("Dad", "Book checkup");

  const momTasks = await store.listCareTasks("Mom");
  const dadTasks = await store.listCareTasks("Dad");
  assert.equal(momTasks.length, 1);
  assert.equal(dadTasks.length, 1);
  assert.equal(momTasks[0].task, "Refill prescription");

  const activity = await store.getRecentActivity("Mom");
  assert.equal(activity.medicationEvents.length, 1);
  assert.equal(activity.medicationEvents[0].taken, false);
});

test("getDayData only returns events from the requested day", async () => {
  const store = await freshStore();
  await store.addCheckIn("Mom", "Today's note");
  const yesterday = new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 10);
  const day = await store.getDayData("Mom", yesterday);
  assert.equal(day.checkIns.length, 0);
});

test("concurrent writes don't clobber each other", async () => {
  const store = await freshStore();
  await Promise.all(Array.from({ length: 10 }, (_, i) => store.addCareTask("Mom", `Task ${i}`)));
  const tasks = await store.listCareTasks("Mom");
  assert.equal(tasks.length, 10);
});
