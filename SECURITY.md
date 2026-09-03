# Security Policy

This is a hackathon-stage project — treat it accordingly (see [Known limitations](README.md#known-limitations) in the README before relying on it for real caretaking data).

## Reporting a vulnerability

Please report security issues privately via [GitHub's private vulnerability reporting](https://github.com/Darlington6/caremesh-mcp/security/advisories/new) rather than a public issue. Include what you found, how to reproduce it, and its potential impact. We'll acknowledge reports as promptly as we can.

## Scope notes

- The server has no authentication layer by default — anyone who can reach `/mcp` can read and write data. Do not deploy it publicly with real personal data without adding auth in front of it (e.g. an API gateway, a reverse proxy with auth, or MCP's OAuth support).
- `/mcp` is rate-limited (see `src/server.ts`); `/healthz` is not, since it's expected to be hit by load balancer health checks.
- AWS credentials for Bedrock are never read from request input — only from the environment / IAM role, per the AWS SDK's standard credential chain.
