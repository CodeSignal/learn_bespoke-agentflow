import type { WorkflowConnection } from '@agentflow/types';
import { CONNECTION_DRAG_THRESHOLD_PX, INPUT_HANDLE, SUBAGENT_HANDLE, SUBAGENT_TARGET_HANDLE } from '../constants';
import type { EditorHost } from '../editor-host';
import { getIfConditionIndexFromHandle } from '../graph/if-conditions';
import {
    canNodeBecomeSubagentTarget,
    getConnectionValidationError,
    getSubagentTargetIds
} from '../graph/validation';
import { getNodeAccessibleName } from '../nodes/node-view';
import { isTargetPortHandle } from '../nodes/ports';
import type { ConnectionStart } from '../types';
import {
    getConnectionEndPoint,
    getConnectionStartPoint,
    getPathD,
    shouldAggregateCollapsedIfPorts
} from './geometry';

const SVG_NS = 'http://www.w3.org/2000/svg';

type ReconnectState = {
    connection: WorkflowConnection;
    index: number;
};

type LinePress = ReconnectState & {
    clientX: number;
    clientY: number;
};

export function isSameConnection(a: WorkflowConnection | null, b: WorkflowConnection | null): boolean {
    if (!a || !b) return false;
    return a.source === b.source &&
        a.target === b.target &&
        a.sourceHandle === b.sourceHandle &&
        a.targetHandle === b.targetHandle;
}

export function getConnectionLineClass(
    sourceHandle?: string,
    options: { editable?: boolean; reconnecting?: boolean; selected?: boolean } = {}
): string {
    const classes = ['connection-line'];
    if (options.editable) {
        classes.push('editable');
    }
    if (sourceHandle === SUBAGENT_HANDLE) {
        classes.push('connection-line-subagent');
    }
    if (options.reconnecting) {
        classes.push('reconnecting');
    }
    if (options.selected) {
        classes.push('selected');
    }
    return classes.join(' ');
}

/**
 * Connection lines: rendering, creating by dragging from a port (or from the
 * keyboard), reconnecting by dragging a line, selecting and deleting.
 */
export class ConnectionsController {
    private tempConnection: SVGPathElement | null = null;

    private connectionStart: ConnectionStart | null = null;

    /** The connection being re-dragged; it is out of the list until dropped. */
    private reconnecting: ReconnectState | null = null;

    /** A press on a line that has not moved far enough to count as a drag yet. */
    private linePress: LinePress | null = null;

    constructor(private readonly host: EditorHost) {}

    /** True while a connection is being created or re-dragged. */
    isConnecting(): boolean {
        return this.connectionStart !== null;
    }

    // --- Creating connections ---

    onPortMouseDown(e: MouseEvent, nodeId: string, handle: string): void {
        e.stopPropagation();
        e.preventDefault();
        if (!this.host.connectionsLayer) return;
        this.host.setCanvasValidationMessage(null);
        const started = this.startConnectionFrom(nodeId, handle, this.host.viewport.screenToWorld(e.clientX, e.clientY));
        if (!started || !this.connectionStart) return;

        this.tempConnection = document.createElementNS(SVG_NS, 'path');
        this.tempConnection.setAttribute('class', getConnectionLineClass(handle));
        this.tempConnection.setAttribute('d', `M ${this.connectionStart.x} ${this.connectionStart.y} L ${this.connectionStart.x} ${this.connectionStart.y}`);
        this.host.connectionsLayer.appendChild(this.tempConnection);
    }

    onPortMouseUp(e: MouseEvent, nodeId: string, handle: string): void {
        e.stopPropagation();
        this.completeConnectionAt(nodeId, handle);
    }

    /** Enter/Space on a port: start a connection from a source port, or finish one on a target port. */
    onPortKeyActivate(nodeId: string, handle: string): void {
        if (isTargetPortHandle(handle)) {
            if (!this.connectionStart) {
                this.host.setCanvasValidationMessage('Start from an output connector, then choose this input.');
                return;
            }
            this.completeConnectionAt(nodeId, handle);
            return;
        }

        this.cancelPendingConnection();
        if (this.startConnectionFrom(nodeId, handle, null)) {
            this.host.setCanvasValidationMessage(
                'Connection started. Focus a target input connector and press Enter, or press Escape to cancel.'
            );
        }
    }

    private startConnectionFrom(nodeId: string, handle: string, fallbackPoint: { x: number; y: number } | null): boolean {
        const sourceNode = this.host.store.nodes.find((candidate) => candidate.id === nodeId);
        if (sourceNode && shouldAggregateCollapsedIfPorts(sourceNode) && getIfConditionIndexFromHandle(handle) !== null) {
            return false;
        }
        const startPoint = sourceNode
            ? getConnectionStartPoint(sourceNode, handle)
            : fallbackPoint ?? { x: 0, y: 0 };
        this.connectionStart = { nodeId, handle, x: startPoint.x, y: startPoint.y };
        return true;
    }

    private completeConnectionAt(nodeId: string, handle: string): void {
        if (!this.connectionStart) return;

        let connected = false;
        if (this.connectionStart.nodeId === nodeId) {
            // Dropped on the node it started from: not a connection.
        } else if (this.connectionStart.handle === SUBAGENT_HANDLE && handle !== SUBAGENT_TARGET_HANDLE) {
            this.host.setCanvasValidationMessage('Subagent links must connect to the top green subagent connector.');
        } else if (this.connectionStart.handle !== SUBAGENT_HANDLE && handle === SUBAGENT_TARGET_HANDLE) {
            this.host.setCanvasValidationMessage('Regular workflow links must connect to the side input connector.');
        } else {
            connected = this.applyPendingConnection({
                source: this.connectionStart.nodeId,
                target: nodeId,
                sourceHandle: this.connectionStart.handle,
                targetHandle: INPUT_HANDLE
            });
        }

        if (!connected) {
            this.restoreReconnectingConnection();
        }
        this.reconnecting = null;
        this.clearPendingConnectionDragState();
        this.host.renderConnections();
        this.host.updateRunButton();
        if (connected) {
            this.host.commitHistory();
        }
    }

    /** Adds the connection when it is new and valid. */
    applyPendingConnection(nextConnection: WorkflowConnection): boolean {
        const { nodes, connections } = this.host.store;
        const duplicateExists = connections.some((conn) => isSameConnection(conn, nextConnection));
        if (duplicateExists) {
            return false;
        }

        const validationError = getConnectionValidationError(nodes, connections, nextConnection);
        if (validationError) {
            this.host.setCanvasValidationMessage(validationError);
            return false;
        }

        this.host.setCanvasValidationMessage(null);
        connections.push(nextConnection);
        return true;
    }

    private restoreReconnectingConnection(): void {
        if (!this.reconnecting) return;
        const { connections } = this.host.store;
        const { connection, index } = this.reconnecting;
        if (!connections.some((conn) => isSameConnection(conn, connection))) {
            connections.splice(Math.min(index, connections.length), 0, connection);
        }
        this.reconnecting = null;
    }

    private clearPendingConnectionDragState(): void {
        if (this.tempConnection) {
            this.tempConnection.remove();
        }
        this.connectionStart = null;
        this.tempConnection = null;
    }

    /** Escape: abandon the connection being made and put a re-dragged line back. */
    cancelPendingConnection(): boolean {
        if (!this.connectionStart && !this.linePress) return false;
        this.linePress = null;
        const wasReconnecting = this.reconnecting !== null;
        this.restoreReconnectingConnection();
        this.clearPendingConnectionDragState();
        if (wasReconnecting) {
            this.host.renderConnections();
            this.host.updateRunButton();
        }
        return true;
    }

    // --- Selecting and re-dragging existing lines ---

    private onConnectionLineMouseDown(e: MouseEvent, connection: WorkflowConnection, index: number): void {
        e.stopPropagation();
        e.preventDefault();
        this.linePress = { connection, index, clientX: e.clientX, clientY: e.clientY };
    }

    private beginReconnect(press: LinePress, e: MouseEvent): void {
        const { host } = this;
        if (!host.connectionsLayer) return;
        const { connection } = press;
        const sourceNode = host.store.nodes.find((n) => n.id === connection.source);
        if (!sourceNode) return;
        const index = host.store.connections.findIndex((conn) => isSameConnection(conn, connection));
        if (index < 0) return;

        const startPoint = getConnectionStartPoint(sourceNode, connection.sourceHandle);
        const world = host.viewport.screenToWorld(e.clientX, e.clientY);

        this.reconnecting = { connection, index };
        this.connectionStart = {
            nodeId: connection.source,
            handle: connection.sourceHandle ?? '',
            x: startPoint.x,
            y: startPoint.y
        };

        // Take the original connection out while it is being dragged.
        host.store.connections.splice(index, 1);
        if (isSameConnection(host.store.selectedConnection, connection)) {
            host.store.selectedConnection = null;
        }
        host.renderConnections();
        host.updateRunButton();

        // Create temp connection for dragging
        this.tempConnection = document.createElementNS(SVG_NS, 'path');
        this.tempConnection.setAttribute(
            'class',
            getConnectionLineClass(connection.sourceHandle, { reconnecting: true })
        );
        this.tempConnection.setAttribute(
            'd',
            getPathD(startPoint.x, startPoint.y, world.x, world.y, connection.sourceHandle)
        );
        host.connectionsLayer.appendChild(this.tempConnection);
    }

    handleDocumentMouseMove(e: MouseEvent): void {
        if (this.linePress) {
            const travelled = Math.hypot(e.clientX - this.linePress.clientX, e.clientY - this.linePress.clientY);
            if (travelled >= CONNECTION_DRAG_THRESHOLD_PX) {
                const press = this.linePress;
                this.linePress = null;
                this.beginReconnect(press, e);
            }
        }

        if (this.tempConnection && this.connectionStart) {
            const world = this.host.viewport.screenToWorld(e.clientX, e.clientY);
            this.tempConnection.setAttribute(
                'd',
                getPathD(
                    this.connectionStart.x,
                    this.connectionStart.y,
                    world.x,
                    world.y,
                    this.connectionStart.handle
                )
            );
        }
    }

    /**
     * A mouse release that no target port handled. A plain click on a line
     * selects it. A re-dragged line released on empty canvas is removed; released
     * over a connector that cannot take it, it goes back where it was.
     */
    handleDocumentMouseUp(e: MouseEvent): void {
        if (this.linePress) {
            const { connection } = this.linePress;
            this.linePress = null;
            this.host.selectConnection(connection);
            return;
        }
        if (!this.tempConnection) return;

        if (this.reconnecting) {
            const overPort = e.target instanceof Element && e.target.closest('.port') !== null;
            if (overPort) {
                this.restoreReconnectingConnection();
            } else {
                this.reconnecting = null;
                this.host.setCanvasValidationMessage('Connection removed. Press Ctrl/Cmd+Z to undo.');
                this.host.commitHistory();
            }
            this.host.renderConnections();
            this.host.updateRunButton();
        }
        this.clearPendingConnectionDragState();
    }

    /** Removes a connection (keyboard Delete on a selected line). */
    deleteConnection(connection: WorkflowConnection): void {
        const { store } = this.host;
        const index = store.connections.findIndex((conn) => isSameConnection(conn, connection));
        if (index < 0) return;
        store.connections.splice(index, 1);
        if (isSameConnection(store.selectedConnection, connection)) {
            store.selectedConnection = null;
        }
        this.host.renderConnections();
        this.host.updateRunButton();
        this.host.commitHistory();
    }

    // --- Rendering ---

    render(): void {
        const { host } = this;
        if (!host.connectionsLayer) return;
        const { nodes, connections } = host.store;
        this.updateSubagentTargetNodeStyles();
        const connectionsLayer = host.connectionsLayer;
        // Clear only permanent lines
        const lines = Array.from(connectionsLayer.querySelectorAll('.connection-line'));
        lines.forEach((line) => {
            if (line !== this.tempConnection) line.remove();
        });

        if (host.store.selectedConnection && !connections.some((conn) => isSameConnection(conn, host.store.selectedConnection))) {
            host.store.selectedConnection = null;
        }

        connections.forEach((conn, index) => {
            const sourceNode = nodes.find((n) => n.id === conn.source);
            const targetNode = nodes.find((n) => n.id === conn.target);
            if (!sourceNode || !targetNode) return;

            const startPoint = getConnectionStartPoint(sourceNode, conn.sourceHandle);
            const endPoint = getConnectionEndPoint(targetNode, conn.sourceHandle);

            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('class', getConnectionLineClass(conn.sourceHandle, {
                editable: true,
                selected: isSameConnection(host.store.selectedConnection, conn)
            }));
            path.setAttribute('d', getPathD(startPoint.x, startPoint.y, endPoint.x, endPoint.y, conn.sourceHandle));
            path.dataset.connectionIndex = String(index);
            path.dataset.sourceNodeId = conn.source;
            path.dataset.sourceHandle = conn.sourceHandle ?? '';
            path.dataset.targetNodeId = conn.target;
            path.setAttribute('tabindex', '0');
            path.setAttribute('role', 'button');
            path.setAttribute(
                'aria-label',
                `Connection from ${getNodeAccessibleName(sourceNode)} to ${getNodeAccessibleName(targetNode)}. Press Delete to remove.`
            );
            path.addEventListener('mousedown', (e) => this.onConnectionLineMouseDown(e, conn, index));
            path.addEventListener('focus', () => host.selectConnection(conn));
            connectionsLayer.appendChild(path);
        });
        host.scheduleSave();
    }

    /** Marks the selected line without re-rendering (keeps keyboard focus on it). */
    syncSelectionClasses(): void {
        const { host } = this;
        if (!host.connectionsLayer) return;
        const { connections, selectedConnection } = host.store;
        host.connectionsLayer.querySelectorAll('.connection-line.editable').forEach((line) => {
            if (!(line instanceof SVGElement)) return;
            const conn = connections[Number(line.dataset.connectionIndex)];
            line.classList.toggle('selected', Boolean(conn) && isSameConnection(selectedConnection, conn));
        });
    }

    private updateSubagentTargetNodeStyles(): void {
        const { nodes, connections } = this.host.store;
        const subagentTargets = getSubagentTargetIds(connections);
        nodes.forEach((node) => {
            const el = document.getElementById(node.id);
            if (!el) return;
            const isSubagentTarget = node.type === 'agent' && subagentTargets.has(node.id);
            el.classList.toggle('subagent-target-node', isSubagentTarget);
            const isSubagentCandidate =
                node.type === 'agent' &&
                (isSubagentTarget || canNodeBecomeSubagentTarget(nodes, connections, node.id));
            el.classList.toggle('subagent-candidate-node', isSubagentCandidate);
        });
    }
}
