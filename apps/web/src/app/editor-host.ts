import type { WorkflowConnection } from '@agentflow/types';
import type { ViewportController } from './canvas/viewport';
import type { EditorNode } from './types';

/** Mutable editor state shared by the canvas modules. */
export type EditorStore = {
    nodes: EditorNode[];
    connections: WorkflowConnection[];
    nextNodeId: number;
    selectedNodeId: string | null;
    selectedConnection: WorkflowConnection | null;
    modelOptions: string[];
    modelEfforts: Record<string, string[]>;
};

/** Pointer and keyboard handlers a port element forwards to. */
export interface PortInteractions {
    onPortMouseDown(event: MouseEvent, nodeId: string, handle: string): void;
    onPortMouseUp(event: MouseEvent, nodeId: string, handle: string): void;
    onPortKeyActivate(nodeId: string, handle: string): void;
}

/**
 * What the canvas modules (node view, node forms, connections) need from the
 * editor. Implemented by `WorkflowEditor`, the composition root.
 */
export interface EditorHost extends PortInteractions {
    readonly store: EditorStore;
    readonly viewport: ViewportController;
    readonly nodesLayer: HTMLElement | null;
    readonly connectionsLayer: SVGSVGElement | HTMLElement | null;

    renderConnections(): void;
    scheduleConnectionLayoutSync(): void;
    refreshNodePorts(node: EditorNode): void;
    rerenderNodeForm(node: EditorNode): void;
    updateRunButton(): void;
    /** Debounced save; also records an undo step once the edits settle. */
    scheduleSave(): void;
    /** Records an undo step now (for discrete edits such as connect or delete). */
    commitHistory(): void;
    setCanvasValidationMessage(message: string | null): void;

    selectNode(id: string | null): void;
    selectConnection(connection: WorkflowConnection | null): void;
    requestDeleteNode(id: string): Promise<void>;
    duplicateAgentNode(node: EditorNode): void;
    toggleNodeCollapsed(node: EditorNode): void;
    beginNodeDrag(node: EditorNode, event: MouseEvent): void;
    nudgeNode(node: EditorNode, dx: number, dy: number): void;
}
