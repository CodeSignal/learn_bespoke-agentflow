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
  "runId": "3f0c2a6e-8a44-4f0e-9c38-0a1f2f6f6f51",
  "status": "completed",
  "logs": [],
  "state": {},
  "waitingForInput": false,
  "currentNodeId": null,
  "workflow": { "nodes": [], "connections": [] }
}
```

`status` values: `pending | running | paused | completed | failed | cancelled`.

`runId` is an opaque string (a UUID for new runs). Treat it as an identifier only.

The API sends no CORS headers: it is meant to be called from the web app on the same origin.

## Endpoints

## `POST /api/run`

Runs a workflow and returns one JSON result.

Request body:

```json
{ "graph": { "nodes": [], "connections": [] } }
```

Responses:

- `200`: `WorkflowRunResult` (+ `workflow`)
- `400`: invalid graph payload; `details` lists each problem (shape, duplicate ids, unknown connection endpoints, size limits)
- `400`: an Agent node names a model that no enabled provider lists
- `503`: an Agent node uses a provider whose API key is not set
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

Events are separated by a blank line. While a model call is in flight the server also sends comment lines (`: ping`) about every 15 seconds so idle proxies keep the connection open; clients must ignore lines that start with `:`.

Closing the stream does not stop the run. The run keeps executing and can be read through `GET /api/run/:runId`; use `POST /api/cancel` to stop it.

Errors:

- `400`: invalid graph payload
- `503`: an Agent node uses a provider whose API key is not set

## `POST /api/resume`

Resumes a paused workflow and returns one JSON result.

Request body:

```json
{ "runId": "3f0c2a6e-8a44-4f0e-9c38-0a1f2f6f6f51", "input": { "decision": "approve", "note": "optional" } }
```

Responses:

- `200`: updated `WorkflowRunResult`
- `400`: missing or malformed `runId`, or `input` that is neither a string nor an object
- `404`: run not found in active in-memory workflows
- `409`: run is already executing (a run or resume request for it has not finished)
- `500`: resume failure

## `POST /api/resume-stream`

Resumes a paused workflow and streams progress as SSE.

Request body is same as `/api/resume`.

SSE payloads are same shape as `/api/run-stream`.

Responses:

- `400`: missing or malformed `runId` or `input`
- `404`: run not found
- `409`: run is already executing

## `POST /api/cancel`

Stops a running run or abandons a paused one.

Request body:

```json
{ "runId": "3f0c2a6e-8a44-4f0e-9c38-0a1f2f6f6f51" }
```

Behavior:

- In-flight model calls receive an abort signal and their results are discarded.
- A stream that is driving the run ends with a `done` event whose result has `status: "cancelled"`.
- The run record is persisted with `status: "cancelled"` and the run is removed from memory.

Responses:

- `200`: `WorkflowRunResult` with `status: "cancelled"`
- `400`: missing or malformed `runId`
- `404`: run is not active (unknown, or already completed, failed or cancelled)

## `GET /api/run/:runId`

Returns current state for a run.

Behavior:

1. Validates `runId` (letters, digits, `-` and `_`, at most 64 characters).
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
- `400`: file exists but is not a valid graph (`details` lists the problems)
- `500`: read/parse failure

## `GET /api/config`

Returns the browser-safe view of `.config/config.json`: `defaultModel`, `modelAliases`, and for each provider its `id`, `name`, `enabled`, `available` (whether its API key is set) and `models` (`id`, `name`, `reasoningEfforts`, `defaultReasoningEffort`). Key variable names and base URLs are not included.

Responses:

- `200`: app config JSON
- `404`: config missing or invalid (the reason is logged by the server)
- `500`: read/parse failure

## Persistence and Lifecycle Notes

- All run and resume endpoints persist run records via `saveRunRecord`.
- Non-paused runs are removed from in-memory active map after completion, failure or cancellation.
- Paused runs remain active and resumable until completed, failed or cancelled.
- A run that executes more than `WORKFLOW_MAX_STEPS` nodes in one run or resume call fails with an `error` log entry.
