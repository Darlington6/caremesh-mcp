import express from "express";
import { randomUUID } from "node:crypto";

try {
  process.loadEnvFile();
} catch {
  // no .env file present — fine, fall back to whatever's already in the environment
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerCaretakingTools } from "./mcp/tools.js";

const PORT = Number(process.env.PORT ?? 3000);

function buildServer(): McpServer {
  const server = new McpServer({ name: "caremesh-mcp", version: "0.1.0" });
  registerCaretakingTools(server);
  return server;
}

const app = express();
app.use(express.json());

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
  const sessionId = req.header("mcp-session-id");
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      },
    });
    transport.onclose = () => {
      if (transport!.sessionId) transports.delete(transport!.sessionId);
    };
    const server = buildServer();
    await server.connect(transport);
  }

  if (!transport) {
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "No valid session; send an initialize request first." }, id: null });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.header("mcp-session-id");
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Unknown or missing session");
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.header("mcp-session-id");
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Unknown or missing session");
    return;
  }
  await transport.handleRequest(req, res);
});

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", activeSessions: transports.size });
});

app.listen(PORT, () => {
  console.log(`caremesh-mcp listening on http://localhost:${PORT} (MCP endpoint: POST /mcp)`);
});
