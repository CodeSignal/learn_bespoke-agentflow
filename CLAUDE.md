# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

AgentFlow is a visual workflow editor and runtime for LLM pipelines.

Users compose workflows with `Start`, `Agent`, `Condition`, and `Approval` nodes, then execute server-side with persisted run records.

## Monorepo Layout

| Package | Purpose |
| --- | --- |
| `packages/types` | Shared TypeScript contracts (`WorkflowGraph`, `WorkflowRunResult`, etc.) |
| `packages/workflow-engine` | Runtime executor (`WorkflowEngine`, `WorkflowLLM`) |
| `apps/server` | Express API + Vite middleware/static hosting |
| `apps/web` | Vite SPA editor (`WorkflowEditor`) |
| `design-system/` | Git submodule for UI foundations/components |

## API Surface

- `POST /api/run-stream`
- `POST /api/run`
- `POST /api/resume-stream`
- `POST /api/resume`
- `GET /api/run/:runId`
- `GET /api/config`
- `GET /api/default-workflow`

## Common Commands

```bash
npm install
npm run dev
npm run build
npm run build:packages
npm run lint
npm run typecheck
npm test

npm --workspace apps/web run test
```

## Architecture Notes

## Execution path

Primary path is streaming:

`apps/web` -> `POST /api/run-stream` -> `WorkflowEngine.run()` -> SSE log events -> persisted run record -> final `done` event.

Resume follows equivalent streaming path through `POST /api/resume-stream`.

## Persistence

Each run/resume operation persists `data/runs/run_<runId>.json` with:

- workflow graph
- logs
- status
- state snapshot
- `currentNodeId`
- `waitingForInput`

## Paused-run restoration

On server startup, paused runs are rehydrated into in-memory active workflow map when restore fields are present.

## Subagent hierarchy

Subagent links are tool-delegation edges (`sourceHandle: "subagent"`), not execution edges. Hierarchy must be acyclic and subagent targets are tool-only nodes.

## Design System

`design-system/` is a git submodule and source of truth for UI primitives.

- CSS tokens/components are linked in `apps/web/index.html`.
- Interactive DS components are dynamically imported in `workflow-editor.ts`.
- `apps/web/public/design-system` is a symlink to root submodule.

Initialize submodule in fresh worktrees:

```bash
git submodule update --init --recursive
```

## Configuration

- `OPENAI_API_KEY`: required for agent-node execution.
- `PORT`: server port (default `3000`).
- `PROJECT_ROOT`: optional root override.
- `.config/config.json`: provider/model config served by API.
- `.config/default-workflow.json`: optional startup workflow (gitignored).

## References

- `docs/README.md`
- `docs/architecture.md`
- `docs/api.md`
- `docs/workflow-semantics.md`
- `docs/run-persistence.md`
- `docs/configuration.md`
- `docs/troubleshooting.md`
- `apps/web/docs/run-readiness.md`
