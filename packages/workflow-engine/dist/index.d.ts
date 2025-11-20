import { ApprovalInput, WorkflowGraph, WorkflowLogEntry, WorkflowRunResult, WorkflowStatus } from '@agentic/types';
type AgentToolsConfig = {
    web_search?: boolean;
};
export interface AgentInvocation {
    systemPrompt: string;
    userContent: string;
    model: string;
    reasoningEffort?: string;
    tools?: AgentToolsConfig;
}
export interface WorkflowLLM {
    respond: (input: AgentInvocation) => Promise<string>;
}
export interface WorkflowEngineInitOptions {
    runId?: string;
    llm?: WorkflowLLM;
    timestampFn?: () => string;
    onLog?: (entry: WorkflowLogEntry) => void;
}
export declare class WorkflowEngine {
    private readonly runId;
    private readonly timestampFn;
    private readonly onLog?;
    private graph;
    private llm;
    private logs;
    private state;
    private status;
    private currentNodeId;
    private waitingForInput;
    constructor(graph: WorkflowGraph, options?: WorkflowEngineInitOptions);
    getRunId(): string;
    getLogs(): WorkflowLogEntry[];
    getStatus(): WorkflowStatus;
    getResult(): WorkflowRunResult;
    run(): Promise<WorkflowRunResult>;
    resume(input?: ApprovalInput | string | Record<string, unknown>): Promise<WorkflowRunResult>;
    private normalizeGraph;
    private log;
    private processNode;
    private describeNode;
    private evaluateIfNode;
    private executeAgentNode;
    private findLastNonApprovalOutput;
    private normalizeApprovalInput;
    private describeApprovalResult;
}
export default WorkflowEngine;
