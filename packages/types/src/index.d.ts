export type NodeType = 'start' | 'agent' | 'if' | 'approval' | 'end' | string;
export interface BaseNodeData {
    collapsed?: boolean;
    [key: string]: unknown;
}
export interface WorkflowNode<TData extends BaseNodeData = BaseNodeData> {
    id: string;
    type: NodeType;
    x: number;
    y: number;
    data?: TData;
}
export interface WorkflowConnection {
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
}
export interface WorkflowGraph {
    nodes: WorkflowNode[];
    connections: WorkflowConnection[];
}
export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';
export interface WorkflowLogEntry {
    timestamp: string;
    nodeId: string | 'system';
    type: string;
    content: string;
}
export interface WorkflowRunResult {
    runId: string;
    status: WorkflowStatus;
    logs: WorkflowLogEntry[];
    state: Record<string, unknown>;
    waitingForInput: boolean;
    currentNodeId: string | null;
}
export interface ApprovalInput {
    decision: 'approve' | 'reject';
    note?: string;
}
export interface WorkflowEngineResult extends WorkflowRunResult {
}
