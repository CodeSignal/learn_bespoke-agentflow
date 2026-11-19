# Run Readiness Rules (Web UI)

This document defines exactly when the **Run Workflow** button is enabled in the web editor.

Code source of truth:

- `apps/web/src/app/graph/validation.ts`: `getRunDisableReason()` (pure; covered rule by rule in `validation.test.ts`)
- `apps/web/src/app/workflow-editor.ts`: `updateRunButton()`
- `apps/web/src/app/run/run-controller.ts`: run, pause, cancel and recovery states

Related docs:

- [`docs/workflow-semantics.md`](../../../docs/workflow-semantics.md)
- [`docs/api.md`](../../../docs/api.md)

## UI State Rules

Run button is disabled when editor state is not `idle`:

- `running`: label is `Running...`
- `paused`: label is `Paused`

The **Clear Canvas** button is disabled in the same two states.

The Cancel button is shown while state is `running` or `paused`. It calls `POST /api/cancel`, which stops the run on the server; closing the page or the stream does not stop a run. A paused run can therefore be abandoned without approving or rejecting. While the cancel request is in flight the button is disabled; if the request fails, the run stays as it was and Cancel can be pressed again.

Undo and redo are unavailable while state is not `idle`.

The reason a button is disabled is shown on hover and is also exposed to assistive technology through `aria-describedby`.

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
- A reachable `Approval` node (or a legacy `input` node, its name before the upgrade) has neither `approve` nor `reject` outgoing branch.

## Explicitly Allowed (Does Not Block Run)

- Circular regular execution connections (non-subagent loops). The server stops a run that exceeds its step limit and reports it as an error in the Run Console.
- Unreachable/disconnected nodes outside `Start`-reachable path.
- `Condition` node with only one connected branch.
- `Approval` node with only one connected branch.
- Nested subagent chains (`A -> B -> C`) when acyclic and tool-only.

## Runtime Constraints Outside UI Preflight

Even when UI preflight passes, backend can still reject execution:

- Every `agent` node must use a model listed in `.config/config.json` (`400` otherwise).
- The provider of each model used must have its API key set, for example `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (`503` otherwise).
- Server can return runtime validation/execution errors.
- A run that loops past the server's step limit fails with an error.

Run and resume are executed through streaming endpoints:

- `POST /api/run-stream`
- `POST /api/resume-stream`

If a resume request fails, the editor asks the server for the run's current state. When the run is still waiting, the approval card is shown again so the decision can be retried.
