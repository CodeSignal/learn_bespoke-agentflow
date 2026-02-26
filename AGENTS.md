# Repository Guidelines

## Project Structure & Module Organization
This repository is an npm workspace monorepo:
- `apps/server`: Express API + Vite middleware integration (`src/index.ts`). Routes: `POST /api/run-stream` (SSE, primary), `POST /api/run` (batch JSON), `POST /api/resume` (approval resumption), `GET /api/config` (provider/model config), `GET /api/default-workflow` (optional startup workflow).
- `apps/web`: Vite frontend for the workflow editor (`src/app/workflow-editor.ts`).
- `packages/types`: Shared TypeScript contracts used by server, web, and engine.
- `packages/workflow-engine`: Reusable workflow execution runtime.
- `design-system/`: Git submodule with UI tokens/components consumed by the web app.
- `data/runs/`: Runtime run snapshots (gitignored artifacts).
- `.config/config.json`: Provider and model definitions served via `/api/config` (committed). `.config/default-workflow.json`: Optional startup workflow loaded by the editor on init (gitignored).

## Build, Test, and Development Commands
- `npm install`: Install all workspace dependencies.
- `npm run dev`: Start integrated server + UI on `http://localhost:3000`.
- `npm run dev:web`: Run frontend-only Vite dev server.
- `npm run build`: Build shared packages, server, and web app.
- `npm run lint`: Run ESLint for all TypeScript files.
- `npm run typecheck`: Type-check server and web workspaces.
- `npm test`: Run current repo test gate (`workflow-engine` + server typecheck scripts).

## Coding Style & Naming Conventions
- Language: TypeScript across apps/packages, with `strict` mode enabled.
- Use `import type` where applicable (`@typescript-eslint/consistent-type-imports` is enforced).
- Keep unused parameters/locals prefixed with `_` to satisfy lint rules.
- Match existing file naming patterns: kebab-case files (`openai-agents-llm.ts`), PascalCase classes, UPPER_SNAKE_CASE constants.
- Follow existing indentation/style in each file; do not reformat unrelated code.

## Testing Guidelines
- Current CI checks in `.github/workflows/pr.yml`: `lint`, `build:packages`, `typecheck`, and `build`.
- Web workspace uses Vitest (`npm --workspace apps/web run test`).
- When adding tests, prefer `*.test.ts` near the feature being tested.
- No coverage threshold is currently enforced; focus on targeted tests for changed behavior.

## Commit & Pull Request Guidelines
- Prefer short, imperative commit subjects. Existing history favors Conventional Commit prefixes like `feat(web): ...` and `fix: ...`.
- Keep commits scoped to one logical change.
- PRs should include: purpose, risk/impact, linked issue (if any), and validation steps run locally.
- For UI changes in `apps/web`, include screenshots or short recordings.

## Security & Configuration Tips
- Set `OPENAI_API_KEY` in your shell before running agent workflows.
- Never commit secrets, `.env` files, or generated run data from `data/runs/`.

## Design System Policy
- Treat `design-system/` (git submodule) as the source of truth for UI primitives.
- Prefer existing tokens/components from the submodule before building custom UI in `apps/web`.
- If a needed component does not exist in `design-system/`, pause and consult the user before adding a new component or introducing a non-design-system alternative.
- In a brand new git worktree, initialize submodules before development (`git submodule update --init --recursive`), or the design-system assets will be missing.
