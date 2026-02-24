# Run Readiness Rules (Web UI)

This document defines when the **Run Workflow** button is enabled or disabled in the web editor.

Source of truth:
- `apps/web/src/app/workflow-editor.ts`
- `getRunDisableReason()`
- `updateRunButton()`

## UI State Rules

The run button is disabled when the editor is not idle:
- `running`: button label is `Running...`
- `paused`: button label is `Paused`

The cancel button is shown only while state is `running`.

## Graph Validation Rules (Idle State)

The run button is disabled if any of these are true:
- No `Start` node exists.
- More than one `Start` node exists.
- Any connection references a missing source or target node.
- The `Start` node has no outgoing connection.
- Nothing is reachable after `Start` (for example only `Start`, or `Start` not connected to any executable node).
- A reachable `If / Else` node has neither a `true` nor a `false` outgoing branch.
- A reachable `Approval` node has neither an `approve` nor a `reject` outgoing branch.

## Explicitly Allowed

These cases are currently allowed and do not block run:
- Circular connections (loops).
- Unreachable/disconnected nodes not on the reachable path from `Start`.
- `If / Else` with only one branch connected (at least one is required).
- `Approval` with only one branch connected (at least one is required).

## Backend Runtime Constraint (Not a UI Preflight Rule)

Even if UI preflight passes, backend can still reject a run:
- Workflows containing `Agent` nodes require an OpenAI-backed LLM configuration (`OPENAI_API_KEY` in environment).
- If unavailable, the backend returns an error and the UI shows it in chat.
