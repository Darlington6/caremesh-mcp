import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";

const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Generous budget: a cold spawn here pays for tsx's TS transform, Express startup, and (since
// this is the first time these table names are used) four DynamoDB CreateTable round-trips —
// slower CI runners need real headroom, not just what's comfortable locally.
async function waitForHealthy(baseUrl: string, retries = 60): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`Server at ${baseUrl} did not become healthy in time`);
}

async function startServer(opts: { port: number; authToken?: string }): Promise<{ baseUrl: string; stop: () => void }> {
  const runId = randomUUID().slice(0, 8);
  const child: ChildProcess = spawn("node", ["--import", "tsx", "src/server.ts"], {
    env: {
      ...process.env,
      PORT: String(opts.port),
      DYNAMODB_ENDPOINT,
      CHECKINS_TABLE: `test-auth-checkins-${runId}`,
      MEDICATION_TABLE: `test-auth-medication-${runId}`,
      TASKS_TABLE: `test-auth-tasks-${runId}`,
      HOUSEHOLDS_TABLE: `test-auth-households-${runId}`,
      MCP_AUTH_TOKEN: opts.authToken ?? "",
    },
    stdio: "ignore",
  });
  const baseUrl = `http://localhost:${opts.port}`;
  await waitForHealthy(baseUrl);
  return { baseUrl, stop: () => child.kill() };
}

function initializeRequest(baseUrl: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "0.1.0" } },
    }),
  });
}

// One server per auth mode, shared across that mode's assertions — these are read-only checks
// against the auth middleware itself, not the data layer, so there's nothing for them to step
// on by sharing a server. Cuts this file from 5 full server spawns to 2.

describe("auth disabled (no MCP_AUTH_TOKEN)", () => {
  let baseUrl: string;
  let stop: () => void;

  before(async () => {
    ({ baseUrl, stop } = await startServer({ port: 3501 }));
  });
  after(() => stop());

  test("/mcp accepts requests with no Authorization header", async () => {
    const res = await initializeRequest(baseUrl);
    assert.equal(res.status, 200);
  });
});

describe("auth enabled (MCP_AUTH_TOKEN set)", () => {
  let baseUrl: string;
  let stop: () => void;

  before(async () => {
    ({ baseUrl, stop } = await startServer({ port: 3502, authToken: "secret-token" }));
  });
  after(() => stop());

  test("/mcp rejects requests with no Authorization header", async () => {
    const res = await initializeRequest(baseUrl);
    assert.equal(res.status, 401);
    assert.match(res.headers.get("www-authenticate") ?? "", /Bearer/);
  });

  test("/mcp rejects an incorrect bearer token", async () => {
    const res = await initializeRequest(baseUrl, { Authorization: "Bearer wrong-token" });
    assert.equal(res.status, 401);
  });

  test("/mcp accepts the correct bearer token", async () => {
    const res = await initializeRequest(baseUrl, { Authorization: "Bearer secret-token" });
    assert.equal(res.status, 200);
  });

  test("/healthz stays open (no Authorization header needed)", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);
  });
});
