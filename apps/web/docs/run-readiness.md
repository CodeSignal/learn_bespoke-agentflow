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
- Any subagent link is invalid (source/target must both be Agent nodes, source must have Subagents tool enabled, and target must use the input handle).
- Any agent is targeted as subagent by more than one parent.
- Any subagent target participates in regular execution edges (subagent targets are tool-only).
- Any subagent cycle exists (`A -> B -> A`, including longer loops).
- The `Start` node has no outgoing connection.
- Nothing is reachable after `Start` (for example only `Start`, or `Start` not connected to any executable node).
- A reachable `Condition` node has neither a condition branch nor a `false` fallback branch.
- A reachable `Approval` node has neither an `approve` nor a `reject` outgoing branch.

## Explicitly Allowed

These cases are currently allowed and do not block run:
- Circular execution connections (non-subagent loops).
- Unreachable/disconnected nodes not on the reachable path from `Start`.
- `Condition` with only one branch connected (at least one is required).
- `Approval` with only one branch connected (at least one is required).
- Nested subagent chains (`A -> B -> C`) as long as they remain acyclic and tool-only.

## Backend Runtime Constraint (Not a UI Preflight Rule)

Even if UI preflight passes, backend can still reject a run:
- Workflows containing `Agent` nodes require an OpenAI-backed LLM configuration (`OPENAI_API_KEY` in environment).
- If unavailable, the backend returns an error and the UI shows it in chat.
