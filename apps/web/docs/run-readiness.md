# Run Readiness Rules (Web UI)

This document defines exactly when the **Run Workflow** button is enabled in the web editor.

Code source of truth:

- `apps/web/src/app/workflow-editor.ts`
- `getRunDisableReason()`
- `updateRunButton()`

Related docs:

- [`docs/workflow-semantics.md`](../../../docs/workflow-semantics.md)
- [`docs/api.md`](../../../docs/api.md)

## UI State Rules

Run button is disabled when editor state is not `idle`:

- `running`: label is `Running...`
- `paused`: label is `Paused`

Cancel button is only shown while state is `running`.

## Graph Validation Rules (Idle State)

Run button is disabled when any condition below is true:

- No `Start` node exists.
- More than one `Start` node exists.
- Any connection references a missing source or target node.
- Any subagent link is invalid:
  - source/target are not both `agent`
  - source does not have `tools.subagents`
  - target handle is not input
- Any subagent target has more than one parent.
- Any subagent target participates in regular execution edges.
- Any subagent cycle exists.
- `Start` node has no outgoing execution connection.
- Nothing is reachable after `Start`.
- A reachable `Condition` node has neither condition branch nor fallback (`false`) branch.
- A reachable `Approval` node has neither `approve` nor `reject` outgoing branch.

## Explicitly Allowed (Does Not Block Run)

- Circular regular execution connections (non-subagent loops).
- Unreachable/disconnected nodes outside `Start`-reachable path.
- `Condition` node with only one connected branch.
- `Approval` node with only one connected branch.
- Nested subagent chains (`A -> B -> C`) when acyclic and tool-only.

## Runtime Constraints Outside UI Preflight

Even when UI preflight passes, backend can still reject execution:

- Workflows containing `agent` nodes require `OPENAI_API_KEY`.
- Server can return runtime validation/execution errors.

Run and resume are executed through streaming endpoints:

- `POST /api/run-stream`
- `POST /api/resume-stream`
