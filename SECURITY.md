# Security Policy

This is a hackathon-stage project, treat it accordingly (see [Known limitations](README.md#known-limitations) in the README before relying on it for real caretaking data).

## Reporting a vulnerability

Please report security issues privately via [GitHub's private vulnerability reporting](https://github.com/Darlington6/caremesh-mcp/security/advisories/new) rather than a public issue. Include what you found, how to reproduce it, and its potential impact. We'll acknowledge reports as promptly as we can.

## Scope notes

- Auth (`MCP_AUTH_TOKEN`, a bearer token checked with a constant-time comparison, see `src/server.ts`) is **opt-in and unset by default locally**. Anyone who can reach an `/mcp` deployment without it configured can read and write data. Always set `MCP_AUTH_TOKEN` (as a secret, not a plaintext env var; see the README's Deploying section) before exposing this publicly with real personal data.
- `/mcp` is rate-limited (see `src/server.ts`); `/healthz` is not, since it's expected to be hit by load balancer health checks.
- AWS credentials for Bedrock and DynamoDB are never read from request input, only from the environment / IAM role, per the AWS SDK's standard credential chain. In production the app's IAM task role is scoped to the specific actions it uses (`bedrock:InvokeModel`, DynamoDB read/write on the four named tables); it does not have `CreateTable`/`DeleteTable` permissions.
