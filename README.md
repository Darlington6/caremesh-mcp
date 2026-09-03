# Caremesh MCP

[![CI](https://github.com/Darlington6/caremesh-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Darlington6/caremesh-mcp/actions/workflows/ci.yml)

A self-hosted **Model Context Protocol (MCP)** server (spec `2025-11-25`+, Streamable HTTP) for caretaking coordination — built for the **Build, Ship, Shape: Amazon Developer Hackathon** (Alexa+ track).

A family or caregiver logs check-ins, medication, and shared care tasks for a person they look after. An Alexa+ agent (or any MCP client) can call the server's tools to record events and pull a natural-language daily summary — generated via **Amazon Bedrock** — plus alerts for missed check-ins or medication.

## The problem

Informal caregiving is coordination work, and it's usually invisible: an adult child checking on a parent, siblings splitting medication reminders, a home aide covering a rotating schedule. That coordination tends to live in scattered text threads, sticky notes, or someone's memory — there's no shared, low-friction record of "did the check-in happen today" or "was the medication actually taken," and gaps only surface after they've already caused a problem.

## The solution

Caremesh gives that coordination a voice-first front end instead of another app to open. Because it's an MCP server, an Alexa+ agent can log a check-in or a medication dose the moment it happens — no typing, no app switch — and later answer "how's Mom doing today?" with a real, Bedrock-generated summary pulled from what was actually logged, or flag that something's been missed. The MCP layer also means it isn't locked to Alexa+: any MCP-compatible client can drive the same tools.

## Use cases

- **Remote adult child.** Checks in on an aging parent by voice through Alexa+ each morning; later in the day asks for a summary before calling them, instead of guessing how things are going.
- **Rotating family caregivers.** Multiple people share medication and task-logging duties across a week; `list_care_tasks` and `get_alerts` give whoever's on duty a shared, current picture instead of a group chat scroll.
- **Home health aide.** Logs a visit's check-in and medication status on the way out, so the family has a record without the aide needing to file a separate report.

## Hackathon submission info

- **Primary track**: Alexa+, via a self-hosted MCP server over Streamable HTTP (not an Agent Skill).
- **Mini-challenges**: AWS Builder (Amazon Bedrock — [`src/bedrock.ts`](src/bedrock.ts) — and Amazon DynamoDB — [`src/store.ts`](src/store.ts)/[`src/dynamodb.ts`](src/dynamodb.ts)), Open Source (this repo, MIT licensed).

## Tools exposed

| Tool                | Description                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `log_checkin`       | Record a check-in for a person, with optional note/mood.                                                                         |
| `log_medication`    | Record a medication dose as taken or missed.                                                                                     |
| `add_care_task`     | Add a shared caretaking task.                                                                                                    |
| `list_care_tasks`   | List a person's care tasks.                                                                                                      |
| `get_daily_summary` | Natural-language summary of a day's check-ins/meds/tasks (Bedrock-generated, with a local fallback if Bedrock isn't configured). |
| `get_alerts`        | Flags a missed check-in or an unresolved missed medication dose.                                                                 |

## Running it

Data is stored in **Amazon DynamoDB**. Locally (and in CI) that means [DynamoDB Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html) in Docker — no AWS account needed to run or test this:

```bash
docker run -d -p 8000:8000 amazon/dynamodb-local:latest

cp .env.example .env   # DYNAMODB_ENDPOINT already points at the container above
npm install
npm run build
npm start
# caremesh-mcp listening on http://localhost:3000 (MCP endpoint: POST /mcp)
```

The server creates its DynamoDB tables automatically on startup _only_ when `DYNAMODB_ENDPOINT` is set (i.e. local/CI) — a real deployment provisions tables ahead of time instead (see [Deploying](#deploying-amazon-ecs-express-mode)).

Or for local development with auto-reload: `npm run dev`.

### Trying it with MCP Inspector

With the server running (`npm start`) in one terminal, in another:

```bash
npx @modelcontextprotocol/inspector@latest
```

In the Inspector UI: set **Transport Type** to `Streamable HTTP` (not the default `STDIO`), set the URL to `http://localhost:3000/mcp`, then click **Connect**. Ignore the pre-filled `Command`/`Arguments` fields — those are only used for the STDIO transport. Once connected, the **Tools** tab lists and lets you call each tool above.

Connecting to a deployed instance instead of localhost? If `MCP_AUTH_TOKEN` is set there, add an `Authorization: Bearer <token>` custom header in Inspector's connection settings, or every request gets a 401.

### Scripted demo

`npm run demo` boots the server against a fresh set of DynamoDB tables (unique names per run, so it's repeatable), drives every tool through a realistic caretaking scenario as an MCP client, and prints each step — this is what the hackathon demo video walks through. Requires DynamoDB Local running (see above).

### Tests, linting, formatting

```bash
npm test            # unit tests (node:test) — alerts, fallback summary, the store
npm run typecheck   # type-checks src, test, and scripts
npm run lint         # ESLint
npm run format:check # Prettier check (npm run format to auto-fix)
```

All four run in CI on every push/PR (against a DynamoDB Local service container). Use `nvm use` first if you have nvm installed — `.nvmrc` pins the Node version this project targets. `npm test` needs DynamoDB Local running locally too (see [Running it](#running-it)).

## AWS Bedrock setup (for the AWS Builder mini-challenge)

The `get_daily_summary` tool calls Amazon Bedrock's Converse API (see [`src/bedrock.ts`](src/bedrock.ts)) to turn a day's structured events into a short caregiver-facing summary. If no AWS credentials/region are configured, it transparently falls back to a local, deterministic summary so the server still runs standalone — the response says which path (`bedrock` or `fallback`) produced the summary.

To enable real Bedrock calls:

1. Have an AWS account with [model access enabled](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html) for an Anthropic Claude model in your chosen region.
2. Copy `.env.example` to `.env` and set `AWS_REGION` / `BEDROCK_MODEL_ID`.
3. Ensure standard AWS credentials are available (e.g. `AWS_PROFILE`, or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`).

## Deploying (Amazon ECS Express Mode)

For a live demo link, this deploys as a container to Amazon ECS Express Mode — AWS's recommended replacement for App Runner (which is closed to new customers). One CLI call provisions a Fargate service, an Application Load Balancer, and autoscaling.

**Prerequisites** (one-time AWS account setup — do this once you have credits/credentials):

1. AWS CLI installed and configured (`aws configure`) with an account that has ECS/ECR/IAM/DynamoDB permissions.
2. An ECR repository: `aws ecr create-repository --repository-name caremesh-mcp`
3. The three DynamoDB tables (production doesn't auto-create tables — see [Architecture](#architecture) for why):
   ```bash
   for table in caremesh-checkins caremesh-medication-events; do
     aws dynamodb create-table --table-name "$table" \
       --attribute-definitions AttributeName=person,AttributeType=S AttributeName=timestamp,AttributeType=S \
       --key-schema AttributeName=person,KeyType=HASH AttributeName=timestamp,KeyType=RANGE \
       --billing-mode PAY_PER_REQUEST
   done
   aws dynamodb create-table --table-name caremesh-care-tasks \
     --attribute-definitions AttributeName=person,AttributeType=S AttributeName=id,AttributeType=S \
     --key-schema AttributeName=person,KeyType=HASH AttributeName=id,KeyType=RANGE \
     --billing-mode PAY_PER_REQUEST
   ```
4. An auth token, stored as a secret rather than plaintext (the app requires `Authorization: Bearer <token>` on `/mcp` whenever `MCP_AUTH_TOKEN` is set — see [Known limitations](#known-limitations)):
   ```bash
   TOKEN=$(openssl rand -hex 32)
   aws secretsmanager create-secret --name caremesh-mcp/auth-token --secret-string "$TOKEN"
   # save $TOKEN somewhere safe — you'll hand it to whatever MCP client (Alexa+, Inspector) calls the deployed server
   ```
5. Two IAM roles ECS Express Mode requires:
   - `ecsTaskExecutionRole` — standard ECS role with the `AmazonECSTaskExecutionRolePolicy` managed policy attached (pulls the image, writes logs), **plus** an inline policy granting `secretsmanager:GetSecretValue` on the secret above — the execution role, not the task role, is what ECS uses to inject `secrets` into the container at startup.
   - `ecsInfrastructureRoleForExpressServices` — see [ECS Express Mode setup](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-getting-started.html#express-service-create-execution-role) for the exact trust policy.
6. A **task role** (application-level permissions, separate from the execution role above) with a policy allowing `bedrock:InvokeModel` on the model in `.env`'s `BEDROCK_MODEL_ID`, and `dynamodb:GetItem`/`PutItem`/`Query` on the three table ARNs above — this is what lets the deployed container call Bedrock and DynamoDB without embedding access keys; the AWS SDK picks both up automatically via the container credentials chain.
7. A CloudWatch log group, e.g. `aws logs create-log-group --log-group-name /ecs/caremesh-mcp`

**Build and push the image:**

```bash
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account-id>.dkr.ecr.<region>.amazonaws.com
docker build -t caremesh-mcp .
docker tag caremesh-mcp:latest <account-id>.dkr.ecr.<region>.amazonaws.com/caremesh-mcp:latest
docker push <account-id>.dkr.ecr.<region>.amazonaws.com/caremesh-mcp:latest
```

**Deploy:**

```bash
aws ecs create-express-gateway-service \
  --service-name caremesh-mcp \
  --execution-role-arn arn:aws:iam::<account-id>:role/ecsTaskExecutionRole \
  --infrastructure-role-arn arn:aws:iam::<account-id>:role/ecsInfrastructureRoleForExpressServices \
  --task-role-arn arn:aws:iam::<account-id>:role/caremesh-bedrock-task-role \
  --primary-container '{
    "image": "<account-id>.dkr.ecr.<region>.amazonaws.com/caremesh-mcp:latest",
    "containerPort": 3000,
    "awsLogsConfiguration": { "logGroup": "/ecs/caremesh-mcp", "logStreamPrefix": "ecs" },
    "environment": [
      { "name": "AWS_REGION", "value": "<region>" },
      { "name": "BEDROCK_MODEL_ID", "value": "anthropic.claude-3-5-sonnet-20241022-v2:0" }
    ],
    "secrets": [
      { "name": "MCP_AUTH_TOKEN", "valueFrom": "arn:aws:secretsmanager:<region>:<account-id>:secret:caremesh-mcp/auth-token" }
    ]
  }' \
  --health-check-path "/healthz" \
  --scaling-target '{"minTaskCount":1,"maxTaskCount":1}' \
  --monitor-resources
```

Note `DYNAMODB_ENDPOINT` is deliberately **not** set here — leaving it unset is what makes the app talk to real regional DynamoDB via the task role instead of DynamoDB Local.

`minTaskCount`/`maxTaskCount` are pinned to `1` deliberately — the server keeps MCP session state in memory, so it must run as a single instance (multiple replicas behind the load balancer would break session continuity between requests). This is fine for a hackathon demo; it would need a shared session store (e.g. DynamoDB/Redis) to scale beyond one instance.

The command prints a default public URL once provisioning completes (typically 3-5 minutes) — that becomes the live "Try it out" link, pointing MCP clients at `<url>/mcp`.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a component diagram, a sequence diagram of a full tool call, the data model, and the reasoning behind the main design decisions (why Streamable HTTP, why a single instance, why the Bedrock fallback exists).

## Project layout

```
src/
  server.ts       Express app + MCP StreamableHTTPServerTransport wiring, hardening, graceful shutdown
  env.ts          Loads .env — imported first by every module that reads process.env at load time
  mcp/tools.ts    Tool registrations
  store.ts        Data access layer (DynamoDB)
  dynamodb.ts     DynamoDB client + local-only table auto-creation
  bedrock.ts      Bedrock Converse wrapper + local fallback summary
  alerts.ts       Pure alert-computation logic (unit tested)
  types.ts
test/             Unit tests (node:test), run against DynamoDB Local
scripts/demo.ts   Scripted end-to-end demo client (also used for the demo video)
docs/ARCHITECTURE.md       Diagrams and design decisions
.github/workflows/ci.yml   Lint + format + typecheck + build + test on every push/PR
.github/dependabot.yml     Weekly dependency update checks
Dockerfile                 Multi-stage build for container deployment (see Deploying, above)
```

## Known limitations

- **Auth is opt-in, not enforced.** Setting `MCP_AUTH_TOKEN` requires `Authorization: Bearer <token>` on every `/mcp` request (see `src/server.ts`) — but it's unset by default locally so Inspector/the demo script work with zero setup. A real deployment must set it explicitly (see [Deploying](#deploying-amazon-ecs-express-mode)); nothing stops someone from deploying without it. See [SECURITY.md](SECURITY.md).
- **Single-instance only.** Session state is in-memory; running more than one instance would break session continuity without adding a shared session store.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and the pre-PR checklist, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Product feedback

_To be filled in after building/demoing — per-tool notes on what worked, what didn't, and onboarding friction with the MCP SDK, Express, and Bedrock._

## License

MIT — see [LICENSE](LICENSE).
