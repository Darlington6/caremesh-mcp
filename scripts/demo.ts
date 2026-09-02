/**
 * Boots the MCP server, walks through a full caretaking scenario as an MCP client,
 * and prints each step. Built to be run on camera for the hackathon demo video.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.env.PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
// Fresh data file per run so the demo is repeatable (doesn't accumulate state across takes).
const DEMO_DATA_FILE = join(mkdtempSync(join(tmpdir(), "caremesh-demo-")), "store.json");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealthy(retries = 30): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${BASE_URL}/healthz`);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await sleep(300);
  }
  throw new Error("Server did not become healthy in time");
}

function startServer(): ChildProcess {
  const child = spawn("node", ["dist/server.js"], {
    env: { ...process.env, PORT: String(PORT), DATA_FILE: DEMO_DATA_FILE },
    stdio: "inherit",
  });
  return child;
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

function printToolResult(label: string, result: Awaited<ReturnType<Client["callTool"]>>) {
  const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text ?? "";
  console.log(`${label}\n${text}`);
}

async function main() {
  console.log(`Starting caremesh-mcp on port ${PORT} for the demo...`);
  const server = startServer();

  try {
    await waitForHealthy();

    const client = new Client({ name: "caremesh-demo-client", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`));
    await client.connect(transport);

    const person = "Mom";

    section("Logging a check-in");
    printToolResult(
      "log_checkin ->",
      await client.callTool({ name: "log_checkin", arguments: { person, note: "Had breakfast, watching TV", mood: "good" } })
    );

    section("Logging a missed medication dose");
    printToolResult(
      "log_medication ->",
      await client.callTool({ name: "log_medication", arguments: { person, medication: "Lisinopril", taken: false } })
    );

    section("Adding a care task");
    printToolResult(
      "add_care_task ->",
      await client.callTool({ name: "add_care_task", arguments: { person, task: "Refill prescription", due: "2026-09-05" } })
    );

    section("Listing care tasks");
    printToolResult("list_care_tasks ->", await client.callTool({ name: "list_care_tasks", arguments: { person } }));

    section("Getting the daily summary");
    printToolResult("get_daily_summary ->", await client.callTool({ name: "get_daily_summary", arguments: { person } }));

    section("Checking alerts");
    printToolResult("get_alerts ->", await client.callTool({ name: "get_alerts", arguments: { person } }));

    await client.close();
    console.log("\nDemo complete.");
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
