# Contributing to Caremesh MCP

Thanks for taking a look. This started as a hackathon project, but issues, pull requests, and forks are welcome.

## Getting set up

```bash
nvm use          # picks up the version in .nvmrc
docker run -d -p 8000:8000 amazon/dynamodb-local:latest
npm install
cp .env.example .env
npm run build
npm test
```

See the [README](README.md) for how to run the server, exercise it with MCP Inspector, and run the scripted demo.

## Before opening a PR

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
```

CI runs the same checks on every push and PR — matching them locally first saves a round trip. Keep changes formatted with `npm run format` (Prettier) rather than hand-formatting.

## Code layout

- `src/mcp/tools.ts` — MCP tool registrations. Keep the actual logic in separate, pure, testable modules (see `src/alerts.ts`) rather than inline in the handler.
- `src/store.ts` — the data layer. If you're changing its shape, update `src/types.ts` and the tests in `test/store.test.ts` together.
- `test/` — mirrors `src/`. New logic should come with a test in the same style as what's there (`node:test`, no mocking framework).

## Reporting bugs / requesting features

Open a GitHub issue using the provided templates. For anything security-related, see [SECURITY.md](SECURITY.md) instead of opening a public issue.
