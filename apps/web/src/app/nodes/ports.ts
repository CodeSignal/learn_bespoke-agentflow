import {
    AGGREGATE_PORT_RADIUS,
    APPROVE_HANDLE,
    IF_FALLBACK_HANDLE,
    INPUT_HANDLE,
    OUTPUT_HANDLE,
    REJECT_HANDLE,
    SUBAGENT_HANDLE,
    SUBAGENT_TARGET_HANDLE
} from '../constants';
import {
    getIfConditionPortTop,
    getIfFallbackPortTop,
    getNodeHeaderCenterYOffset,
    getNodeHeaderPortTop,
    getNodeSecondaryPortTop,
    shouldAggregateCollapsedIfPorts
} from '../canvas/geometry';
import type { PortInteractions } from '../editor-host';
import { getIfConditionHandle, getIfConditions } from '../graph/if-conditions';
import type { EditorNode } from '../types';

export type CreatePort = (
    nodeId: string,
    handle: string,
    className: string,
    title?: string,
    top?: number | null,
    connectable?: boolean
) => HTMLElement;

export function isTargetPortHandle(handle: string): boolean {
    return handle === INPUT_HANDLE || handle === SUBAGENT_TARGET_HANDLE;
}

/** Builds one connector. Target ports accept a connection; the others start one. */
export function createPortElement(
    interactions: PortInteractions,
    nodeId: string,
    handle: string,
    className: string,
    title = '',
    top: number | null = null,
    connectable = true
): HTMLDivElement {
    const port = document.createElement('div');
    port.className = `port ${className}${connectable ? '' : ' port-disabled'}`;
    if (title) {
        port.title = title;
        port.setAttribute('data-tooltip', title);
        port.setAttribute('aria-label', title);
    }
    if (typeof top === 'number') {
        port.style.top = `${top}px`;
    }
    port.dataset.nodeId = nodeId;
    port.dataset.handle = handle;
    port.setAttribute('role', 'button');
    if (!connectable) {
        port.setAttribute('aria-disabled', 'true');
        return port;
    }

    port.tabIndex = 0;
    if (isTargetPortHandle(handle)) {
        port.addEventListener('mouseup', (e) => interactions.onPortMouseUp(e, nodeId, handle));
    } else {
        port.addEventListener('mousedown', (e) => interactions.onPortMouseDown(e, nodeId, handle));
    }
    port.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        interactions.onPortKeyActivate(nodeId, handle);
    });
    return port;
}

/** Appends the connectors for `node` to its element. */
export function renderPorts(node: EditorNode, el: { appendChild: (port: HTMLElement) => unknown }, createPort: CreatePort): void {
    if (node.type === 'agent') {
        el.appendChild(
            createPort(
                node.id,
                SUBAGENT_TARGET_HANDLE,
                'port-subagent-target',
                'Set as subagent'
            )
        );
    }

    if (node.type !== 'start') {
        const portIn = createPort(node.id, INPUT_HANDLE, 'port-in', 'Input', getNodeHeaderPortTop(node));
        el.appendChild(portIn);
    }

    if (node.type === 'if') {
        const conditions = getIfConditions(node);
        if (shouldAggregateCollapsedIfPorts(node)) {
            const aggregateConditionPort = createPort(
                node.id,
                getIfConditionHandle(0),
                'port-out port-condition port-condition-aggregate',
                'Expand to connect',
                getNodeHeaderCenterYOffset(node) - AGGREGATE_PORT_RADIUS,
                false
            );
            aggregateConditionPort.textContent = String(conditions.length);
            aggregateConditionPort.setAttribute('aria-label', 'Expand to connect');
            el.appendChild(aggregateConditionPort);
            el.appendChild(
                createPort(
                    node.id,
                    IF_FALLBACK_HANDLE,
                    'port-out port-condition-fallback',
                    'Fallback path',
                    getNodeSecondaryPortTop(node)
                )
            );
        } else {
            conditions.forEach((_condition, index) => {
                el.appendChild(
                    createPort(
                        node.id,
                        getIfConditionHandle(index),
                        'port-out port-condition',
                        `Condition ${index + 1}`,
                        getIfConditionPortTop(node, index)
                    )
                );
            });
            el.appendChild(
                createPort(
                    node.id,
                    IF_FALLBACK_HANDLE,
                    'port-out port-condition-fallback',
                    'Fallback path',
                    getIfFallbackPortTop(node)
                )
            );
        }
    } else if (node.type === 'agent') {
        el.appendChild(createPort(node.id, OUTPUT_HANDLE, 'port-out', 'Output', getNodeHeaderPortTop(node)));
        if (node.data?.tools?.subagents) {
            el.appendChild(
                createPort(
                    node.id,
                    SUBAGENT_HANDLE,
                    'port-subagent',
                    'Add subagent'
                )
            );
        }
    } else if (node.type === 'approval') {
        el.appendChild(
            createPort(
                node.id,
                APPROVE_HANDLE,
                'port-out port-true',
                'Approve path',
                getNodeHeaderPortTop(node)
            )
        );
        el.appendChild(
            createPort(
                node.id,
                REJECT_HANDLE,
                'port-out port-false',
                'Reject path',
                getNodeSecondaryPortTop(node)
            )
        );
    } else {
        const outputTooltip = node.type === 'start' ? 'Next step' : 'Output';
        el.appendChild(createPort(node.id, OUTPUT_HANDLE, 'port-out', outputTooltip, getNodeHeaderPortTop(node)));
    }
}
