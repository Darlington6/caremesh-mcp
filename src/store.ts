import { randomUUID } from "node:crypto";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES } from "./dynamodb.js";
import type { CareTask, CheckIn, MedicationEvent } from "./types.js";

export async function addCheckIn(person: string, note?: string, mood?: string): Promise<CheckIn> {
  const entry: CheckIn = { id: randomUUID(), person, note, mood, timestamp: new Date().toISOString() };
  await ddb.send(new PutCommand({ TableName: TABLES.checkIns, Item: entry }));
  return entry;
}

export async function addMedicationEvent(person: string, medication: string, taken: boolean): Promise<MedicationEvent> {
  const entry: MedicationEvent = { id: randomUUID(), person, medication, taken, timestamp: new Date().toISOString() };
  await ddb.send(new PutCommand({ TableName: TABLES.medicationEvents, Item: entry }));
  return entry;
}

export async function addCareTask(person: string, task: string, due?: string): Promise<CareTask> {
  const entry: CareTask = { id: randomUUID(), person, task, due, done: false, createdAt: new Date().toISOString() };
  await ddb.send(new PutCommand({ TableName: TABLES.careTasks, Item: entry }));
  return entry;
}

export async function listCareTasks(person: string): Promise<CareTask[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLES.careTasks,
      KeyConditionExpression: "person = :p",
      ExpressionAttributeValues: { ":p": person },
    }),
  );
  const tasks = (result.Items ?? []) as CareTask[];
  return tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getDayData(person: string, isoDate: string) {
  const dayQuery = (tableName: string) =>
    ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "person = :p AND begins_with(#ts, :date)",
        ExpressionAttributeNames: { "#ts": "timestamp" },
        ExpressionAttributeValues: { ":p": person, ":date": isoDate },
      }),
    );

  const [checkInsResult, medicationResult, careTasks] = await Promise.all([
    dayQuery(TABLES.checkIns),
    dayQuery(TABLES.medicationEvents),
    listCareTasks(person),
  ]);

  return {
    checkIns: (checkInsResult.Items ?? []) as CheckIn[],
    medicationEvents: (medicationResult.Items ?? []) as MedicationEvent[],
    careTasks,
  };
}

export async function getRecentActivity(person: string) {
  const recentQuery = (tableName: string) =>
    ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "person = :p",
        ExpressionAttributeValues: { ":p": person },
        ScanIndexForward: false, // timestamp is an ISO string, so lexicographic desc == chronological desc
      }),
    );

  const [checkInsResult, medicationResult] = await Promise.all([
    recentQuery(TABLES.checkIns),
    recentQuery(TABLES.medicationEvents),
  ]);

  return {
    checkIns: (checkInsResult.Items ?? []) as CheckIn[],
    medicationEvents: (medicationResult.Items ?? []) as MedicationEvent[],
  };
}

// Members are stored as a DynamoDB String Set so adding the same person twice is a no-op and
// concurrent adds to different people can't clobber each other (no read-modify-write needed).
export async function addHouseholdMember(household: string, person: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLES.households,
      Key: { household },
      UpdateExpression: "ADD members :p",
      ExpressionAttributeValues: { ":p": new Set([person]) },
    }),
  );
}

export async function listHouseholdMembers(household: string): Promise<string[]> {
  const result = await ddb.send(new GetCommand({ TableName: TABLES.households, Key: { household } }));
  const members = (result.Item?.members as Set<string> | undefined) ?? new Set<string>();
  return [...members].sort();
}
