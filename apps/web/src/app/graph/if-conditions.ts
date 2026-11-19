import type { WorkflowConnection } from '@agentflow/types';
import {
    DEFAULT_IF_CONDITION,
    IF_CONDITION_HANDLE_PREFIX,
    LEGACY_IF_TRUE_HANDLE
} from '../constants';
import type { EditorNode, IfCondition } from '../types';

export function normalizeIfCondition(condition: unknown): IfCondition {
    const asRecord = (typeof condition === 'object' && condition !== null) ? condition as Partial<IfCondition> : undefined;
    const candidateOperator = asRecord?.operator;
    const rawValue = asRecord?.value;
    return {
        operator: candidateOperator === 'contains' ? 'contains' : 'equal',
        value: typeof rawValue === 'string' ? rawValue : ''
    };
}

export function getIfConditionHandle(index: number): string {
    return `${IF_CONDITION_HANDLE_PREFIX}${index}`;
}

export function getIfConditionIndexFromHandle(handle: string | undefined): number | null {
    if (handle === LEGACY_IF_TRUE_HANDLE) return 0;
    if (typeof handle !== 'string' || !handle.startsWith(IF_CONDITION_HANDLE_PREFIX)) return null;
    const parsedIndex = Number.parseInt(handle.slice(IF_CONDITION_HANDLE_PREFIX.length), 10);
    return Number.isInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : null;
}

/** Returns the node's conditions, normalising them in place (always at least one). */
export function getIfConditions(node: EditorNode): IfCondition[] {
    if (!node.data) node.data = {};
    if (!Array.isArray(node.data.conditions) || node.data.conditions.length === 0) {
        node.data.conditions = [{ ...DEFAULT_IF_CONDITION }];
    }
    node.data.conditions = node.data.conditions.map((condition) => normalizeIfCondition(condition));
    return node.data.conditions;
}

/**
 * Removes one condition from the node and returns the connection list with the
 * removed branch dropped and the later branches re-indexed.
 */
export function removeIfCondition(
    node: EditorNode,
    conditionIndex: number,
    connections: WorkflowConnection[]
): WorkflowConnection[] {
    const conditions = getIfConditions(node);
    if (conditions.length <= 1) return connections;
    if (!node.data) return connections;

    node.data.conditions = conditions.filter((_, index) => index !== conditionIndex);
    return connections.reduce<WorkflowConnection[]>((nextConnections, connection) => {
        if (connection.source !== node.id) {
            nextConnections.push(connection);
            return nextConnections;
        }

        const sourceIndex = getIfConditionIndexFromHandle(connection.sourceHandle);
        if (sourceIndex === null) {
            nextConnections.push(connection);
            return nextConnections;
        }
        if (sourceIndex === conditionIndex) {
            return nextConnections;
        }
        if (sourceIndex > conditionIndex) {
            nextConnections.push({
                ...connection,
                sourceHandle: getIfConditionHandle(sourceIndex - 1)
            });
            return nextConnections;
        }

        nextConnections.push(connection);
        return nextConnections;
    }, []);
}
