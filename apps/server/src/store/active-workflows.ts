import WorkflowEngine from '@agentic/workflow-engine';

const workflows = new Map<string, WorkflowEngine>();

export function addWorkflow(engine: WorkflowEngine): void {
  workflows.set(engine.getRunId(), engine);
}

export function getWorkflow(runId: string): WorkflowEngine | undefined {
  return workflows.get(runId);
}

export function removeWorkflow(runId: string): void {
  workflows.delete(runId);
}

