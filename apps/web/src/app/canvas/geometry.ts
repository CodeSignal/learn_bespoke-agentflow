import {
    APPROVE_HANDLE,
    COLLAPSED_NODE_FALLBACK_HEIGHT,
    DEFAULT_HEADER_CENTER_Y,
    DEFAULT_NODE_WIDTH,
    DEFAULT_SECONDARY_CENTER_Y,
    EXPANDED_NODE_FALLBACK_HEIGHT,
    EXPANDED_NODE_WIDTH,
    IF_FALLBACK_HANDLE,
    IF_PORT_BASE_TOP,
    IF_PORT_STEP,
    PORT_RADIUS,
    REJECT_HANDLE,
    SUBAGENT_CURVE_MIN_OFFSET,
    SUBAGENT_CURVE_RATIO,
    SUBAGENT_HANDLE,
    SUBAGENT_PORT_MIN_TOP
} from '../constants';
import { getIfConditionIndexFromHandle, getIfConditions } from '../graph/if-conditions';
import type { EditorNode, Point } from '../types';

// Port and connection positions are measured from the rendered node when it is
// mounted, with fixed fallbacks otherwise.

export function getNodeWidth(node: EditorNode | null | undefined): number {
    if (!node) return DEFAULT_NODE_WIDTH;
    if (node.data && !node.data.collapsed) {
        return EXPANDED_NODE_WIDTH;
    }
    // For collapsed nodes, read the actual rendered width. Since there is no
    // CSS width transition on .node, the class toggle is instant and
    // offsetWidth forces a synchronous reflow that returns the correct value.
    const el = document.getElementById(node.id);
    return el ? (el.offsetWidth || DEFAULT_NODE_WIDTH) : DEFAULT_NODE_WIDTH;
}

export function getNodeHeaderCenterYOffset(node: EditorNode): number {
    const nodeEl = document.getElementById(node.id);
    const headerEl = nodeEl?.querySelector('.node-header');
    if (!(headerEl instanceof HTMLElement)) return DEFAULT_HEADER_CENTER_Y;
    return Math.round(headerEl.offsetTop + (headerEl.offsetHeight / 2));
}

export function getNodeHeaderPortTop(node: EditorNode): number {
    return getNodeHeaderCenterYOffset(node) - PORT_RADIUS;
}

export function getNodeSecondaryCenterYOffset(node: EditorNode): number {
    const nodeEl = document.getElementById(node.id);
    const headerEl = nodeEl?.querySelector('.node-header');
    if (!(nodeEl instanceof HTMLElement) || !(headerEl instanceof HTMLElement)) {
        return DEFAULT_SECONDARY_CENTER_Y;
    }
    const bodyTop = headerEl.offsetTop + headerEl.offsetHeight;
    const bodyHeight = Math.max(nodeEl.offsetHeight - bodyTop, PORT_RADIUS * 2);
    return Math.round(bodyTop + (bodyHeight / 2));
}

export function getNodeSecondaryPortTop(node: EditorNode): number {
    return getNodeSecondaryCenterYOffset(node) - PORT_RADIUS;
}

export function getSubagentPortTop(node: EditorNode): number {
    const nodeEl = document.getElementById(node.id);
    const height = nodeEl?.offsetHeight
        ?? (node.data?.collapsed ? COLLAPSED_NODE_FALLBACK_HEIGHT : EXPANDED_NODE_FALLBACK_HEIGHT);
    return Math.max(SUBAGENT_PORT_MIN_TOP, height - PORT_RADIUS);
}

function getIfPortTop(index: number): number {
    return IF_PORT_BASE_TOP + (index * IF_PORT_STEP);
}

export function shouldAggregateCollapsedIfPorts(node: EditorNode): boolean {
    return node.type === 'if' && Boolean(node.data?.collapsed) && getIfConditions(node).length > 1;
}

export function getIfConditionPortTop(node: EditorNode, index: number): number {
    if (node.data?.collapsed) {
        return getNodeHeaderPortTop(node);
    }

    const nodeEl = document.getElementById(node.id);
    if (!nodeEl) {
        return getIfPortTop(index);
    }

    const conditionRows = Array.from(nodeEl.querySelectorAll('.condition-row')) as HTMLElement[];
    const row = conditionRows[index];
    if (!row) {
        return getIfPortTop(index);
    }

    return Math.round(row.offsetTop + (row.offsetHeight / 2) - PORT_RADIUS);
}

export function getIfFallbackPortTop(node: EditorNode): number {
    const conditions = getIfConditions(node);
    if (node.data?.collapsed) {
        return getNodeSecondaryPortTop(node);
    }

    const nodeEl = document.getElementById(node.id);
    if (!nodeEl) {
        return getIfPortTop(conditions.length);
    }

    const conditionRows = Array.from(nodeEl.querySelectorAll('.condition-row')) as HTMLElement[];
    const addConditionButton = nodeEl.querySelector('.add-condition-btn') as HTMLElement | null;
    if (addConditionButton) {
        return Math.round(addConditionButton.offsetTop + (addConditionButton.offsetHeight / 2) - PORT_RADIUS);
    }
    if (conditionRows.length === 0) {
        return getIfPortTop(conditions.length);
    }

    const lastRow = conditionRows[conditionRows.length - 1];
    const lastCenterTop = lastRow.offsetTop + (lastRow.offsetHeight / 2) - PORT_RADIUS;
    const dynamicStep = conditionRows.length > 1
        ? conditionRows[conditionRows.length - 1].offsetTop - conditionRows[conditionRows.length - 2].offsetTop
        : IF_PORT_STEP;

    return Math.round(lastCenterTop + dynamicStep);
}

export function getOutputPortCenterYOffset(node: EditorNode, sourceHandle?: string): number {
    if (sourceHandle === SUBAGENT_HANDLE) {
        return getSubagentPortTop(node) + PORT_RADIUS;
    }

    if (node.type === 'if') {
        if (shouldAggregateCollapsedIfPorts(node)) {
            if (sourceHandle === IF_FALLBACK_HANDLE) {
                return getNodeSecondaryCenterYOffset(node);
            }
            const conditionIndex = getIfConditionIndexFromHandle(sourceHandle);
            if (conditionIndex !== null) {
                return getNodeHeaderCenterYOffset(node);
            }
        }
        if (sourceHandle === IF_FALLBACK_HANDLE) {
            return getIfFallbackPortTop(node) + PORT_RADIUS;
        }
        const conditionIndex = getIfConditionIndexFromHandle(sourceHandle);
        if (conditionIndex !== null) {
            return getIfConditionPortTop(node, conditionIndex) + PORT_RADIUS;
        }
    }

    if (sourceHandle === APPROVE_HANDLE) return getNodeHeaderCenterYOffset(node);
    if (sourceHandle === REJECT_HANDLE) return getNodeSecondaryCenterYOffset(node);
    return getNodeHeaderCenterYOffset(node);
}

export function getConnectionStartPoint(sourceNode: EditorNode, sourceHandle?: string): Point {
    if (sourceHandle === SUBAGENT_HANDLE) {
        return {
            x: sourceNode.x + (getNodeWidth(sourceNode) / 2),
            y: sourceNode.y + getSubagentPortTop(sourceNode) + PORT_RADIUS
        };
    }
    return {
        x: sourceNode.x + getNodeWidth(sourceNode),
        y: sourceNode.y + getOutputPortCenterYOffset(sourceNode, sourceHandle)
    };
}

export function getConnectionEndPoint(targetNode: EditorNode, sourceHandle?: string): Point {
    if (sourceHandle === SUBAGENT_HANDLE) {
        return {
            x: targetNode.x + (getNodeWidth(targetNode) / 2),
            y: targetNode.y
        };
    }
    return {
        x: targetNode.x,
        y: targetNode.y + getNodeHeaderCenterYOffset(targetNode)
    };
}

export function getPathD(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    sourceHandle?: string
): string {
    if (sourceHandle === SUBAGENT_HANDLE) {
        const verticalControlOffset = Math.max(SUBAGENT_CURVE_MIN_OFFSET, Math.abs(endY - startY) * SUBAGENT_CURVE_RATIO);
        return `M ${startX} ${startY} C ${startX} ${startY + verticalControlOffset}, ${endX} ${endY - verticalControlOffset}, ${endX} ${endY}`;
    }
    const controlPointOffset = Math.abs(endX - startX) * 0.5;
    return `M ${startX} ${startY} C ${startX + controlPointOffset} ${startY}, ${endX - controlPointOffset} ${endY}, ${endX} ${endY}`;
}
