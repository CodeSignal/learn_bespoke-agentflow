# AgentFlow

Visual editor + runtime for building, executing, and auditing agentic LLM workflows.

## What It Does

- Build workflows on a canvas with `Start`, `Agent`, `Condition`, and `Approval` nodes.
- Run workflows through a server-side engine (streaming by default).
- Pause on approval nodes and resume with user decisions.
- Persist full run records for replay/audit in `data/runs/`.
- Support nested agent delegation through subagent tool links.

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
export OPENAI_API_KEY="sk-..."
```

3. Start integrated dev server:

```bash
npm run dev
```

4. Open `http://localhost:3000`.

## Core Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Server + web via Vite middleware on port `3000`. |
| `npm run dev:web` | Web-only dev server on `5173` (proxying `/api`). |
| `npm run build` | Build server and web app. |
| `npm run build:packages` | Build `packages/types` and `packages/workflow-engine`. |
| `npm run typecheck` | Typecheck server and web workspaces. |
| `npm run lint` | ESLint across repo TypeScript files. |
| `npm test` | Current test gate (`workflow-engine` + server typecheck script). |

## Repository Structure

- `apps/server`: Express API + dev/prod web hosting behavior.
- `apps/web`: Vite SPA workflow editor and run console.
- `packages/types`: shared TypeScript contracts.
- `packages/workflow-engine`: reusable runtime executor.
- `design-system/`: UI submodule used by web app.
- `.config/config.json`: provider/model config served by API.
- `.config/default-workflow.json`: optional startup workflow (gitignored).

## Documentation

- [Documentation Map](./docs/README.md)
- [Architecture](./docs/architecture.md)
- [API Reference](./docs/api.md)
- [Workflow Semantics](./docs/workflow-semantics.md)
- [Run Persistence and Recovery](./docs/run-persistence.md)
- [Configuration](./docs/configuration.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [Web Run Readiness Rules](./apps/web/docs/run-readiness.md)

## Design System

The UI depends on the `design-system/` git submodule, exposed to the web app through:

- `apps/web/public/design-system -> ../../../design-system`

In fresh clones/worktrees, initialize submodules before running:

```bash
git submodule update --init --recursive
```
