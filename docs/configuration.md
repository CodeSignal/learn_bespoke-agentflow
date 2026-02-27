# Configuration

## Environment Variables

## `OPENAI_API_KEY`

- Required to execute workflows containing `agent` nodes.
- When missing, server starts but agent runs are rejected with `503`.

## `PORT`

- Server port.
- Default: `3000`.

## `PROJECT_ROOT`

- Optional override for project root resolution.
- Controls where server reads:
  - `.config/config.json`
  - `.config/default-workflow.json`
  - `data/runs/`

## `NODE_ENV`

- `production`: server serves built web assets from `apps/web/dist`.
- any other value: server attaches Vite middleware for development.

## Config Files

## `.config/config.json` (committed)

Served by `GET /api/config` and used by web app to populate model dropdowns.

Current structure:

```json
{
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "enabled": true,
      "models": [
        { "id": "gpt-5", "name": "GPT-5", "reasoningEfforts": ["minimal", "low", "medium", "high"] }
      ]
    }
  ]
}
```

## `.config/default-workflow.json` (gitignored)

Optional startup graph served by `GET /api/default-workflow`.

Load precedence in web app:

1. localStorage graph (`agentflow-workflow`) if available and valid.
2. `default-workflow.json` if available and valid.
3. fallback: generated single Start node.

## Design System Submodule

`design-system/` must be initialized for the web app to load design-system CSS/JS.

Required in fresh clones/worktrees:

```bash
git submodule update --init --recursive
```

`apps/web/public/design-system` is a symlink to the root submodule directory.
