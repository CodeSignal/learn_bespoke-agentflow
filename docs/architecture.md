# Architecture

This project is an npm workspace monorepo for building, running, and reviewing agentic workflows.

## Monorepo Layout

- `apps/server`: Express API server and Vite middleware integration.
- `apps/web`: Vite SPA workflow editor and run console.
- `packages/types`: Shared TypeScript contracts used by server, web, and engine.
- `packages/workflow-engine`: Pure workflow runtime with pluggable LLM adapter.
- `design-system/`: Git submodule for UI tokens and components.
- `data/runs/`: Persisted run records (`run_<runId>.json`).
- `.config/config.json`: Provider/model config served by API.
- `.config/default-workflow.json`: Optional startup workflow (gitignored).

## Request Flows

## Streaming run (primary path)

1. Web app calls `POST /api/run-stream`.
2. Server creates a `WorkflowEngine`, attaches `onLog`, and streams SSE events.
3. Engine emits `WorkflowLogEntry` events as nodes execute.
4. Server persists final result to `data/runs/run_<runId>.json`.
5. Server sends a final `done` event and closes the stream.

## Streaming resume (primary resume path)

1. Web app calls `POST /api/resume-stream` with `runId` and approval input.
2. Server resumes an in-memory paused engine.
3. Server streams log events and final result.
4. Server persists updated run record.

A per-run resume lock prevents concurrent resume calls (`409` if duplicated).

## Batch paths

- `POST /api/run`: same execution model as stream, returned as one JSON response.
- `POST /api/resume`: same resume model as stream, returned as one JSON response.

## Runtime Model

The workflow engine supports:

- Node types: `start`, `agent`, `if`, `approval`.
- Branching with condition handles (`condition-<index>`) and fallback (`false`).
- Approval pause/resume semantics with `waitingForInput` and `currentNodeId`.
- Subagent tool-delegation edges (`sourceHandle: "subagent"`) separate from execution edges.
- Deferred downstream execution queues when a pause occurs mid-branch.

## Subagent Model

Subagent links are validated as a strict DAG of agent-to-agent tool relationships:

- Source must be an `agent` with `tools.subagents = true`.
- Target must be an `agent` connected on input handle.
- Target cannot be part of normal execution edges.
- A target can have only one subagent parent.
- Cycles are rejected.

During agent execution, subagent calls are logged as runtime events:

- `subagent_call_start`
- `subagent_call_end`
- `subagent_call_error`

## Paused Run Restore on Server Start

At startup, server scans `data/runs/` and rehydrates paused runs into memory when all are true:

- `status === "paused"`
- `waitingForInput === true`
- `state` exists
- `currentNodeId` is not null

This enables resume endpoints to keep working after restart.

## Frontend Runtime and Recovery

The web editor:

- Persists canvas graph in localStorage key `agentflow-workflow`.
- Persists active run ID in localStorage key `agentflow-run-id`.
- On load, restores graph from localStorage first, then falls back to `/api/default-workflow`.
- On load, attempts run recovery via `GET /api/run/:runId`.
- Polls every 2s while recovered run status is `running`.

## Build Dependency Order

Build/type dependencies flow from shared packages to apps:

1. `packages/types`
2. `packages/workflow-engine`
3. `apps/server` and `apps/web`

Use `npm run build:packages` before server/app typecheck or build when running targeted commands.
