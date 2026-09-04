import "./env.js";
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
  type KeySchemaElement,
  type AttributeDefinition,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const TABLES = {
  checkIns: process.env.CHECKINS_TABLE ?? "caremesh-checkins",
  medicationEvents: process.env.MEDICATION_TABLE ?? "caremesh-medication-events",
  careTasks: process.env.TASKS_TABLE ?? "caremesh-care-tasks",
  households: process.env.HOUSEHOLDS_TABLE ?? "caremesh-households",
} as const;

const isLocal = Boolean(process.env.DYNAMODB_ENDPOINT);

const rawClient = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT, // set for DynamoDB Local (dev/CI); unset in real AWS
  // DynamoDB Local still requires *some* credentials to sign requests, even though it never
  // validates them. In real AWS (no DYNAMODB_ENDPOINT) we rely on the normal SDK credential
  // chain (IAM task role in ECS) instead, so this is only supplied for the local case.
  ...(isLocal && { credentials: { accessKeyId: "local", secretAccessKey: "local" } }),
});

export const ddb = DynamoDBDocumentClient.from(rawClient);

interface TableSpec {
  name: string;
  keySchema: KeySchemaElement[];
  attributeDefinitions: AttributeDefinition[];
}

const TABLE_SPECS: TableSpec[] = [
  { name: TABLES.checkIns, sortKey: "timestamp" },
  { name: TABLES.medicationEvents, sortKey: "timestamp" },
  { name: TABLES.careTasks, sortKey: "id" },
].map(({ name, sortKey }) => ({
  name,
  keySchema: [
    { AttributeName: "person", KeyType: "HASH" },
    { AttributeName: sortKey, KeyType: "RANGE" },
  ],
  attributeDefinitions: [
    { AttributeName: "person", AttributeType: "S" },
    { AttributeName: sortKey, AttributeType: "S" },
  ],
}));

TABLE_SPECS.push({
  name: TABLES.households,
  keySchema: [{ AttributeName: "household", KeyType: "HASH" }],
  attributeDefinitions: [{ AttributeName: "household", AttributeType: "S" }],
});

/**
 * Idempotently creates the tables against DYNAMODB_ENDPOINT. Only meant for local dev / CI
 * against DynamoDB Local. A real deployment provisions tables ahead of time (see README),
 * since the app's IAM role shouldn't need CreateTable permission in production.
 */
export async function ensureLocalTablesExist(): Promise<void> {
  // The tables are independent of each other, so check/create them concurrently rather than
  // paying for four round-trips in sequence on every startup.
  await Promise.all(
    TABLE_SPECS.map(async ({ name, keySchema, attributeDefinitions }) => {
      const exists = await rawClient
        .send(new DescribeTableCommand({ TableName: name }))
        .then(() => true)
        .catch((err) => {
          if (err instanceof ResourceNotFoundException) return false;
          throw err;
        });
      if (exists) return;

      await rawClient.send(
        new CreateTableCommand({
          TableName: name,
          AttributeDefinitions: attributeDefinitions,
          KeySchema: keySchema,
          BillingMode: "PAY_PER_REQUEST",
        }),
      );
    }),
  );
}
