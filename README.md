# Caremesh MCP

[![CI](https://github.com/Darlington6/caremesh-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Darlington6/caremesh-mcp/actions/workflows/ci.yml)

A self-hosted **Model Context Protocol (MCP)** server (spec `2025-11-25`+, Streamable HTTP) for caretaking coordination — built for the **Build, Ship, Shape: Amazon Developer Hackathon** (Alexa+ track).

A family or caregiver logs check-ins, medication, and shared care tasks for a person they look after. An Alexa+ agent (or any MCP client) can call the server's tools to record events and pull a natural-language daily summary — generated via **Amazon Bedrock** — plus alerts for missed check-ins or medication.

## Hackathon submission info

- **Primary track**: Alexa+, via a self-hosted MCP server over Streamable HTTP (not an Agent Skill).
- **Mini-challenges**: AWS Builder (Amazon Bedrock, see [`src/bedrock.ts`](src/bedrock.ts)), Open Source (this repo, MIT licensed).

## Tools exposed

| Tool | Description |
|---|---|
| `log_checkin` | Record a check-in for a person, with optional note/mood. |
| `log_medication` | Record a medication dose as taken or missed. |
| `add_care_task` | Add a shared caretaking task. |
| `list_care_tasks` | List a person's care tasks. |
| `get_daily_summary` | Natural-language summary of a day's check-ins/meds/tasks (Bedrock-generated, with a local fallback if Bedrock isn't configured). |
| `get_alerts` | Flags a missed check-in or an unresolved missed medication dose. |

## Running it

```bash
npm install
npm run build
npm start
# caremesh-mcp listening on http://localhost:3000 (MCP endpoint: POST /mcp)
```

Or for local development with auto-reload: `npm run dev`.

### Trying it with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Connect to `http://localhost:3000/mcp` using the Streamable HTTP transport, then call the tools listed above directly from the Inspector UI.

### Scripted demo

`npm run demo` boots the server against a fresh temp data file, drives every tool through a realistic caretaking scenario as an MCP client, and prints each step — this is what the hackathon demo video walks through.

### Tests

`npm test` runs the unit test suite (Node's built-in test runner) covering the alerting logic, the fallback summary generator, and the data store. `npm run typecheck` type-checks the whole project (src, tests, and scripts).

## AWS Bedrock setup (for the AWS Builder mini-challenge)

The `get_daily_summary` tool calls Amazon Bedrock's Converse API (see [`src/bedrock.ts`](src/bedrock.ts)) to turn a day's structured events into a short caregiver-facing summary. If no AWS credentials/region are configured, it transparently falls back to a local, deterministic summary so the server still runs standalone — the response says which path (`bedrock` or `fallback`) produced the summary.

To enable real Bedrock calls:

1. Have an AWS account with [model access enabled](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html) for an Anthropic Claude model in your chosen region.
2. Copy `.env.example` to `.env` and set `AWS_REGION` / `BEDROCK_MODEL_ID`.
3. Ensure standard AWS credentials are available (e.g. `AWS_PROFILE`, or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`).

## Project layout

```
src/
  server.ts       Express app + MCP StreamableHTTPServerTransport wiring
  mcp/tools.ts    Tool registrations
  store.ts        JSON-file-backed data store
  bedrock.ts      Bedrock Converse wrapper + local fallback summary
  alerts.ts       Pure alert-computation logic (unit tested)
  types.ts
test/             Unit tests (node:test)
scripts/demo.ts   Scripted end-to-end demo client (also used for the demo video)
.github/workflows/ci.yml   Typecheck + build + test on every push/PR
```

## Product feedback

_To be filled in after building/demoing — per-tool notes on what worked, what didn't, and onboarding friction with the MCP SDK, Express, and Bedrock._

## License

MIT — see [LICENSE](LICENSE).
