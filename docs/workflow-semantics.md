# Workflow Semantics

This document describes what each node and connection means at runtime.

## Node Types

## `start`

- Entry point for execution.
- Output value is `node.data.initialInput` or empty string.
- Must exist exactly once for a runnable graph.

## `agent`

- Invokes configured LLM backend.
- Reads:
  - `systemPrompt`
  - `userPrompt`
  - `model`
  - `reasoningEffort`
  - `tools` (`web_search`, `subagents`)
- `{{PREVIOUS_OUTPUT}}` is replaced with prior node output.
- If `userPrompt` is empty, engine falls back to previous output text.

## `if`

- Evaluates conditions against previous output (stringified/lowercased).
- Supported operators: `equal`, `contains`.
- First matching condition wins.
- Connection handles:
  - `condition-<index>` for condition branches
  - `false` for fallback branch
- Legacy compatibility: condition index `0` also accepts old handle `true`.

## `approval`

- Pauses execution with `status = paused`, `waitingForInput = true`, `currentNodeId = node.id`.
- Resume input is normalized to:

```json
{ "decision": "approve" | "reject", "note": "" }
```

- Resume follows outgoing branch where `sourceHandle === decision`.

## Connection Types

## Execution edges

Regular workflow edges that advance execution.

Examples:

- `start(output) -> agent(input)`
- `if(condition-0) -> agent(input)`
- `approval(approve) -> agent(input)`

## Subagent edges

Tool-delegation edges only, not execution flow edges.

- Marked by `sourceHandle: "subagent"`.
- Used to build nested agent-tool trees for agent nodes.

## Subagent Constraints

A subagent graph is valid only when:

- Source and target are both `agent` nodes.
- Source has `tools.subagents = true`.
- Target handle is input (`targetHandle` omitted or `input`).
- No self-reference.
- No cycles.
- A target has at most one subagent parent.
- Subagent targets do not appear in regular execution edges.

Invalid subagent structures are rejected by both UI preflight and runtime validation.

## Execution and Branching Behavior

- Multiple outgoing execution branches run concurrently (`Promise.all`).
- If execution pauses while other branches remain, downstream nodes are queued and resumed later.
- After resume, engine drains deferred queue while status remains `running`.

## Log Event Semantics

Typical log types include:

- `step_start`
- `start_prompt`
- `logic_check`
- `wait_input`
- `input_received`
- `llm_response`
- `llm_error`
- `error`

Subagent runtime events are logged as JSON payloads in `content` with types:

- `subagent_call_start`
- `subagent_call_end`
- `subagent_call_error`

## Backward Compatibility Rules

Engine normalizes legacy data:

- Node type `input` is mapped to `approval`.
- Legacy `if.data.condition` is mapped to `if.data.conditions`.
- Legacy `true` connection handle remains supported for first condition branch.
