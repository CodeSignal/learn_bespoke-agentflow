# Run Persistence and Recovery

Runs are persisted as JSON records in `data/runs/`.

## File Naming

- Pattern: `run_<runId>.json`
- `runId` is a random UUID. Records written by older versions use a numeric timestamp and remain readable.

## Persisted Record Shape

```json
{
  "runId": "3f0c2a6e-8a44-4f0e-9c38-0a1f2f6f6f51",
  "workflow": { "nodes": [], "connections": [] },
  "logs": [],
  "status": "completed",
  "state": {},
  "currentNodeId": null,
  "waitingForInput": false
}
```

Fields:

- `workflow`: graph that actually ran.
- `logs`: ordered runtime log entries.
- `status`: current/terminal status.
- `state`: engine internal state snapshot.
- `currentNodeId`: active node when paused/running.
- `waitingForInput`: approval wait flag.

## When Records Are Written

Records are saved after:

- `POST /api/run`
- `POST /api/run-stream`
- `POST /api/resume`
- `POST /api/resume-stream`
- `POST /api/cancel` (for a paused run; a running run is saved by the request that drives it)

Records are written to a temporary file and renamed, so a crash cannot leave a truncated record. Persistence is best-effort; save failures are logged server-side.

## Active In-memory Runs

Server keeps a map of active `WorkflowEngine` instances.

- Paused runs remain in memory.
- Completed, failed and cancelled runs are removed from memory.
- Persisted records remain on disk.

## Fetching a Run

`GET /api/run/:runId` lookup order:

1. In-memory active run (if still running/paused).
2. Persisted file from `data/runs/`.

If both missing, API returns `404`.

## Startup Restore for Paused Runs

On server startup, persisted records are scanned and restored to active memory only if:

- `status === "paused"`
- `waitingForInput === true`
- `state` exists
- `currentNodeId != null`
- the file was modified less than `PAUSED_RUN_TTL_HOURS` ago (default 24)

This allows paused approval runs to survive restarts.

## Frontend Recovery Flow

Web app stores active run ID in localStorage (`agentflow-run-id`) and on load:

1. Calls `GET /api/run/:runId`.
2. If `status === running`, renders partial logs and polls every 2 seconds.
3. If `status === paused && waitingForInput`, re-shows approval UI.
4. If run missing (`404`), clears stored run ID.

To abandon a paused run instead of answering it, cancel it (`POST /api/cancel`, the Cancel button in the UI).

## Data Hygiene

- `data/runs/` is gitignored and can grow quickly.
- Remove stale run files periodically in local environments.
- Do not commit run data to source control.
