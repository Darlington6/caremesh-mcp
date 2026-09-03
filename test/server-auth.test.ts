import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";

const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealthy(baseUrl: string, retries = 30): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(300);
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

test("auth disabled (no MCP_AUTH_TOKEN): /mcp accepts requests with no Authorization header", async () => {
  const { baseUrl, stop } = await startServer({ port: 3501 });
  after(stop);
  const res = await initializeRequest(baseUrl);
  assert.equal(res.status, 200);
});

test("auth enabled: /mcp rejects requests with no Authorization header", async () => {
  const { baseUrl, stop } = await startServer({ port: 3502, authToken: "secret-token" });
  after(stop);
  const res = await initializeRequest(baseUrl);
  assert.equal(res.status, 401);
});

test("auth enabled: /mcp rejects an incorrect bearer token", async () => {
  const { baseUrl, stop } = await startServer({ port: 3503, authToken: "secret-token" });
  after(stop);
  const res = await initializeRequest(baseUrl, { Authorization: "Bearer wrong-token" });
  assert.equal(res.status, 401);
});

test("auth enabled: /mcp accepts the correct bearer token", async () => {
  const { baseUrl, stop } = await startServer({ port: 3504, authToken: "secret-token" });
  after(stop);
  const res = await initializeRequest(baseUrl, { Authorization: "Bearer secret-token" });
  assert.equal(res.status, 200);
});

test("auth enabled: /healthz stays open (no Authorization header needed)", async () => {
  const { baseUrl, stop } = await startServer({ port: 3505, authToken: "secret-token" });
  after(stop);
  const res = await fetch(`${baseUrl}/healthz`);
  assert.equal(res.status, 200);
});
