# Agentic Workflow Builder

Agentic Workflow Builder is a web app for visually composing, executing, and auditing LLM workflows. Drag Start, Agent, If/Else, Approval, and End nodes onto the canvas, connect them with Bezier edges, configure prompts inline, and run the flow through a server-side engine that records every step for later review.

## Repository Layout

```
apps/
  server/            # Express + Vite middleware; REST API + static delivery
  web/               # Vite UI (TypeScript + CodeSignal design system)
packages/
  types/             # Shared TypeScript contracts (nodes, graphs, run logs)
  workflow-engine/   # Reusable workflow executor w/ pluggable LLM interface
.config/
  config.json        # Provider + model definitions (committed)
  default-workflow.json  # Optional startup workflow (gitignored)
data/
  runs/              # JSON snapshots of each workflow execution
```

## Key Features

- **Visual Editor** – Canvas, floating palette, zoom controls, and inline node forms for prompts, branching rules, and approval copy.
- **Run Console** – Chat-style panel that renders agent responses progressively as they arrive via SSE, with per-agent labels, spinner states, and approval requests.
- **Workflow Engine** – Handles graph traversal, approvals, and LLM invocation (OpenAI Agents SDK).
- **Subagent Tools** – Agent nodes can expose connected agent nodes as nested subagent tools; these links are tool-delegation edges, not workflow execution edges.
- **Persistent Audit Trail** – Every run writes `data/runs/run_<timestamp>.json` containing the workflow graph plus raw execution logs, independent of what the UI chooses to display.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Export your OpenAI API key in the shell:
   ```bash
   export OPENAI_API_KEY="sk-..."
   ```
3. Start the integrated dev server (Express + embedded Vite middleware on one port):
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` for the UI; APIs live under `/api`.
4. Production build:
   ```bash
   npm run build
   ```

### Script Reference

| Script | Purpose |
| --- | --- |
| `npm run dev` | Express server with Vite middleware (single origin on port 3000). |
| `npm run dev:server` | Same as `dev`; useful if you only need the backend. |
| `npm run dev:web` | Standalone Vite dev server on 5173 (talks to `/api` proxy). |
| `npm run build` | Build shared packages, server, and web bundle. |
| `npm run build:packages` | Rebuild `packages/types` and `packages/workflow-engine`. |
| `npm run build:server` / `npm run build:web` | Targeted builds. |
| `npm run lint` | ESLint via the repo-level config. |
| `npm run typecheck` | TypeScript in both apps. |

## Run Readiness

Workflow run preflight rules and blocking conditions are documented in `apps/web/docs/run-readiness.md`.

## Architecture Notes

- **`@agentic/workflow-engine`**: Pure TypeScript package that normalizes graphs, manages state, pauses for approvals, and calls an injected `WorkflowLLM`. It now exposes `getGraph()` so callers can persist what actually ran.
- **Subagent hierarchy**: Subagent connectors form an acyclic parent/child graph among Agent nodes (`A -> B -> C` allowed, `A -> B -> A` blocked). Subagent targets are tool-only and excluded from execution-flow traversal.
- **Server (`apps/server`)**: Five Express routes. `/api/run-stream` is the primary execution path — streams each `WorkflowLogEntry` as an SSE event so the UI renders progressively. `/api/run` is the same execution as a single JSON response. `/api/resume` continues paused approval workflows. `/api/config` serves `.config/config.json` (provider/model definitions). `/api/default-workflow` serves `.config/default-workflow.json` if present.
- **Web (`apps/web`)**: Vite SPA using the CodeSignal design system. Core UI logic lives in `src/app/workflow-editor.ts`; shared helpers (help modal, API client, etc.) live under `src/`.
- **Shared contracts**: `packages/types` keeps node shapes, graph schemas, log formats, and run-record definitions in sync across the stack.

## Design System Usage (web)

- The CodeSignal design system lives as a git submodule at `design-system/` and is served statically at `/design-system/*` via the `apps/web/public/design-system` symlink.
- Foundations and components are linked in `apps/web/index.html` (colors, spacing, typography, buttons, icons, inputs, dropdowns).
- Dropdowns in the editor use the design-system JS component, dynamically imported from `/design-system/components/dropdown/dropdown.js`.
- All bespoke CSS has been removed; remaining styling in `apps/web/src/workflow-editor.css` uses design-system tokens and classes.

## Run Records

Every successful or paused execution produces:

```json
{
  "runId": "1763679127679",
  "workflow": { "nodes": [...], "connections": [...] },
  "logs": [
    { "timestamp": "...", "nodeId": "node_agent", "type": "llm_response", "content": "..." }
  ],
  "status": "completed"
}
```

Files live in `data/runs/` and can be used for grading, replay, or export pipelines. These are intentionally more detailed than the UI console (which may apply formatting or filtering).

## License

This repository ships under the **Elastic License 2.0** (see `LICENSE`). You must comply with its terms—MIT references elsewhere were outdated and have been corrected.
