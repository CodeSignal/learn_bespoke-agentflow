import type { WorkflowConnection, WorkflowNode } from '@agentflow/types';

export type WorkflowState = 'idle' | 'running' | 'paused';

export type Point = {
    x: number;
    y: number;
};

export type Viewport = Point & {
    scale: number;
};

export type IfConditionOperator = 'equal' | 'contains';

export type IfCondition = {
    operator: IfConditionOperator;
    value: string;
};

export type AgentTools = Record<string, boolean>;

export type WorkflowNodeData = {
    collapsed?: boolean;
    initialInput?: string;
    agentName?: string;
    systemPrompt?: string;
    userPrompt?: string;
    model?: string;
    reasoningEffort?: string;
    tools?: AgentTools;
    prompt?: string;
    /** Single-condition string written by old versions; upgraded on load. */
    condition?: string;
    conditions?: IfCondition[];
    [key: string]: unknown;
};

export type EditorNode = WorkflowNode<WorkflowNodeData>;

export type WorkflowGraphPayload = {
    nodes: EditorNode[];
    connections: WorkflowConnection[];
};

export type ToolConfig = {
    key: string;
    label: string;
    iconClass: string;
};

export type ConnectionStart = {
    nodeId: string;
    handle: string;
    x: number;
    y: number;
};

export type ApprovalDecision = 'approve' | 'reject';

export type SubagentRuntimeLogPayload = {
    parentNodeId?: string;
    subagentNodeId: string;
    subagentName: string;
    callId: string;
    parentCallId?: string;
    depth: number;
    message?: string;
};

export type SubagentCallStatus = 'running' | 'completed' | 'failed';

export type ConfirmOptions = {
    title?: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
};
