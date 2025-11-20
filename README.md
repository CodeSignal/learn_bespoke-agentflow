# Agentic Workflow Builder

A Bespoke-styled web application for visually composing, running, and auditing agentic LLM workflows. Users drag nodes (Start, Agent, If/Else, Approval, End) onto a canvas, wire them together, configure prompts inline, and run the flow against a server-side workflow engine that persists detailed execution logs.

## Monorepo Layout

```
apps/
  server/                # Express server + API surface
  web/                   # Vite-powered UI (TypeScript + Bespoke CSS)
packages/
  types/                 # Shared TypeScript contracts for nodes, graphs, run logs
  workflow-engine/       # Reusable workflow executor used by the server
data/
  runs/                  # JSON transcripts of every workflow execution
```

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. (Optional) add `.env` with `OPENAI_API_KEY=sk-...` to enable live OpenAI calls. Without a key the engine falls back to deterministic mock responses.
3. Start the integrated dev server (API + Vite middleware served from the same origin):
   ```bash
   npm run dev
   ```
   - Visit `http://localhost:3000` for the UI (the API lives under `/api` on the same port).
4. Build for production:
   ```bash
   npm run build
   ```
5. Launch individual pieces if needed:
   ```bash
   npm run dev:server   # API + embedded Vite dev server
   npm run dev:web      # Standalone Vite dev server on 5173 (advanced use only)
   ```

## Available Scripts

- `npm run dev` – concurrently run the Express API (`apps/server`) and Vite UI (`apps/web`).
- `npm run build` – compile shared packages, the server, and the web bundle.
- `npm run build:server` / `npm run build:web` – targeted builds.
- `npm run typecheck` – run TypeScript in both apps.
- `npm run test:engine` – workflow engine test harness (placeholders for future suites).
- `npm run lint` – ESLint across the repo.

## Architecture Highlights

- **`@agentic/workflow-engine`** encapsulates graph traversal, branching, approval pauses, and the LLM invocation abstraction. It accepts any `WorkflowLLM` implementation (OpenAI-powered or mock) and produces normalized logs/results for persistence.
- **`apps/server`** exposes `/api/run` and `/api/resume`, hydrates `WorkflowEngine` instances, streams logs to disk under `data/runs/`, and serves the built UI bundle for production deployments.
- **`apps/web`** is a Vite + TypeScript single-page app that reuses Bespoke CSS assets. The editor logic remains modularized in `src/app/workflow-editor.ts`, while API clients, Help modal, and content live in their own modules.
- **Shared types** live in `packages/types`, keeping contracts for nodes, connections, logs, and run payloads in sync between client and server.

## Data & Logging

- Each workflow execution writes `data/runs/run_<timestamp>.json`, containing:
  - workflow graph snapshot
  - node-by-node logs (start, llm_response, wait_input, etc.)
  - engine state (last output, approval decisions, etc.)
- These JSON artifacts are ideal for grading, debugging, or replaying runs later.

## License

MIT

