import type { WorkflowConnection } from '@agentflow/types';
import { DEFAULT_APPROVAL_PROMPT, DEFAULT_IF_CONDITION, LEGACY_IF_TRUE_HANDLE } from '../constants';
import type { AgentTools, EditorNode } from '../types';
import { getIfConditionHandle, normalizeIfCondition } from './if-conditions';

/**
 * Upgrades graphs saved by older versions, in place:
 * - `input` nodes become `approval` nodes;
 * - agent `tools` always has both boolean flags;
 * - a Condition node's single `condition` string becomes a `conditions` list;
 * - the Condition node's `true` handle becomes `condition-0`.
 *
 * Saved workflows in localStorage and course-supplied default workflows can
 * still have these shapes, so this must keep working.
 *
 * @returns true only when something actually changed.
 */
export function upgradeLegacyGraph(nodes: EditorNode[], connections: WorkflowConnection[]): boolean {
    let updated = false;
    const ifNodeIds = new Set<string>();

    nodes.forEach((node) => {
        if (node.type === 'input') {
            node.type = 'approval';
            if (!node.data) node.data = {};
            if (node.data.prompt === undefined) {
                node.data.prompt = DEFAULT_APPROVAL_PROMPT;
            }
            updated = true;
        }

        if (node.type === 'agent') {
            if (!node.data) node.data = {};
            const tools: AgentTools = (node.data.tools && typeof node.data.tools === 'object')
                ? node.data.tools
                : {};
            const nextTools = {
                web_search: Boolean(tools.web_search),
                subagents: Boolean(tools.subagents)
            };
            if (
                !node.data.tools ||
                node.data.tools.web_search !== nextTools.web_search ||
                node.data.tools.subagents !== nextTools.subagents
            ) {
                node.data.tools = nextTools;
                updated = true;
            }
        }

        if (node.type === 'if') {
            ifNodeIds.add(node.id);
            if (!node.data) node.data = {};
            const before = JSON.stringify(node.data.conditions ?? null);
            const rawLegacyCondition = typeof node.data.condition === 'string' ? node.data.condition : '';
            const rawConditions: unknown[] = Array.isArray(node.data.conditions) && node.data.conditions.length > 0
                ? node.data.conditions
                : 'condition' in node.data
                    ? [{ operator: 'contains', value: rawLegacyCondition }]
                    : [{ ...DEFAULT_IF_CONDITION }];
            node.data.conditions = rawConditions.map((condition) => normalizeIfCondition(condition));
            if (JSON.stringify(node.data.conditions) !== before) {
                updated = true;
            }
            if ('condition' in node.data) {
                delete node.data.condition;
                updated = true;
            }
        }
    });

    connections.forEach((connection) => {
        if (!ifNodeIds.has(connection.source)) return;
        if (connection.sourceHandle === LEGACY_IF_TRUE_HANDLE) {
            connection.sourceHandle = getIfConditionHandle(0);
            updated = true;
        }
    });

    return updated;
}
