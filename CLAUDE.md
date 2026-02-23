# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Visual workflow builder for agentic LLM pipelines. Users drag-and-drop nodes (Start, Agent, If/Else, Approval, End) onto a canvas, connect them, configure LLM prompts and branching logic, then execute workflows server-side against OpenAI. Run results are persisted as JSON audit trails.

## Monorepo Layout

npm workspace monorepo:

| Package | Purpose |
|---------|---------|
| `packages/types` | Shared TypeScript contracts (`WorkflowNode`, `WorkflowGraph`, `WorkflowRunResult`, etc.) |
| `packages/workflow-engine` | Pure runtime executor (`WorkflowEngine` class, `WorkflowLLM` interface) — no OpenAI dependency |
| `apps/server` | Express API + Vite dev middleware. Routes: `POST /api/run`, `POST /api/run-stream`, `POST /api/resume` |
| `apps/web` | Vite SPA — `WorkflowEditor` class handles canvas, node palette, and run console |
| `design-system/` | Git submodule (CodeSignal DS) — CSS tokens and components consumed by web app |

## Common Commands

```bash
npm install                  # Install all workspace deps
npm run dev                  # Start integrated server+UI on http://localhost:3000
npm run build                # Build packages → server → web (production)
npm run lint                 # ESLint across all TypeScript
npm run typecheck            # tsc --noEmit for server and web
npm test                     # Run workflow-engine + server tests

# Workspace-specific
npm --workspace apps/web run test          # Vitest for web
npm --workspace packages/workflow-engine run test  # Engine tests
npm run build:packages       # Build only shared packages (types + engine)
```

## Architecture

**Request flow (streaming):** Browser (`api.ts` `runWorkflowStream`) → `POST /api/run-stream` → `WorkflowEngine.run()` with `onLog` callback → each `WorkflowLogEntry` is streamed to the client as an SSE event → final result persisted to `data/runs/run_<id>.json` → `done` event sent to close stream. This is the primary run path — the UI renders agent responses progressively as they arrive.

**Request flow (batch):** `POST /api/run` runs the same engine synchronously and returns the full `WorkflowRunResult` as JSON. Still available but not used by the default UI.

**Approval/pause flow:** When engine hits an Approval node, it sets `waitingForInput=true` and the engine instance is stored in an in-memory `Map` (`store/active-workflows.ts`). Client calls `POST /api/resume` with user input to continue.

**Build dependency chain:** `packages/types` → `packages/workflow-engine` → `apps/server` / `apps/web`. Always run `build:packages` before typechecking or building apps.

## Design System (Git Submodule)

`design-system/` is a CodeSignal design system git submodule. It is the **source of truth** for all UI primitives — always prefer existing DS tokens and components over custom CSS or new UI elements. If a needed component doesn't exist in the DS, consult the user before adding alternatives.

### Token layers

Tokens live in three foundation files linked as static CSS in `apps/web/index.html`:

- **Colors** (`colors/colors.css`): Two-tier system — base scales (`--Colors-Base-Primary-700`) and semantic names (`--Colors-Backgrounds-Main-Default`, `--Colors-Text-Body-Strong`, `--Colors-Stroke-Default`, etc.). Dark mode is automatic via `@media (prefers-color-scheme: dark)`.
- **Spacing** (`spacing/spacing.css`): Spacing scale `--UI-Spacing-spacing-{none|min|xxs|xs|s|mxs|ms|m|ml|mxl|l|xl|xxl|xxxl|4xl|max}`, border radii `--UI-Radius-radius-{size}`, and input heights `--UI-Input-{min|xs|sm|md|lg}`.
- **Typography** (`typography/typography.css`): Font families (`--body-family`, `--heading-family`, `--code-family`), size variables (`--Fonts-Body-Default-md`), and utility classes (`.body-small`, `.heading-xxxsmall`, `.label-small`, `.code`).

### Component CSS + JS

Component CSS is loaded statically in `index.html` (button, boxes, dropdown, icons, input, modal, split-panel, tags). Interactive components with JS (Dropdown, Modal, SplitPanel) are **lazy-loaded at runtime** via dynamic `import()` from the submodule path:

```typescript
// Pattern used in workflow-editor.ts
const mod = await import(`${origin}/design-system/components/dropdown/dropdown.js`);
const DropdownCtor = mod.default;
const dropdown = new DropdownCtor(container, { items, selectedValue, onSelect });
```

Components currently used in the web app:
- **SplitPanel** — main layout (canvas left, run console right). Constructor: `new SplitPanel(el, { initialSplit, minLeft, minRight })`.
- **Dropdown** — model and reasoning-effort selectors. Constructor: `new Dropdown(el, { items, selectedValue, placeholder, width, onSelect })`.
- **Modal** — help dialog, confirmation prompts. Constructor: `new Modal({ size, title, content, footerButtons })`. Also `Modal.createHelpModal()` factory.
- **Button** — pure CSS (`.button .button-primary`, `.button-secondary`, `.button-danger`, sizes via `.button-small`/`.button-xsmall`).
- **Input** — pure CSS (`.input` for text/number, `.input-checkbox` / `.input-radio` with wrapper structure).

### Styling rules for the web app

`apps/web/src/workflow-editor.css` consumes DS tokens throughout. When writing new CSS:
- Use semantic color tokens (`--Colors-Backgrounds-Main-Top`, `--Colors-Stroke-Default`) rather than base scales or raw hex values.
- Use spacing tokens (`--UI-Spacing-spacing-s`) instead of hardcoded pixel values.
- Use radius tokens (`--UI-Radius-radius-xs`) for border-radius.
- Use typography variables/classes (`--body-family`, `.body-small`) for font styling.

## Coding Conventions

- TypeScript strict mode everywhere. Use `import type` (enforced by `@typescript-eslint/consistent-type-imports`).
- File naming: kebab-case. Classes: PascalCase. Constants: UPPER_SNAKE_CASE.
- Prefix unused parameters with `_`.
- Tests: `*.test.ts` co-located near the feature. Vitest for web, CI runs lint → build:packages → typecheck → build.
- Commits: short imperative subjects, Conventional Commit prefixes (`feat(web):`, `fix:`, `chore:`).

## Environment

- Requires Node.js 20+.
- `OPENAI_API_KEY` must be exported in your shell for Agent node execution.
- `data/runs/` is gitignored — created automatically at runtime.
- Clone with `--recurse-submodules` to pull the design-system submodule.
