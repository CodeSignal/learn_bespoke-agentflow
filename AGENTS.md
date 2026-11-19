# Repository Guidelines

## Project Structure & Module Organization

This repository is an npm workspace monorepo:

- `apps/server`: Express API + Vite middleware integration (`src/index.ts`).
- `apps/web`: Vite frontend workflow editor (`src/app/workflow-editor.ts`).
- `packages/types`: Shared TypeScript contracts.
- `packages/workflow-engine`: Reusable workflow runtime.
- `design-system/`: Git submodule with UI tokens/components.
- `data/runs/`: Runtime run snapshots (gitignored).
- `.config/config.json`: Provider/model definitions (committed); schema in `docs/configuration.md`.
- `apps/server/src/llm`: provider router and adapters (OpenAI Agents SDK, Anthropic SDK).
- `.config/default-workflow.json`: Optional startup workflow (gitignored).

Server routes:

- `POST /api/run-stream` (SSE run, primary)
- `POST /api/run` (batch JSON run)
- `POST /api/resume-stream` (SSE resume, primary)
- `POST /api/resume` (batch JSON resume)
- `POST /api/cancel` (stop a running or paused run)
- `GET /api/run/:runId` (active/persisted run fetch)
- `GET /api/config` (provider/model config)
- `GET /api/default-workflow` (optional startup workflow)

## Build, Test, and Development Commands

- `npm install`: Install all workspace dependencies.
- `npm run dev`: Start integrated server + UI on `http://localhost:3000`.
- `npm run dev:web`: Run frontend-only Vite dev server.
- `npm run build`: Build server and web app.
- `npm run build:packages`: Build shared packages.
- `npm run lint`: Run ESLint.
- `npm run typecheck`: Typecheck every workspace.
- `npm test`: Build shared packages, then run Vitest in the engine, server and web workspaces.

## Coding Style & Naming Conventions

- Language: TypeScript with `strict` mode.
- Use `import type` where applicable (`@typescript-eslint/consistent-type-imports`).
- Prefix unused parameters/locals with `_`.
- Naming patterns: kebab-case files, PascalCase classes, UPPER_SNAKE_CASE constants.
- Avoid reformatting unrelated code.

## Testing Guidelines

- CI checks in `.github/workflows/pr.yml`: `lint`, `build:packages`, `typecheck`, `test`, `build`.
- Every workspace with logic uses Vitest (`npm --workspace <path> run test`). The engine and server suites use a stub LLM; the server's SDK suite runs the real Agents SDK against a scripted model, so no API key is needed.
- Server and package sources are ES modules compiled with `NodeNext`: relative imports need a `.js` extension.
- Prefer targeted `*.test.ts` files near changed behavior.

## Commit & Pull Request Guidelines

- Prefer short, imperative commit subjects.
- Conventional prefixes are common (`feat(web):`, `fix:`, `chore:`).
- Keep commits scoped to one logical change.
- PRs should include purpose, risk/impact, and validation steps.
- For UI changes in `apps/web`, include screenshots or recordings.

## Security & Configuration Tips

- Set the API key of each provider you use (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) before running agent workflows.
- Providers and models live in `.config/config.json`; keys stay in the environment, named by each provider's `apiKeyEnv`.
- Do not hard-code model ids in source: add them to `.config/config.json` (and `modelAliases` for retired ids).
- Never commit secrets, `.env` files, or generated data from `data/runs/`.

## Design System Policy

- Treat `design-system/` as source of truth for UI primitives.
- Prefer submodule tokens/components over custom alternatives.
- If a needed component is missing in `design-system/`, consult user before adding alternatives.
- In fresh worktrees, run `git submodule update --init --recursive`.

## Subagent Graph Rules

- Links between agents and subagents are tool-delegation edges, not execution edges.
- Hierarchies of subagents must remain acyclic.
- Targets of subagent links are tool-only and cannot participate in regular execution edges.

## Additional Documentation

- `docs/README.md`
- `docs/api.md`
- `docs/workflow-semantics.md`
- `apps/web/docs/run-readiness.md`
