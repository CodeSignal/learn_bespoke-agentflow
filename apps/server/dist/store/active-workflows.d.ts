import WorkflowEngine from '@agentic/workflow-engine';
export declare function addWorkflow(engine: WorkflowEngine): void;
export declare function getWorkflow(runId: string): WorkflowEngine | undefined;
export declare function removeWorkflow(runId: string): void;
