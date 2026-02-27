# Troubleshooting

## `OPENAI_API_KEY is required to run workflows with Agent nodes`

Cause: Server started without `OPENAI_API_KEY`.

Fix:

1. Export key in shell.
2. Restart `npm run dev`.

## Run button disabled unexpectedly

Check run-readiness rules in [`apps/web/docs/run-readiness.md`](../apps/web/docs/run-readiness.md).

Common causes:

- Missing or duplicate Start nodes.
- Broken connections.
- Invalid subagent graph.
- Missing outgoing branch for reachable `if`/`approval` nodes.

## Resume returns `Run ID not found`

Cause: paused engine not currently in server memory.

Possible reasons:

- Server restarted before paused state was persisted with full restore fields.
- Run ID is stale/invalid.

Fix:

1. Use `GET /api/run/:runId` to inspect status.
2. If not recoverable, re-run workflow.

## Resume returns `409` conflict

Cause: same run is being resumed concurrently (`/resume` and `/resume-stream` lock conflict).

Fix: resume from only one client path at a time.

## `default-workflow.json` not loading

Checklist:

1. File exists at `.config/default-workflow.json`.
2. Shape is `{ "nodes": [], "connections": [] }`.
3. localStorage `agentflow-workflow` is not overriding it.

## UI styles/components missing

Cause: design-system submodule not initialized.

Fix:

```bash
git submodule update --init --recursive
```

Also verify symlink:

- `apps/web/public/design-system -> ../../../design-system`

## Build fails after shared package changes

Cause: apps depend on built outputs of shared packages.

Fix:

```bash
npm run build:packages
npm run typecheck
npm run build
```

## `GET /api/run/:runId` returns `400 Invalid runId`

Cause: route only accepts numeric `runId` to prevent path traversal.

Fix: pass raw numeric run ID (timestamp string), no prefixes or suffixes.
