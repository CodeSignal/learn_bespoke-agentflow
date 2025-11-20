# Agentic Workflow Builder

Agentic Workflow Builder is a Bespoke-styled web app for visually composing, running, and auditing agentic LLM workflows. It features a draggable canvas for nodes (Start, Agent, If/Else, Human Input, End), a floating palette, resizable run console, and a status-aware chat log that highlights user prompts and agent replies.

## Features

- **Visual Workflow Editor**: Drag predefined nodes onto the canvas, connect them with edges, and configure them inline. Nodes support material-icon labels and a gear/trash action row.
- **Customizable Panels**: Floating node palette (top-left), clear canvas button (bottom-left), zoom controls (top-right), and a resizable right-side run console with status indicator.
- **Agent Configuration**: Per-node settings include agent name, OpenAI GPT-5/GPT-5.1/GPT-5 mini model selection, reasoning effort (contextual options), optional user prompt override, and web-search tool toggle.
- **Run Console**: Shows only user/agent messages, includes an “agent is working…” spinner, and exposes Run Workflow / Clear Canvas controls. Status updates (Idle, Running, Waiting, Completed, Failed) appear in the console header.
- **Execution Logging**: The backend (`server.js`) records node-level logs and persists artifacts under `runs/`. Each run includes structure, configuration, and message logs for auditing.
- **Server Integration**: `server.js` serves static assets, manages workflows, and executes nodes using the OpenAI API (if `OPENAI_API_KEY` is provided). LLM requests fall back to mocked responses when the API key is absent.

## Project Structure

```
client/
  app.js                 # Front-end logic for nodes, canvas, chat, and runs
  help-content-template.html
  index.html             # Root HTML template (references Bespoke CSS + Material Icons)
  workflow-editor.css    # Bespoke-specific styling and layout overrides
server.js                # Node.js HTTP/WebSocket server + workflow engine
runs/                    # Persisted run metadata/logs
AGENTS.md, template-README.md, etc.
```

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. (Optional) Create a `.env` with `OPENAI_API_KEY=sk-...` to enable live LLM calls.
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Navigate to `http://localhost:3000` and begin building workflows.

## Usage Notes

- **Floating Palette**: Drag entries (Start, Agent, If/Else, Human Input, End) from the top-left floating palette onto the canvas.
- **Node Editing**: Click the gear icon to expand node settings (agent name, prompts, model, reasoning effort, tools). Delete nodes via the trash icon.
- **Zoom & Pan**: Use the zoom-out/in controls (top-right) or drag the canvas to pan. A “Clear Canvas” button sits in the bottom-left.
- **Run Console**: Resize the right panel by dragging the vertical handle. Enter an initial prompt, click **Run Workflow**, and watch the chat log stream user/agent turns.
- **Logging**: Each run writes a JSON file under `runs/` containing node definitions, edges, and execution logs for later inspection or grading.

## Tech Stack

- **Front-End**: Vanilla JS + Bespoke CSS + Material Icons.
- **Back-End**: Node.js HTTP server with optional WebSocket messaging and OpenAI SDK integration.
- **Persistence**: JSON run artifacts stored locally under `runs/`.

## License

MIT

