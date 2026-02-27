# API Reference

Base URL: same origin as the web app (`/api/*`).

## Common Types

## WorkflowGraph

```json
{
  "nodes": [{ "id": "node_1", "type": "start", "x": 100, "y": 100, "data": {} }],
  "connections": [{ "source": "node_1", "target": "node_2", "sourceHandle": "output", "targetHandle": "input" }]
}
```

## WorkflowRunResult

```json
{
  "runId": "1772129193363",
  "status": "completed",
  "logs": [],
  "state": {},
  "waitingForInput": false,
  "currentNodeId": null,
  "workflow": { "nodes": [], "connections": [] }
}
```

`status` values: `pending | running | paused | completed | failed`.

## Endpoints

## `POST /api/run`

Runs a workflow and returns one JSON result.

Request body:

```json
{ "graph": { "nodes": [], "connections": [] } }
```

Responses:

- `200`: `WorkflowRunResult` (+ `workflow`)
- `400`: invalid graph payload
- `503`: workflow contains `agent` node but `OPENAI_API_KEY` unavailable
- `500`: execution failure

## `POST /api/run-stream`

Runs a workflow and streams progress as SSE.

Request body:

```json
{ "graph": { "nodes": [], "connections": [] } }
```

SSE event payloads (`data: <json>`):

- `{"type":"start","runId":"..."}`
- `{"type":"log","entry": WorkflowLogEntry}`
- `{"type":"done","result": WorkflowRunResult}`
- `{"type":"error","message":"..."}`

Errors:

- `400`: invalid graph payload
- `503`: missing LLM backend for agent nodes

## `POST /api/resume`

Resumes a paused workflow and returns one JSON result.

Request body:

```json
{ "runId": "1772024622098", "input": { "decision": "approve", "note": "optional" } }
```

Responses:

- `200`: updated `WorkflowRunResult`
- `400`: missing `runId`
- `404`: run not found in active in-memory workflows
- `409`: run already being resumed through another resume endpoint
- `500`: resume failure

## `POST /api/resume-stream`

Resumes a paused workflow and streams progress as SSE.

Request body is same as `/api/resume`.

SSE payloads are same shape as `/api/run-stream`.

Responses:

- `400`: missing `runId`
- `404`: run not found
- `409`: concurrent resume lock conflict

## `GET /api/run/:runId`

Returns current state for a run.

Behavior:

1. Validates `runId` is numeric-only.
2. Checks in-memory active runs first (running or paused).
3. Falls back to persisted `data/runs/run_<runId>.json`.

Responses:

- `200`: `WorkflowRunResult`
- `400`: invalid `runId`
- `404`: run not found in memory or disk
- `500`: read/parse failure

## `GET /api/default-workflow`

Returns `.config/default-workflow.json` if present and valid.

Responses:

- `200`: `WorkflowGraph`
- `404`: file missing
- `400`: file exists but invalid graph shape
- `500`: read/parse failure

## `GET /api/config`

Returns provider/model config from `.config/config.json`.

Responses:

- `200`: app config JSON
- `404`: config missing
- `500`: read/parse failure

## Persistence and Lifecycle Notes

- All run and resume endpoints persist run records via `saveRunRecord`.
- Non-paused runs are removed from in-memory active map after completion/failure.
- Paused runs remain active and resumable until completed/failed.
