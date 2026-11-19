# Configuration

## Environment Variables

## Provider API keys

- Each provider in `.config/config.json` names the environment variable that holds its key (`apiKeyEnv`). The shipped configuration uses `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.
- Keys are read from the environment only; they are never stored in the file or sent to the browser.
- A provider without a key stays listed but unavailable: its models are hidden in the editor, and running a workflow that uses one is rejected with `503`.
- `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` are honoured by the SDKs when a provider sets no `baseUrl`.

## `WORKFLOW_MAX_STEPS`

- Maximum node executions per run or resume call. Loops are allowed, so this is what stops a loop that never exits.
- Default: `100`.

## `PAUSED_RUN_TTL_HOURS`

- Paused runs older than this are left on disk but not restored into memory at startup.
- Default: `24`.

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

## Runtime

- Node.js `>= 20.19`.

## Config Files

## `.config/config.json` (committed)

Defines which providers and models the app offers. The server validates it, uses it to route each Agent node to a provider, and serves a browser-safe view through `GET /api/config`. The file is re-read when it changes, so no restart is needed.

```json
{
  "defaultModel": "gpt-6-luna",
  "modelAliases": { "gpt-5": "gpt-6.2-sol" },
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "type": "openai",
      "enabled": true,
      "apiKeyEnv": "OPENAI_API_KEY",
      "models": [
        {
          "id": "gpt-6-luna",
          "name": "GPT-6 Luna",
          "reasoningEfforts": ["none", "low", "medium", "high", "xhigh", "max"],
          "defaultReasoningEffort": "low"
        }
      ]
    },
    {
      "id": "anthropic",
      "name": "Anthropic",
      "type": "anthropic",
      "enabled": true,
      "apiKeyEnv": "ANTHROPIC_API_KEY",
      "models": [
        {
          "id": "claude-opus-5-5",
          "name": "Claude Opus 5.5",
          "reasoningEfforts": ["low", "medium", "high", "xhigh", "max"],
          "defaultReasoningEffort": "medium",
          "refusalFallback": true
        }
      ]
    }
  ]
}
```

Top-level fields:

| Field | Meaning |
| --- | --- |
| `defaultModel` | Model for new Agent nodes and for nodes that name none. Defaults to the first model of a provider that has a key. |
| `modelAliases` | Maps model ids found in older saved workflows to current ids. Applied by the editor on load and by the server at run time. |
| `providers` | Provider list, in the order models appear in the editor. |

Provider fields:

| Field | Meaning |
| --- | --- |
| `id` | Unique id. |
| `name` | Display name. Defaults to `id`. |
| `type` | `openai` (OpenAI Agents SDK) or `anthropic` (Anthropic SDK). May be omitted when `id` is one of those. |
| `enabled` | `false` hides the provider. Defaults to `true`. |
| `apiKeyEnv` | Environment variable holding the key. Defaults to `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. |
| `baseUrl` | Optional API base URL, for a proxy or an OpenAI-compatible service. |
| `api` | `openai` type only: `responses` (default) or `chat_completions` for OpenAI-compatible services. Web Search needs `responses`. |
| `models` | Models offered by this provider. A model id may appear in only one enabled provider. |

Model fields:

| Field | Meaning |
| --- | --- |
| `id` | Model id sent to the provider. |
| `name` | Label in the editor. Defaults to `id`. |
| `reasoningEfforts` | Effort values offered in the editor. |
| `defaultReasoningEffort` | Used when a node has no effort, or one this model does not list. |
| `maxOutputTokens` | `anthropic` type only: output cap per model call. Defaults to 16000. |
| `refusalFallback` | `anthropic` type only: lets the API re-run a declined request on a fallback model (`fallbacks: "default"`). Not supported on Claude Haiku 5.5. |

Several providers of the same type can be configured side by side, for example OpenAI plus an OpenAI-compatible service with its own `baseUrl`, `apiKeyEnv` and `"api": "chat_completions"`.

An Agent node and its subagents may use models from different providers.

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
