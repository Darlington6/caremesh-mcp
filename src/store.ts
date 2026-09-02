import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { CareTask, CheckIn, MedicationEvent, StoreData } from "./types.js";

const DATA_FILE = process.env.DATA_FILE ?? new URL("../data/store.json", import.meta.url).pathname;

const EMPTY: StoreData = { checkIns: [], medicationEvents: [], careTasks: [] };

async function load(): Promise<StoreData> {
  try {
    const raw = await readFile(DATA_FILE, "utf-8");
    return JSON.parse(raw) as StoreData;
  } catch {
    return structuredClone(EMPTY);
  }
}

async function save(data: StoreData): Promise<void> {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// Serializes writes so concurrent tool calls can't clobber each other's read-modify-write.
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: (data: StoreData) => Promise<T> | T): Promise<T> {
  const result = writeQueue.then(async () => {
    const data = await load();
    const value = await fn(data);
    await save(data);
    return value;
  });
  writeQueue = result.catch(() => undefined);
  return result;
}

export async function addCheckIn(person: string, note?: string, mood?: string): Promise<CheckIn> {
  return enqueue((data) => {
    const entry: CheckIn = { id: randomUUID(), person, note, mood, timestamp: new Date().toISOString() };
    data.checkIns.push(entry);
    return entry;
  });
}

export async function addMedicationEvent(person: string, medication: string, taken: boolean): Promise<MedicationEvent> {
  return enqueue((data) => {
    const entry: MedicationEvent = { id: randomUUID(), person, medication, taken, timestamp: new Date().toISOString() };
    data.medicationEvents.push(entry);
    return entry;
  });
}

export async function addCareTask(person: string, task: string, due?: string): Promise<CareTask> {
  return enqueue((data) => {
    const entry: CareTask = { id: randomUUID(), person, task, due, done: false, createdAt: new Date().toISOString() };
    data.careTasks.push(entry);
    return entry;
  });
}

export async function listCareTasks(person: string): Promise<CareTask[]> {
  const data = await load();
  return data.careTasks.filter((t) => t.person === person);
}

export async function getDayData(person: string, isoDate: string) {
  const data = await load();
  const onDay = (ts: string) => ts.slice(0, 10) === isoDate;
  return {
    checkIns: data.checkIns.filter((c) => c.person === person && onDay(c.timestamp)),
    medicationEvents: data.medicationEvents.filter((m) => m.person === person && onDay(m.timestamp)),
    careTasks: data.careTasks.filter((t) => t.person === person),
  };
}

export async function getRecentActivity(person: string) {
  const data = await load();
  return {
    checkIns: data.checkIns.filter((c) => c.person === person).sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    medicationEvents: data.medicationEvents
      .filter((m) => m.person === person)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
  };
}
