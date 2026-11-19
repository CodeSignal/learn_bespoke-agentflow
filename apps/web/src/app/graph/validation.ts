import type { WorkflowConnection } from '@agentflow/types';
import { APPROVE_HANDLE, IF_FALLBACK_HANDLE, INPUT_HANDLE, REJECT_HANDLE, SUBAGENT_HANDLE } from '../constants';
import type { EditorNode, WorkflowGraphPayload } from '../types';
import { getIfConditionIndexFromHandle } from './if-conditions';

export function isValidGraphInput(value: unknown): value is WorkflowGraphPayload {
    if (!value || typeof value !== 'object') return false;
    const graph = value as { nodes?: unknown; connections?: unknown };
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.connections)) return false;
    return graph.nodes.every((node) => {
        if (!node || typeof node !== 'object') return false;
        const candidate = node as { id?: unknown; type?: unknown };
        return typeof candidate.id === 'string' && typeof candidate.type === 'string';
    });
}

export function isSubagentConnection(connection: WorkflowConnection): boolean {
    return connection.sourceHandle === SUBAGENT_HANDLE;
}

export function getSubagentConnections(connections: WorkflowConnection[]): WorkflowConnection[] {
    return connections.filter((connection) => isSubagentConnection(connection));
}

export function getExecutionConnections(connections: WorkflowConnection[]): WorkflowConnection[] {
    return connections.filter((connection) => !isSubagentConnection(connection));
}

export function isSubagentTargetNode(nodeId: string, connections: WorkflowConnection[]): boolean {
    return connections.some(
        (connection) =>
            isSubagentConnection(connection) &&
            connection.target === nodeId
    );
}

export function getSubagentTargetIds(connections: WorkflowConnection[]): Set<string> {
    const targetIds = new Set<string>();
    getSubagentConnections(connections).forEach((connection) => {
        targetIds.add(connection.target);
    });
    return targetIds;
}

function isInputTargetHandle(handle: string | undefined): boolean {
    return !handle || handle === INPUT_HANDLE;
}

export function getSubagentGraphValidationError(
    nodes: EditorNode[],
    connections: WorkflowConnection[]
): string | null {
    const subagentConnections = getSubagentConnections(connections);
    if (subagentConnections.length === 0) {
        return null;
    }

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const incomingSubagentCounts = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const connection of subagentConnections) {
        const sourceNode = nodeById.get(connection.source);
        const targetNode = nodeById.get(connection.target);

        if (!sourceNode || sourceNode.type !== 'agent') {
            return 'Subagent links must start from an Agent node.';
        }
        if (!targetNode || targetNode.type !== 'agent') {
            return 'Subagent links must target an Agent node.';
        }
        if (!sourceNode.data?.tools || !sourceNode.data.tools.subagents) {
            return 'Enable Subagents on the parent agent before linking subagents.';
        }
        if (!isInputTargetHandle(connection.targetHandle)) {
            return 'Subagent links must connect to the target input handle.';
        }
        if (connection.source === connection.target) {
            return 'An agent cannot be a subagent of itself.';
        }

        incomingSubagentCounts.set(
            connection.target,
            (incomingSubagentCounts.get(connection.target) ?? 0) + 1
        );
        if ((incomingSubagentCounts.get(connection.target) ?? 0) > 1) {
            return 'A subagent can belong to only one parent agent.';
        }

        const adjacent = adjacency.get(connection.source) ?? [];
        adjacent.push(connection.target);
        adjacency.set(connection.source, adjacent);
    }

    const executionConnections = getExecutionConnections(connections);
    for (const targetId of incomingSubagentCounts.keys()) {
        const hasExecutionEdges = executionConnections.some(
            (connection) => connection.source === targetId || connection.target === targetId
        );
        if (hasExecutionEdges) {
            return 'Subagent targets cannot be connected to regular workflow execution edges.';
        }
    }

    const visitState = new Map<string, 'visiting' | 'visited'>();
    const visit = (nodeId: string, path: string[]): string | null => {
        const state = visitState.get(nodeId);
        if (state === 'visiting') {
            // `path` already ends with `nodeId`, the node that closes the cycle.
            const cycleStart = path.indexOf(nodeId);
            const cyclePath = path.slice(cycleStart).join(' -> ');
            return `Subagent hierarchy must be acyclic. Cycle: ${cyclePath}`;
        }
        if (state === 'visited') return null;

        visitState.set(nodeId, 'visiting');
        const neighbors = adjacency.get(nodeId) ?? [];
        for (const neighbor of neighbors) {
            const error = visit(neighbor, [...path, neighbor]);
            if (error) return error;
        }
        visitState.set(nodeId, 'visited');
        return null;
    };

    for (const nodeId of adjacency.keys()) {
        const error = visit(nodeId, [nodeId]);
        if (error) {
            return error;
        }
    }

    return null;
}

/** Validates adding `nextConnection` to `connections`. Returns a message, or null when allowed. */
export function getConnectionValidationError(
    nodes: EditorNode[],
    connections: WorkflowConnection[],
    nextConnection: WorkflowConnection
): string | null {
    const sourceNode = nodes.find((node) => node.id === nextConnection.source);
    const targetNode = nodes.find((node) => node.id === nextConnection.target);
    if (!sourceNode || !targetNode) {
        return 'Connection source or target node is missing.';
    }

    const candidateConnections = [...connections, nextConnection];

    if (isSubagentConnection(nextConnection)) {
        if (sourceNode.type !== 'agent') {
            return 'Only agent nodes can define subagents.';
        }
        if (!sourceNode.data?.tools || !sourceNode.data.tools.subagents) {
            return 'Enable Subagents on the parent agent before adding subagent links.';
        }
        if (targetNode.type !== 'agent') {
            return 'Subagent links can only target agent nodes.';
        }
        if (!isInputTargetHandle(nextConnection.targetHandle)) {
            return 'Subagent links must connect to the target input handle.';
        }
        if (nextConnection.source === nextConnection.target) {
            return 'An agent cannot be a subagent of itself.';
        }
    } else {
        if (isSubagentTargetNode(nextConnection.source, candidateConnections)) {
            return 'Subagent targets cannot be used as sources in regular workflow edges.';
        }
        if (isSubagentTargetNode(nextConnection.target, candidateConnections)) {
            return 'Subagent targets cannot be used as targets in regular workflow edges.';
        }
    }

    return getSubagentGraphValidationError(nodes, candidateConnections);
}

export function canNodeBecomeSubagentTarget(
    nodes: EditorNode[],
    connections: WorkflowConnection[],
    nodeId: string
): boolean {
    const targetNode = nodes.find((node) => node.id === nodeId);
    if (!targetNode || targetNode.type !== 'agent') {
        return false;
    }

    if (isSubagentTargetNode(nodeId, connections)) {
        return false;
    }

    const candidateParents = nodes.filter(
        (node) =>
            node.type === 'agent' &&
            node.id !== nodeId &&
            Boolean(node.data?.tools?.subagents)
    );

    return candidateParents.some((parentNode) => {
        const candidateConnection: WorkflowConnection = {
            source: parentNode.id,
            target: nodeId,
            sourceHandle: SUBAGENT_HANDLE,
            targetHandle: INPUT_HANDLE
        };
        return !getConnectionValidationError(nodes, connections, candidateConnection);
    });
}

/**
 * Run-readiness preflight. Returns the reason the workflow cannot run, or null.
 * The rules are documented in `apps/web/docs/run-readiness.md`.
 */
export function getRunDisableReason(nodes: EditorNode[], connections: WorkflowConnection[]): string | null {
    const startNodes = nodes.filter((node) => node.type === 'start');
    if (startNodes.length === 0) {
        return 'Add a Start node to run the workflow.';
    }
    if (startNodes.length > 1) {
        return 'Use only one Start node before running.';
    }

    const nodeIdSet = new Set(nodes.map((node) => node.id));
    const hasBrokenConnection = connections.some(
        (conn) => !nodeIdSet.has(conn.source) || !nodeIdSet.has(conn.target)
    );
    if (hasBrokenConnection) {
        return 'Fix broken connections before running.';
    }

    const subagentGraphError = getSubagentGraphValidationError(nodes, connections);
    if (subagentGraphError) {
        return subagentGraphError;
    }

    const startNode = startNodes[0];
    const adjacency = new Map<string, WorkflowConnection[]>();
    getExecutionConnections(connections).forEach((conn) => {
        const outgoing = adjacency.get(conn.source) ?? [];
        outgoing.push(conn);
        adjacency.set(conn.source, outgoing);
    });

    const startConnections = adjacency.get(startNode.id) ?? [];
    if (startConnections.length === 0) {
        return 'Connect Start to another node before running.';
    }

    const reachable = new Set<string>([startNode.id]);
    const queue: string[] = [startNode.id];
    while (queue.length > 0) {
        const nodeId = queue.shift() as string;
        const next = adjacency.get(nodeId) ?? [];
        next.forEach((conn) => {
            if (!reachable.has(conn.target)) {
                reachable.add(conn.target);
                queue.push(conn.target);
            }
        });
    }

    for (const node of nodes) {
        if (!reachable.has(node.id)) continue;
        const outgoing = adjacency.get(node.id) ?? [];
        if (node.type === 'if') {
            const hasConditionBranch = outgoing.some((conn) => getIfConditionIndexFromHandle(conn.sourceHandle) !== null);
            const hasFallbackBranch = outgoing.some((conn) => conn.sourceHandle === IF_FALLBACK_HANDLE);
            if (!hasConditionBranch && !hasFallbackBranch) {
                return 'Connect at least one branch for each Condition node.';
            }
        }
        // `input` is the pre-upgrade name of the approval node.
        if (node.type === 'approval' || node.type === 'input') {
            const hasApprove = outgoing.some((conn) => conn.sourceHandle === APPROVE_HANDLE);
            const hasReject = outgoing.some((conn) => conn.sourceHandle === REJECT_HANDLE);
            if (!hasApprove && !hasReject) {
                return 'Connect at least one branch for each User Approval node.';
            }
        }
    }

    return null;
}
