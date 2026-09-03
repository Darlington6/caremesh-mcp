import "./env.js";
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const TABLES = {
  checkIns: process.env.CHECKINS_TABLE ?? "caremesh-checkins",
  medicationEvents: process.env.MEDICATION_TABLE ?? "caremesh-medication-events",
  careTasks: process.env.TASKS_TABLE ?? "caremesh-care-tasks",
} as const;

const isLocal = Boolean(process.env.DYNAMODB_ENDPOINT);

const rawClient = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT, // set for DynamoDB Local (dev/CI); unset in real AWS
  // DynamoDB Local still requires *some* credentials to sign requests, even though it never
  // validates them — in real AWS (no DYNAMODB_ENDPOINT) we rely on the normal SDK credential
  // chain (IAM task role in ECS) instead, so this is only supplied for the local case.
  ...(isLocal && { credentials: { accessKeyId: "local", secretAccessKey: "local" } }),
});

export const ddb = DynamoDBDocumentClient.from(rawClient);

/**
 * Idempotently creates the three tables against DYNAMODB_ENDPOINT. Only meant for local dev /
 * CI against DynamoDB Local — a real deployment provisions tables ahead of time (see README),
 * since the app's IAM role shouldn't need CreateTable permission in production.
 */
export async function ensureLocalTablesExist(): Promise<void> {
  const tables: Array<{ name: string; sortKey: string }> = [
    { name: TABLES.checkIns, sortKey: "timestamp" },
    { name: TABLES.medicationEvents, sortKey: "timestamp" },
    { name: TABLES.careTasks, sortKey: "id" },
  ];

  for (const { name, sortKey } of tables) {
    const exists = await rawClient
      .send(new DescribeTableCommand({ TableName: name }))
      .then(() => true)
      .catch((err) => {
        if (err instanceof ResourceNotFoundException) return false;
        throw err;
      });
    if (exists) continue;

    await rawClient.send(
      new CreateTableCommand({
        TableName: name,
        AttributeDefinitions: [
          { AttributeName: "person", AttributeType: "S" },
          { AttributeName: sortKey, AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "person", KeyType: "HASH" },
          { AttributeName: sortKey, KeyType: "RANGE" },
        ],
        BillingMode: "PAY_PER_REQUEST",
      }),
    );
  }
}
