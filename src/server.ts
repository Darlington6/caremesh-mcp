import "./env.js";
import express from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerCaretakingTools } from "./mcp/tools.js";
import { ensureLocalTablesExist } from "./dynamodb.js";

const PORT = Number(process.env.PORT ?? 3000);

function buildServer(): McpServer {
  const server = new McpServer({ name: "caremesh-mcp", version: "0.1.0" });
  registerCaretakingTools(server);
  return server;
}

const app = express();
app.use(helmet());
app.use(express.json());

// Public-facing endpoint (this is what a deployed instance exposes to the internet), rate limited
// to blunt casual abuse. /healthz is exempt since ECS/ALB health checks hit it continuously.
app.use(
  "/mcp",
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

// Optional bearer-token auth: set MCP_AUTH_TOKEN to require `Authorization: Bearer <token>` on
// every /mcp request. Unset (the local/dev default) disables the check entirely; a real
// deployment should always set this. Constant-time comparison to avoid a timing side-channel.
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

function isValidToken(provided: string): boolean {
  const expected = Buffer.from(MCP_AUTH_TOKEN!);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

app.use("/mcp", (req, res, next) => {
  if (!MCP_AUTH_TOKEN) {
    next();
    return;
  }
  const header = req.header("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (provided && isValidToken(provided)) {
    next();
    return;
  }
  // RFC 7235 requires a WWW-Authenticate header on 401s. Also makes it explicit to any client
  // that this is a plain bearer token, not an OAuth-protected resource. This server doesn't
  // implement MCP's OAuth flow (see docs/ARCHITECTURE.md for why), so a client that tries OAuth
  // discovery here (e.g. POSTing to a dynamic client registration endpoint) will 404.
  res.set("WWW-Authenticate", 'Bearer realm="caremesh-mcp"');
  res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
});

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
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "No valid session; send an initialize request first." },
      id: null,
    });
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

// Not a web app; this is here so a human clicking the bare URL (e.g. from a submission page)
// sees something useful instead of Express's default "Cannot GET /".
app.get("/", (_req, res) => {
  res
    .type("text/plain")
    .send(
      [
        "caremesh-mcp: a self-hosted MCP server (spec 2025-11-25, Streamable HTTP) for caretaking coordination.",
        "",
        "This isn't a web page. It's an API for MCP clients (Alexa+, MCP Inspector, etc.).",
        "",
        "Connect via Streamable HTTP: POST /mcp" + (MCP_AUTH_TOKEN ? " (requires Authorization: Bearer <token>)" : ""),
        "Health check: GET /healthz",
        "",
        "Source, docs, and setup instructions: https://github.com/Darlington6/caremesh-mcp",
      ].join("\n"),
    );
});

// DYNAMODB_ENDPOINT is only set for local dev / CI against DynamoDB Local. A real deployment
// provisions tables ahead of time, so the app's IAM role doesn't need CreateTable permission.
if (process.env.DYNAMODB_ENDPOINT) {
  await ensureLocalTablesExist();
}

const server = app.listen(PORT, () => {
  console.log(`caremesh-mcp listening on http://localhost:${PORT} (MCP endpoint: POST /mcp)`);
  console.log(
    MCP_AUTH_TOKEN
      ? "Auth: enabled (Authorization: Bearer <token> required)"
      : "Auth: disabled (MCP_AUTH_TOKEN not set)",
  );
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received, shutting down...`);
  server.close();
  await Promise.all([...transports.values()].map((t) => t.close()));
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
