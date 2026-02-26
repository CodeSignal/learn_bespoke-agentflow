// Bespoke Agent Builder - Client Logic

import type { WorkflowConnection, WorkflowGraph, WorkflowNode, WorkflowRunResult } from '@agentic/types';
import { runWorkflowStream, resumeWorkflowStream, fetchConfig, fetchRun } from '../services/api';
import { renderMarkdown, escapeHtml } from './markdown';

const EXPANDED_NODE_WIDTH = 420;

const TOOLS_CONFIG: Array<{ key: string; label: string; iconClass: string }> = [
    { key: 'web_search', label: 'Web Search', iconClass: 'icon-globe' },
    { key: 'subagents', label: 'Subagents', iconClass: 'icon-engineering-manager' }
];
const DEFAULT_NODE_WIDTH = 150; // Fallback if DOM not ready
const DEFAULT_MODEL_OPTIONS = ['gpt-5', 'gpt-5-mini', 'gpt-5.1'];
const DEFAULT_MODEL_EFFORTS: Record<string, string[]> = {
    'gpt-5': ['low', 'medium', 'high'],
    'gpt-5-mini': ['low', 'medium', 'high'],
    'gpt-5.1': ['none', 'low', 'medium', 'high']
};
const IF_CONDITION_HANDLE_PREFIX = 'condition-';
const IF_FALLBACK_HANDLE = 'false';
const SUBAGENT_HANDLE = 'subagent';
const SUBAGENT_TARGET_HANDLE = 'subagent-target';
const IF_PORT_BASE_TOP = 45;
const IF_PORT_STEP = 30;
const SUBAGENT_PORT_MIN_TOP = 42;
const DEFAULT_HEADER_CENTER_Y = 24;
const DEFAULT_SECONDARY_CENTER_Y = 81;
const PORT_RADIUS = 6;
const AGGREGATE_PORT_RADIUS = 8;
const PREVIOUS_OUTPUT_TEMPLATE = '{{PREVIOUS_OUTPUT}}';
const GENERIC_AGENT_SPINNER_KEY = '__generic_agent_spinner__';
const IF_CONDITION_OPERATORS = [
    { value: 'equal', label: 'Equal' },
    { value: 'contains', label: 'Contains' }
];
const DEFAULT_IF_CONDITION: IfCondition = { operator: 'equal', value: '' };

type WorkflowState = 'idle' | 'running' | 'paused';

type Point = {
    x: number;
    y: number;
};

type Viewport = Point & {
    scale: number;
};

type IfConditionOperator = 'equal' | 'contains';

type IfCondition = {
    operator: IfConditionOperator;
    value: string;
};

type WorkflowNodeData = {
    collapsed?: boolean;
    initialInput?: string;
    agentName?: string;
    systemPrompt?: string;
    userPrompt?: string;
    model?: string;
    reasoningEffort?: string;
    tools?: Record<string, boolean>;
    prompt?: string;
    condition?: string;
    conditions?: IfCondition[];
    [key: string]: unknown;
};

type EditorNode = WorkflowNode<WorkflowNodeData>;

type ConnectionStart = {
    nodeId: string;
    handle: string;
    x: number;
    y: number;
};

type ApprovalRequest = {
    nodeId: string;
    container: HTMLElement;
    approveBtn: HTMLButtonElement;
    rejectBtn: HTMLButtonElement;
};

type RunHistoryEntry = {
    role: string;
    content: string;
};

type SubagentRuntimeLogPayload = {
    parentNodeId?: string;
    subagentNodeId: string;
    subagentName: string;
    callId: string;
    parentCallId?: string;
    depth: number;
    message?: string;
};

type SubagentCallStatus = 'running' | 'completed' | 'failed';

type DropdownItem = {
    value: string;
    label: string;
};

type DropdownConfig = {
    placeholder: string;
    items: DropdownItem[];
    selectedValue: string;
    width: string;
    onSelect: (value: string) => void;
};

type DropdownInstance = {
    destroy?: () => void;
};

type DropdownCtor = new (container: HTMLElement, config: DropdownConfig) => DropdownInstance;

type SplitPanelInstance = {
    getLeftPanel: () => HTMLElement;
    getRightPanel: () => HTMLElement;
};

type SplitPanelCtor = new (
    container: Element,
    options: { initialSplit: number; minLeft: number; minRight: number }
) => SplitPanelInstance;

type ModalInstance = {
    open: () => void;
    close: () => void;
    destroy: () => void;
};

type ModalFooterButton = {
    label: string;
    type: 'primary' | 'secondary';
    onClick: (_event: Event, instance: ModalInstance) => void;
};

type ModalCtor = new (options: {
    size: 'small' | 'medium' | 'large';
    title: string;
    content: HTMLElement;
    footerButtons: ModalFooterButton[];
    onClose: () => void;
}) => ModalInstance;

type WorkflowGraphInput = {
    nodes?: EditorNode[];
    connections?: WorkflowConnection[];
};

type WorkflowGraphPayload = {
    nodes: EditorNode[];
    connections: WorkflowConnection[];
};

export class WorkflowEditor {
    private modelOptions: string[];

    private modelEfforts: Record<string, string[]>;

    private nodes: EditorNode[];

    private connections: WorkflowConnection[];

    private nextNodeId: number;

    private selectedNodeId: string | null;

    private isDragging: boolean;

    private dragOffsetWorld: Point;

    private viewport: Viewport;

    private isPanning: boolean;

    private panStart: Point;

    private viewportStart: Point;

    private tempConnection: SVGPathElement | null;

    private connectionStart: ConnectionStart | null;

    private reconnectingConnection: number | null;

    private canvas: HTMLElement | null;

    private canvasStage: HTMLElement | null;

    private nodesLayer: HTMLElement | null;

    private connectionsLayer: SVGSVGElement | HTMLElement | null;

    private chatMessages: HTMLElement | null;

    private initialPrompt: HTMLInputElement | HTMLTextAreaElement | null;

    private runButton: HTMLButtonElement | null;

    private cancelRunButton: HTMLButtonElement | null;

    private clearButton: HTMLButtonElement | null;

    private zoomValue: HTMLElement | null;

    private canvasValidationMessage: HTMLElement | null;

    private canvasValidationTimeout: ReturnType<typeof setTimeout> | null;

    private pendingLayoutSyncFrame: number | null;

    private workflowState: WorkflowState;

    private rightPanel: HTMLElement | null;

    private pendingAgentMessages: Map<string, HTMLElement>;

    private pendingAgentMessageCounts: Map<string, number>;

    private subagentCallElements: Map<string, HTMLElement>;

    private subagentCallSpinnerKeys: Map<string, string>;

    private spinnerSubagentCallIds: Map<string, Set<string>>;

    private subagentCallStatuses: Map<string, SubagentCallStatus>;

    private currentPrompt: string;

    private pendingApprovalRequest: ApprovalRequest | null;

    private activeRunController: AbortController | null;

    private lastLlmResponseContent: string | null;

    private splitPanelCtorPromise: Promise<SplitPanelCtor> | null;

    private dropdownCtorPromise: Promise<DropdownCtor> | null;

    private modalCtorPromise: Promise<ModalCtor> | null;

    private stateReady: boolean;

    private saveTimer: ReturnType<typeof setTimeout> | null;

    private pollTimer: ReturnType<typeof setTimeout> | null;

    private splitPanel: SplitPanelInstance | null;

    private currentRunId: string | null;

    private activeRunGraph: WorkflowGraphPayload | null;

    private runHistory: RunHistoryEntry[];

    private getErrorMessage(error: unknown): string {
        if (error instanceof Error) return error.message;
        return String(error);
    }

    private isValidGraphInput(value: unknown): value is WorkflowGraphPayload {
        if (!value || typeof value !== 'object') return false;
        const graph = value as { nodes?: unknown; connections?: unknown };
        if (!Array.isArray(graph.nodes) || !Array.isArray(graph.connections)) return false;
        return graph.nodes.every((node) => {
            if (!node || typeof node !== 'object') return false;
            const candidate = node as { id?: unknown; type?: unknown };
            return typeof candidate.id === 'string' && typeof candidate.type === 'string';
        });
    }

    private cloneGraphPayload(graph: WorkflowGraphPayload): WorkflowGraphPayload {
        return JSON.parse(JSON.stringify(graph)) as WorkflowGraphPayload;
    }

    private setActiveRunGraph(graph: WorkflowGraphPayload | null): void {
        this.activeRunGraph = graph ? this.cloneGraphPayload(graph) : null;
    }

    private syncActiveRunGraphFromResult(result: WorkflowRunResult): void {
        const workflow: WorkflowGraph | undefined = result.workflow;
        if (!workflow || !Array.isArray(workflow.nodes) || !Array.isArray(workflow.connections)) return;
        this.setActiveRunGraph({
            nodes: workflow.nodes as EditorNode[],
            connections: workflow.connections
        });
    }

    private getRunNodes(): EditorNode[] {
        return this.activeRunGraph?.nodes ?? this.nodes;
    }

    private getRunConnections(): WorkflowConnection[] {
        return this.activeRunGraph?.connections ?? this.connections;
    }

    private getRunNodeById(nodeId: string | null | undefined): EditorNode | undefined {
        if (!nodeId) return undefined;
        return this.getRunNodes().find((node) => node.id === nodeId);
    }

    constructor() {
        this.modelOptions = [...DEFAULT_MODEL_OPTIONS];
        this.modelEfforts = { ...DEFAULT_MODEL_EFFORTS };
        this.nodes = [];
        this.connections = [];
        this.nextNodeId = 1;
        this.selectedNodeId = null;
        this.isDragging = false;
        this.dragOffsetWorld = { x: 0, y: 0 };
        this.viewport = { x: 0, y: 0, scale: 1 };
        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };
        this.viewportStart = { x: 0, y: 0 };
        
        // Connection state
        this.tempConnection = null;
        this.connectionStart = null;
        this.reconnectingConnection = null; // Store the original connection data when reconnecting

        // DOM Elements
        this.canvas = document.getElementById('canvas-container');
        this.canvasStage = document.getElementById('canvas-stage');
        this.nodesLayer = document.getElementById('nodes-layer');
        this.connectionsLayer = document.getElementById('connections-layer');
        this.chatMessages = document.getElementById('chat-messages');
        this.initialPrompt = document.getElementById('initial-prompt') as HTMLInputElement | HTMLTextAreaElement | null;
        this.runButton = document.getElementById('btn-run') as HTMLButtonElement | null;
        this.cancelRunButton = document.getElementById('btn-cancel-run') as HTMLButtonElement | null;
        this.clearButton = document.getElementById('btn-clear') as HTMLButtonElement | null;
        this.zoomValue = document.getElementById('zoom-value');
        this.canvasValidationMessage = document.getElementById('canvas-validation-message');
        this.canvasValidationTimeout = null;
        this.pendingLayoutSyncFrame = null;
        this.workflowState = 'idle';
        this.rightPanel = document.getElementById('right-panel');
        this.pendingAgentMessages = new Map<string, HTMLElement>();
        this.pendingAgentMessageCounts = new Map<string, number>();
        this.subagentCallElements = new Map<string, HTMLElement>();
        this.subagentCallSpinnerKeys = new Map<string, string>();
        this.spinnerSubagentCallIds = new Map<string, Set<string>>();
        this.subagentCallStatuses = new Map<string, SubagentCallStatus>();
        this.currentPrompt = '';
        this.pendingApprovalRequest = null;
        this.activeRunController = null;
        this.lastLlmResponseContent = null;
        this.currentRunId = null;
        this.activeRunGraph = null;
        this.runHistory = [];

        this.splitPanelCtorPromise = null;
        this.dropdownCtorPromise = null;
        this.modalCtorPromise = null;
        this.splitPanel = null;
        this.stateReady = false;
        this.saveTimer = null;
        this.pollTimer = null;
        this.initSplitPanelLayout();

        // Bindings
        this.initDragAndDrop();
        this.initCanvasInteractions();
        this.initButtons();
        
        // WebSocket for Logs
        this.initWebSocket();

        this.applyViewport();
        this.updateRunButton();
        this.addDefaultStartNode();
        this.upgradeLegacyNodes(true);
        this.loadConfig().then(async () => {
            await this.loadInitialWorkflow();
            this.stateReady = true;
            this.saveWorkflowState();
            await this.recoverRun();
        }).catch((err: unknown) => {
            console.error('Workflow editor initialization failed', this.getErrorMessage(err));
        });

        window.addEventListener('beforeunload', () => {
            if (this.stateReady) {
                if (this.saveTimer !== null) {
                    clearTimeout(this.saveTimer);
                    this.saveTimer = null;
                }
                this.saveWorkflowState();
            }
        });
    }

    async getDropdownCtor(): Promise<DropdownCtor> {
        if (!this.dropdownCtorPromise) {
            const origin = window.location.origin;
            const dropdownModulePath = `${origin}/design-system/components/dropdown/dropdown.js`;
            this.dropdownCtorPromise = import(/* @vite-ignore */ dropdownModulePath).then(
                (mod) => (mod as { default: DropdownCtor }).default
            );
        }
        return this.dropdownCtorPromise;
    }

    async getSplitPanelCtor(): Promise<SplitPanelCtor> {
        if (!this.splitPanelCtorPromise) {
            const origin = window.location.origin;
            const splitPanelModulePath = `${origin}/design-system/components/split-panel/split-panel.js`;
            this.splitPanelCtorPromise = import(/* @vite-ignore */ splitPanelModulePath).then(
                (mod) => (mod as { default: SplitPanelCtor }).default
            );
        }
        return this.splitPanelCtorPromise;
    }

    async getModalCtor(): Promise<ModalCtor> {
        if (!this.modalCtorPromise) {
            const origin = window.location.origin;
            const modalModulePath = `${origin}/design-system/components/modal/modal.js`;
            this.modalCtorPromise = import(/* @vite-ignore */ modalModulePath).then(
                (mod) => (mod as { default: ModalCtor }).default
            );
        }
        return this.modalCtorPromise;
    }

    async initSplitPanelLayout() {
        const mainLayout = document.querySelector('.main-layout');
        if (!mainLayout || !this.canvas || !this.rightPanel) return;

        const rightWidthVar = getComputedStyle(document.documentElement)
            .getPropertyValue('--right-sidebar-width')
            .trim();
        const rightWidth = Number.parseFloat(rightWidthVar) || 320;
        const containerWidth = mainLayout.getBoundingClientRect().width || window.innerWidth || 1280;
        const initialSplit = ((containerWidth - rightWidth) / containerWidth) * 100;
        const clampedSplit = Math.max(40, Math.min(80, initialSplit));

        try {
            const SplitPanelCtor = await this.getSplitPanelCtor();
            this.splitPanel = new SplitPanelCtor(mainLayout, {
                initialSplit: clampedSplit,
                minLeft: 40,
                minRight: 20
            });
            this.splitPanel.getLeftPanel().appendChild(this.canvas);
            this.splitPanel.getRightPanel().appendChild(this.rightPanel);

            // Canvas now has correct dimensions — reposition the Start node if it's
            // still the only node (i.e. no default-workflow.json was loaded yet or at all)
            const startNode = this.nodes.find((n) => n.type === 'start');
            if (startNode && this.nodes.length === 1) {
                const pos = this.getDefaultStartPosition();
                startNode.x = pos.x;
                startNode.y = pos.y;
                this.render();
            }
        } catch (error) {
            console.warn('Failed to initialize split panel layout', error);
        }
    }

    async setupDropdown(
        container: HTMLElement,
        items: DropdownItem[],
        selectedValue: string,
        placeholder: string,
        onSelect: (value: string) => void
    ): Promise<DropdownInstance> {
        const DropdownCtor = await this.getDropdownCtor();
        const dropdown = new DropdownCtor(container, {
            placeholder,
            items,
            selectedValue,
            width: '100%',
            onSelect
        });
        this.scheduleConnectionLayoutSync();
        return dropdown;
    }

    scheduleConnectionLayoutSync(): void {
        if (this.pendingLayoutSyncFrame !== null) return;
        this.pendingLayoutSyncFrame = window.requestAnimationFrame(() => {
            this.pendingLayoutSyncFrame = null;
            this.renderConnections(false);
        });
    }

    applyViewport() {
        if (this.canvasStage) {
            this.canvasStage.style.transform = `translate(${this.viewport.x}px, ${this.viewport.y}px) scale(${this.viewport.scale})`;
        }
        this.updateZoomValue();
    }

    updateZoomValue() {
        if (!this.zoomValue) return;
        this.zoomValue.textContent = `${Math.round(this.viewport.scale * 100)}%`;
    }

    screenToWorld(clientX: number, clientY: number): Point {
        if (!this.canvas) return { x: 0, y: 0 };
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (clientX - rect.left - this.viewport.x) / this.viewport.scale,
            y: (clientY - rect.top - this.viewport.y) / this.viewport.scale
        };
    }

    getPrimaryAgentName() {
        const agentNode = this.getRunNodes().find((n) => n.type === 'agent');
        if (agentNode && agentNode.data) {
            const name = (agentNode.data.agentName || '').trim();
            if (name) return name;
        }
        return 'Agent';
    }

    getNodeWidth(node: EditorNode | null | undefined): number {
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

    getUserPromptHighlightHTML(value: string): string {
        const escapedValue = escapeHtml(value || '');
        return escapedValue.replace(
            /\{\{PREVIOUS_OUTPUT\}\}/g,
            '<span class="prompt-highlight-token">{{PREVIOUS_OUTPUT}}</span>',
        );
    }

    normalizeIfCondition(condition: unknown): IfCondition {
        const asRecord = (typeof condition === 'object' && condition !== null) ? condition as Partial<IfCondition> : undefined;
        const candidateOperator = asRecord?.operator;
        const rawValue = asRecord?.value;
        return {
            operator: candidateOperator === 'contains' ? 'contains' : 'equal',
            value: typeof rawValue === 'string' ? rawValue : ''
        };
    }

    getIfConditionHandle(index: number): string {
        return `${IF_CONDITION_HANDLE_PREFIX}${index}`;
    }

    getIfConditionIndexFromHandle(handle: string | undefined): number | null {
        if (handle === 'true') return 0;
        if (typeof handle !== 'string' || !handle.startsWith(IF_CONDITION_HANDLE_PREFIX)) return null;
        const parsedIndex = Number.parseInt(handle.slice(IF_CONDITION_HANDLE_PREFIX.length), 10);
        return Number.isInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : null;
    }

    isSubagentConnection(connection: WorkflowConnection): boolean {
        return connection.sourceHandle === SUBAGENT_HANDLE;
    }

    getSubagentConnections(connections: WorkflowConnection[] = this.connections): WorkflowConnection[] {
        return connections.filter((connection) => this.isSubagentConnection(connection));
    }

    getExecutionConnections(connections: WorkflowConnection[] = this.connections): WorkflowConnection[] {
        return connections.filter((connection) => !this.isSubagentConnection(connection));
    }

    isSubagentTargetNode(nodeId: string, connections: WorkflowConnection[] = this.connections): boolean {
        return connections.some(
            (connection) =>
                this.isSubagentConnection(connection) &&
                connection.target === nodeId
        );
    }

    getSubagentTargetIds(connections: WorkflowConnection[] = this.connections): Set<string> {
        const targetIds = new Set<string>();
        this.getSubagentConnections(connections).forEach((connection) => {
            targetIds.add(connection.target);
        });
        return targetIds;
    }

    canNodeBecomeSubagentTarget(
        nodeId: string,
        connections: WorkflowConnection[] = this.connections
    ): boolean {
        const targetNode = this.nodes.find((node) => node.id === nodeId);
        if (!targetNode || targetNode.type !== 'agent') {
            return false;
        }

        if (this.isSubagentTargetNode(nodeId, connections)) {
            return false;
        }

        const candidateParents = this.nodes.filter(
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
                targetHandle: 'input'
            };
            return !this.getConnectionValidationError(candidateConnection, connections);
        });
    }

    getSubagentPortTop(node: EditorNode): number {
        const nodeEl = document.getElementById(node.id);
        const height = nodeEl?.offsetHeight ?? (node.data?.collapsed ? 96 : 220);
        return Math.max(SUBAGENT_PORT_MIN_TOP, height - 6);
    }

    getConnectionStartPoint(sourceNode: EditorNode, sourceHandle?: string): Point {
        if (sourceHandle === SUBAGENT_HANDLE) {
            return {
                x: sourceNode.x + (this.getNodeWidth(sourceNode) / 2),
                y: sourceNode.y + this.getSubagentPortTop(sourceNode) + 6
            };
        }
        return {
            x: sourceNode.x + this.getNodeWidth(sourceNode),
            y: sourceNode.y + this.getOutputPortCenterYOffset(sourceNode, sourceHandle)
        };
    }

    getConnectionEndPoint(targetNode: EditorNode, sourceHandle?: string): Point {
        if (sourceHandle === SUBAGENT_HANDLE) {
            return {
                x: targetNode.x + (this.getNodeWidth(targetNode) / 2),
                y: targetNode.y
            };
        }
        return {
            x: targetNode.x,
            y: targetNode.y + this.getNodeHeaderCenterYOffset(targetNode)
        };
    }

    getSubagentGraphValidationError(connections: WorkflowConnection[] = this.connections): string | null {
        const subagentConnections = this.getSubagentConnections(connections);
        if (subagentConnections.length === 0) {
            return null;
        }

        const nodeById = new Map(this.nodes.map((node) => [node.id, node]));
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
            if (connection.targetHandle && connection.targetHandle !== 'input') {
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

        const executionConnections = this.getExecutionConnections(connections);
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
                const cycleStart = path.indexOf(nodeId);
                const cyclePath = [...path.slice(cycleStart), nodeId].join(' -> ');
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

    getConnectionValidationError(
        nextConnection: WorkflowConnection,
        connections: WorkflowConnection[] = this.connections
    ): string | null {
        const sourceNode = this.nodes.find((node) => node.id === nextConnection.source);
        const targetNode = this.nodes.find((node) => node.id === nextConnection.target);
        if (!sourceNode || !targetNode) {
            return 'Connection source or target node is missing.';
        }

        const candidateConnections = [...connections, nextConnection];
        const nextIsSubagentConnection = this.isSubagentConnection(nextConnection);

        if (nextIsSubagentConnection) {
            if (sourceNode.type !== 'agent') {
                return 'Only agent nodes can define subagents.';
            }
            if (!sourceNode.data?.tools || !sourceNode.data.tools.subagents) {
                return 'Enable Subagents on the parent agent before adding subagent links.';
            }
            if (targetNode.type !== 'agent') {
                return 'Subagent links can only target agent nodes.';
            }
            if (nextConnection.targetHandle !== 'input') {
                return 'Subagent links must connect to the target input handle.';
            }
            if (nextConnection.source === nextConnection.target) {
                return 'An agent cannot be a subagent of itself.';
            }
        } else {
            if (this.isSubagentTargetNode(nextConnection.source, candidateConnections)) {
                return 'Subagent targets cannot be used as sources in regular workflow edges.';
            }
            if (this.isSubagentTargetNode(nextConnection.target, candidateConnections)) {
                return 'Subagent targets cannot be used as targets in regular workflow edges.';
            }
        }

        return this.getSubagentGraphValidationError(candidateConnections);
    }

    removeOutgoingSubagentConnections(sourceNodeId: string): boolean {
        const previousLength = this.connections.length;
        this.connections = this.connections.filter(
            (connection) =>
                !(
                    connection.source === sourceNodeId &&
                    this.isSubagentConnection(connection)
                )
        );
        return this.connections.length !== previousLength;
    }

    applyConnectionToTarget(targetNodeId: string, targetHandle: string): void {
        if (!this.connectionStart || this.connectionStart.nodeId === targetNodeId) {
            return;
        }

        const nextConnection: WorkflowConnection = {
            source: this.connectionStart.nodeId,
            target: targetNodeId,
            sourceHandle: this.connectionStart.handle,
            targetHandle
        };
        const connected = this.applyPendingConnection(nextConnection);

        if (connected) {
            this.reconnectingConnection = null;
            this.renderConnections();
        } else if (this.reconnectingConnection !== null) {
            this.reconnectingConnection = null;
            this.renderConnections();
        }

        this.clearPendingConnectionDragState();
        this.updateRunButton();
    }

    applyPendingConnection(nextConnection: WorkflowConnection): boolean {
        const duplicateExists = this.connections.some(
            (conn: WorkflowConnection) =>
                conn.source === nextConnection.source &&
                conn.target === nextConnection.target &&
                conn.sourceHandle === nextConnection.sourceHandle &&
                conn.targetHandle === nextConnection.targetHandle
        );
        if (duplicateExists) {
            return false;
        }

        const validationError = this.getConnectionValidationError(nextConnection);
        if (validationError) {
            this.setCanvasValidationMessage(validationError);
            return false;
        }

        this.setCanvasValidationMessage(null);
        this.connections.push(nextConnection);
        return true;
    }

    clearPendingConnectionDragState(): void {
        if (this.tempConnection) {
            this.tempConnection.remove();
        }
        this.connectionStart = null;
        this.tempConnection = null;
    }

    getIfPortTop(index: number): number {
        return IF_PORT_BASE_TOP + (index * IF_PORT_STEP);
    }

    getIfConditionPortTop(node: EditorNode, index: number): number {
        if (node.data?.collapsed) {
            return this.getNodeHeaderPortTop(node);
        }

        const nodeEl = document.getElementById(node.id);
        if (!nodeEl) {
            return this.getIfPortTop(index);
        }

        const conditionRows = Array.from(nodeEl.querySelectorAll('.condition-row')) as HTMLElement[];
        const row = conditionRows[index];
        if (!row) {
            return this.getIfPortTop(index);
        }

        return Math.round(row.offsetTop + (row.offsetHeight / 2) - 6);
    }

    getIfFallbackPortTop(node: EditorNode): number {
        const conditions = this.getIfConditions(node);
        if (node.data?.collapsed) {
            return this.getNodeSecondaryPortTop(node);
        }

        const nodeEl = document.getElementById(node.id);
        if (!nodeEl) {
            return this.getIfPortTop(conditions.length);
        }

        const conditionRows = Array.from(nodeEl.querySelectorAll('.condition-row')) as HTMLElement[];
        const addConditionButton = nodeEl.querySelector('.add-condition-btn') as HTMLElement | null;
        if (addConditionButton) {
            return Math.round(addConditionButton.offsetTop + (addConditionButton.offsetHeight / 2) - 6);
        }
        if (conditionRows.length === 0) {
            return this.getIfPortTop(conditions.length);
        }

        const lastRow = conditionRows[conditionRows.length - 1];
        const lastCenterTop = lastRow.offsetTop + (lastRow.offsetHeight / 2) - 6;
        const dynamicStep = conditionRows.length > 1
            ? conditionRows[conditionRows.length - 1].offsetTop - conditionRows[conditionRows.length - 2].offsetTop
            : IF_PORT_STEP;

        return Math.round(lastCenterTop + dynamicStep);
    }

    shouldAggregateCollapsedIfPorts(node: EditorNode): boolean {
        return node.type === 'if' && Boolean(node.data?.collapsed) && this.getIfConditions(node).length > 1;
    }

    refreshNodePorts(node: EditorNode): void {
        const el = document.getElementById(node.id);
        if (!el) return;
        el.querySelectorAll('.port').forEach((port) => port.remove());
        this.renderPorts(node, el);
    }

    getIfConditions(node: EditorNode): IfCondition[] {
        if (!node.data) node.data = {};
        if (!Array.isArray(node.data.conditions) || node.data.conditions.length === 0) {
            node.data.conditions = [{ ...DEFAULT_IF_CONDITION }];
        }
        node.data.conditions = node.data.conditions.map((condition) => this.normalizeIfCondition(condition));
        return node.data.conditions;
    }

    removeIfCondition(node: EditorNode, conditionIndex: number): void {
        const conditions = this.getIfConditions(node);
        if (conditions.length <= 1) return;
        if (!node.data) return;

        node.data.conditions = conditions.filter((_, index) => index !== conditionIndex);
        this.connections = this.connections.reduce<WorkflowConnection[]>((nextConnections, connection) => {
            if (connection.source !== node.id) {
                nextConnections.push(connection);
                return nextConnections;
            }

            const sourceIndex = this.getIfConditionIndexFromHandle(connection.sourceHandle);
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
                    sourceHandle: this.getIfConditionHandle(sourceIndex - 1)
                });
                return nextConnections;
            }

            nextConnections.push(connection);
            return nextConnections;
        }, []);
    }

    getOutputPortCenterYOffset(node: EditorNode, sourceHandle?: string): number {
        if (sourceHandle === SUBAGENT_HANDLE) {
            return this.getSubagentPortTop(node) + 6;
        }

        if (node.type === 'if') {
            if (this.shouldAggregateCollapsedIfPorts(node)) {
                if (sourceHandle === IF_FALLBACK_HANDLE) {
                    return this.getNodeSecondaryCenterYOffset(node);
                }
                const conditionIndex = this.getIfConditionIndexFromHandle(sourceHandle);
                if (conditionIndex !== null) {
                    return this.getNodeHeaderCenterYOffset(node);
                }
            }
            if (sourceHandle === IF_FALLBACK_HANDLE) {
                return this.getIfFallbackPortTop(node) + 6;
            }
            const conditionIndex = this.getIfConditionIndexFromHandle(sourceHandle);
            if (conditionIndex !== null) {
                return this.getIfConditionPortTop(node, conditionIndex) + 6;
            }
        }

        if (sourceHandle === 'approve') return this.getNodeHeaderCenterYOffset(node);
        if (sourceHandle === 'reject') return this.getNodeSecondaryCenterYOffset(node);
        return this.getNodeHeaderCenterYOffset(node);
    }

    getNodeHeaderCenterYOffset(node: EditorNode): number {
        const nodeEl = document.getElementById(node.id);
        const headerEl = nodeEl?.querySelector('.node-header');
        if (!(headerEl instanceof HTMLElement)) return DEFAULT_HEADER_CENTER_Y;
        return Math.round(headerEl.offsetTop + (headerEl.offsetHeight / 2));
    }

    getNodeHeaderPortTop(node: EditorNode): number {
        return this.getNodeHeaderCenterYOffset(node) - PORT_RADIUS;
    }

    getNodeSecondaryCenterYOffset(node: EditorNode): number {
        const nodeEl = document.getElementById(node.id);
        const headerEl = nodeEl?.querySelector('.node-header');
        if (!(nodeEl instanceof HTMLElement) || !(headerEl instanceof HTMLElement)) {
            return DEFAULT_SECONDARY_CENTER_Y;
        }
        const bodyTop = headerEl.offsetTop + headerEl.offsetHeight;
        const bodyHeight = Math.max(nodeEl.offsetHeight - bodyTop, PORT_RADIUS * 2);
        return Math.round(bodyTop + (bodyHeight / 2));
    }

    getNodeSecondaryPortTop(node: EditorNode): number {
        return this.getNodeSecondaryCenterYOffset(node) - PORT_RADIUS;
    }

    setWorkflowState(state: WorkflowState): void {
        this.workflowState = state;
        this.updateRunButton();
    }

    setRunButtonHint(reason: string | null): void {
        if (!this.runButton) return;
        if (reason) {
            this.runButton.setAttribute('data-disabled-hint', reason);
        } else {
            this.runButton.removeAttribute('data-disabled-hint');
        }
    }

    setClearButtonHint(reason: string | null): void {
        if (!this.clearButton) return;
        if (reason) {
            this.clearButton.setAttribute('data-disabled-hint', reason);
        } else {
            this.clearButton.removeAttribute('data-disabled-hint');
        }
    }

    setCancelRunButtonHint(reason: string | null): void {
        if (!this.cancelRunButton) return;
        if (reason) {
            this.cancelRunButton.setAttribute('data-tooltip', reason);
        } else {
            this.cancelRunButton.removeAttribute('data-tooltip');
        }
    }

    setCanvasValidationMessage(message: string | null): void {
        if (this.canvasValidationTimeout !== null) {
            clearTimeout(this.canvasValidationTimeout);
            this.canvasValidationTimeout = null;
        }
        if (!this.canvasValidationMessage) return;
        if (!message) {
            this.canvasValidationMessage.textContent = '';
            this.canvasValidationMessage.classList.remove('visible');
            return;
        }
        this.canvasValidationMessage.textContent = message;
        this.canvasValidationMessage.classList.add('visible');
        this.canvasValidationTimeout = setTimeout(() => {
            if (!this.canvasValidationMessage) return;
            this.canvasValidationMessage.textContent = '';
            this.canvasValidationMessage.classList.remove('visible');
            this.canvasValidationTimeout = null;
        }, 4500);
    }

    isAbortError(error: unknown): boolean {
        if (!error) return false;
        if (error instanceof Error && error.name === 'AbortError') return true;
        const message = error instanceof Error ? error.message : '';
        return message.toLowerCase().includes('aborted');
    }

    cancelRunningWorkflow() {
        this.clearRunId();
        if (this.activeRunController) {
            this.activeRunController.abort();
            this.activeRunController = null;
        }
        if (this.workflowState === 'running') {
            this.hideAgentSpinner();
            this.clearApprovalMessage();
            this.appendStatusMessage('Cancelled');
            this.currentRunId = null;
            this.setActiveRunGraph(null);
            this.setWorkflowState('idle');
        }
    }

    getRunDisableReason() {
        const startNodes = this.nodes.filter((node: any) => node.type === 'start');
        if (startNodes.length === 0) {
            return 'Add a Start node to run the workflow.';
        }
        if (startNodes.length > 1) {
            return 'Use only one Start node before running.';
        }

        const nodeIdSet = new Set(this.nodes.map((node: any) => node.id));
        const hasBrokenConnection = this.connections.some(
            (conn: any) => !nodeIdSet.has(conn.source) || !nodeIdSet.has(conn.target)
        );
        if (hasBrokenConnection) {
            return 'Fix broken connections before running.';
        }

        const subagentGraphError = this.getSubagentGraphValidationError();
        if (subagentGraphError) {
            return subagentGraphError;
        }

        const startNode = startNodes[0];
        const executionConnections = this.getExecutionConnections();
        const adjacency = new Map();
        executionConnections.forEach((conn: any) => {
            if (!adjacency.has(conn.source)) adjacency.set(conn.source, []);
            adjacency.get(conn.source).push(conn);
        });

        const startConnections = adjacency.get(startNode.id) || [];
        if (startConnections.length === 0) {
            return 'Connect Start to another node before running.';
        }

        const reachable = new Set([startNode.id]);
        const queue = [startNode.id];
        while (queue.length > 0) {
            const nodeId = queue.shift();
            const next = adjacency.get(nodeId) || [];
            next.forEach((conn: any) => {
                if (!reachable.has(conn.target)) {
                    reachable.add(conn.target);
                    queue.push(conn.target);
                }
            });
        }

        if (reachable.size <= 1) {
            return 'Add and connect at least one node after Start.';
        }

        for (const node of this.nodes) {
            if (!reachable.has(node.id)) continue;
            if (node.type === 'if') {
                const outgoing = adjacency.get(node.id) || [];
                const hasConditionBranch = outgoing.some((conn: any) => this.getIfConditionIndexFromHandle(conn.sourceHandle) !== null);
                const hasFallbackBranch = outgoing.some((conn: any) => conn.sourceHandle === IF_FALLBACK_HANDLE);
                if (!hasConditionBranch && !hasFallbackBranch) {
                    return 'Connect at least one branch for each Condition node.';
                }
            }
            if (node.type === 'approval' || node.type === 'input') {
                const outgoing = adjacency.get(node.id) || [];
                const hasApprove = outgoing.some((conn: any) => conn.sourceHandle === 'approve');
                const hasReject = outgoing.some((conn: any) => conn.sourceHandle === 'reject');
                if (!hasApprove && !hasReject) {
                    return 'Connect at least one branch for each approval node.';
                }
            }
        }

        return null;
    }

    getClearDisableReason(): string | null {
        if (this.workflowState === 'running') {
            return 'Cannot clear canvas while workflow is running.';
        }
        if (this.workflowState === 'paused') {
            return 'Cannot clear canvas while workflow is paused waiting for approval.';
        }
        return null;
    }

    updateRunButton() {
        if (!this.runButton) return;
        if (this.cancelRunButton) {
            const showCancel = this.workflowState === 'running';
            this.cancelRunButton.style.display = showCancel ? 'inline-flex' : 'none';
            this.cancelRunButton.disabled = !showCancel;
            this.setCancelRunButtonHint(showCancel ? 'Cancel workflow' : null);
        }

        if (this.clearButton) {
            const clearDisabledReason = this.getClearDisableReason();
            this.clearButton.disabled = Boolean(clearDisabledReason);
            this.setClearButtonHint(clearDisabledReason);
        }
        
        switch (this.workflowState) {
            case 'running':
                this.runButton.textContent = 'Running...';
                this.runButton.disabled = true;
                this.setRunButtonHint('Workflow is currently running.');
                break;
            case 'paused':
                this.runButton.textContent = 'Paused';
                this.runButton.disabled = true;
                this.setRunButtonHint('Workflow is paused waiting for approval.');
                break;
            case 'idle':
            default:
                const disabledReason = this.getRunDisableReason();
                this.runButton.innerHTML = 'Run Workflow <span class="icon icon-rocket icon-small" aria-hidden="true"></span>';
                this.runButton.disabled = Boolean(disabledReason);
                this.setRunButtonHint(disabledReason);
                break;
        }
    }

    appendStatusMessage(text: any, type: any = '') {
        if (!this.chatMessages) return;
        const message = document.createElement('div');
        message.className = `chat-message status ${type}`;
        message.textContent = text;
        this.chatMessages.appendChild(message);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    logManualUserMessage(text: any) {
        this.appendChatMessage(text, 'user');
        if (!this.runHistory) this.runHistory = [];
        this.runHistory.push({ role: 'user', content: text });
    }

    clearSubagentSpinnerState(spinnerKey?: string): void {
        if (spinnerKey) {
            const callIds = this.spinnerSubagentCallIds.get(spinnerKey);
            if (callIds) {
                callIds.forEach((callId) => {
                    this.subagentCallElements.delete(callId);
                    this.subagentCallSpinnerKeys.delete(callId);
                    this.subagentCallStatuses.delete(callId);
                });
            }
            this.spinnerSubagentCallIds.delete(spinnerKey);
            return;
        }

        this.subagentCallElements.clear();
        this.subagentCallSpinnerKeys.clear();
        this.spinnerSubagentCallIds.clear();
        this.subagentCallStatuses.clear();
    }

    showAgentSpinner(name?: string, nodeId?: string) {
        if (!this.chatMessages) return;
        const spinnerKey = nodeId || GENERIC_AGENT_SPINNER_KEY;
        const currentCount = this.pendingAgentMessageCounts.get(spinnerKey) ?? 0;
        this.pendingAgentMessageCounts.set(spinnerKey, currentCount + 1);
        if (currentCount > 0 && this.pendingAgentMessages.has(spinnerKey)) return;
        const resolvedName = name || this.getPrimaryAgentName();
        const spinner = document.createElement('div');
        spinner.className = 'chat-message agent spinner';
        const label = document.createElement('span');
        label.className = 'chat-message-label';
        label.textContent = resolvedName;
        spinner.appendChild(label);
        const body = document.createElement('div');
        body.className = 'chat-spinner-row';
        const text = document.createElement('span');
        text.className = 'chat-spinner-text';
        text.textContent = `${resolvedName} is working`;
        const dots = document.createElement('span');
        dots.className = 'chat-spinner';
        dots.innerHTML = '<span></span><span></span><span></span>';
        body.appendChild(text);
        body.appendChild(dots);
        spinner.appendChild(body);

        this.chatMessages.appendChild(spinner);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        this.pendingAgentMessages.set(spinnerKey, spinner);
    }

    hideAgentSpinner(nodeId?: string) {
        if (nodeId) {
            const currentCount = this.pendingAgentMessageCounts.get(nodeId) ?? 0;
            if (currentCount > 1) {
                this.pendingAgentMessageCounts.set(nodeId, currentCount - 1);
                return;
            }
            this.pendingAgentMessageCounts.delete(nodeId);
            const spinner = this.pendingAgentMessages.get(nodeId);
            if (!spinner) return;
            spinner.remove();
            this.pendingAgentMessages.delete(nodeId);
            this.clearSubagentSpinnerState(nodeId);
            return;
        }

        this.pendingAgentMessages.forEach((spinner) => spinner.remove());
        this.pendingAgentMessages.clear();
        this.pendingAgentMessageCounts.clear();
        this.clearSubagentSpinnerState();
    }

    zoomCanvas(stepPercent: any) {
        if (!this.canvas) return;
        const snappedScale = Math.round(this.viewport.scale * 10) / 10;
        const delta = stepPercent / 100;
        const newScale = Math.min(2, Math.max(0.5, snappedScale + delta));
        if (newScale === this.viewport.scale) return;
        const rect = this.canvas.getBoundingClientRect();
        const screenX = rect.width / 2;
        const screenY = rect.height / 2;
        const worldX = (screenX - this.viewport.x) / this.viewport.scale;
        const worldY = (screenY - this.viewport.y) / this.viewport.scale;
        this.viewport.scale = newScale;
        this.viewport.x = screenX - worldX * this.viewport.scale;
        this.viewport.y = screenY - worldY * this.viewport.scale;
        this.applyViewport();
    }

    // --- INITIALIZATION ---

    initDragAndDrop() {
        const draggables = document.querySelectorAll('.draggable-node');
        draggables.forEach((el: any) => {
            el.addEventListener('dragstart', (e: any) => {
                e.dataTransfer.setData('type', el.dataset.type);
            });
        });

        if (!this.canvas) return;
        this.canvas.addEventListener('dragover', (e: any) => e.preventDefault());
        this.canvas.addEventListener('drop', (e: any) => {
            e.preventDefault();
            const type = e.dataTransfer.getData('type');
            const worldPos = this.screenToWorld(e.clientX, e.clientY);
            this.addNode(type, worldPos.x, worldPos.y);
        });
    }

    initCanvasInteractions() {
        if (this.canvas) {
            const canvas = this.canvas;
            this.canvas.addEventListener('mousedown', (e: any) => {
                const isHint = e.target.classList && e.target.classList.contains('canvas-hint');
                const isBackground = e.target === canvas ||
                    e.target === this.canvasStage ||
                    e.target === this.connectionsLayer ||
                    e.target === this.nodesLayer ||
                    isHint;
                if (isBackground) {
                    e.preventDefault();
                    this.isPanning = true;
                    canvas.classList.add('panning');
                    this.panStart = { x: e.clientX, y: e.clientY };
                    this.viewportStart = { ...this.viewport };
                }
            });
        }

        document.addEventListener('mousemove', (e: any) => {
            if (this.isPanning) {
                this.viewport.x = this.viewportStart.x + (e.clientX - this.panStart.x);
                this.viewport.y = this.viewportStart.y + (e.clientY - this.panStart.y);
                this.applyViewport();
                return;
            }

            if (this.isDragging && this.selectedNodeId) {
                if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

                const node = this.nodes.find((n: any) => n.id === this.selectedNodeId);
                if (node) {
                    const pointer = this.screenToWorld(e.clientX, e.clientY);
                    node.x = pointer.x - this.dragOffsetWorld.x;
                    node.y = pointer.y - this.dragOffsetWorld.y;
                    this.renderNodePosition(node);
                    this.renderConnections();
                }
            }
            
            if (this.tempConnection) {
                this.updateTempConnection(e);
            }
        });

        document.addEventListener('mouseup', (e: any) => {
            if (this.isPanning) {
                this.isPanning = false;
                if (this.canvas) {
                    this.canvas.classList.remove('panning');
                }
            }
            this.isDragging = false;
            
            // Handle reconnection cleanup if released without connecting to a port
            if (this.tempConnection && this.reconnectingConnection !== null) {
                // Check if we're over a port - if not, connection already deleted, just clean up
                const targetPort = e.target.closest('.port');
                if (!targetPort) {
                    // Connection was already removed when we started reconnecting, just render
                    this.renderConnections();
                    this.reconnectingConnection = null;
                    this.clearPendingConnectionDragState();
                }
                // Clean up will happen in onPortMouseUp if we connected
            } else if (this.tempConnection && this.reconnectingConnection === null) {
                // Normal connection creation cancelled
                this.clearPendingConnectionDragState();
            }
        });
    }

    initButtons() {
        if (this.runButton) {
            this.runButton.addEventListener('click', () => this.runWorkflow());
        }
        const cancelRunBtn = document.getElementById('btn-cancel-run');
        if (cancelRunBtn) {
            cancelRunBtn.addEventListener('click', () => this.cancelRunningWorkflow());
        }
        if (this.clearButton) {
            this.clearButton.addEventListener('click', async () => {
                if (this.workflowState !== 'idle') return;
                const confirmed = await this.openConfirmModal({
                    title: 'Clear Canvas',
                    message: 'Remove all nodes and connections from the canvas?',
                    confirmLabel: 'Clear',
                    cancelLabel: 'Keep'
                });
                if(!confirmed) return;
                this.nodes = [];
                this.connections = [];
                this.render();
                this.addDefaultStartNode();
                this.currentPrompt = '';
                this.currentRunId = null;
                this.clearRunId();
                if (this.chatMessages) {
                    this.chatMessages.innerHTML = '<div class="chat-message system">Canvas cleared. Start building your next workflow.</div>';
                }
                this.setWorkflowState('idle');
            });
        }

        const zoomInBtn = document.getElementById('btn-zoom-in');
        const zoomOutBtn = document.getElementById('btn-zoom-out');
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.zoomCanvas(10));
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.zoomCanvas(-10));
    }

    initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}`);
        ws.onmessage = (_event: any) => {
            // Placeholder for future real-time feedback
        };
    }

    async openConfirmModal(options: any = {}) {
        const {
            title = 'Confirm',
            message = 'Are you sure?',
            confirmLabel = 'Confirm',
            cancelLabel = 'Cancel'
        } = options;

        try {
            const ModalCtor = await this.getModalCtor();
            const content = document.createElement('p');
            content.textContent = message;

            return await new Promise<boolean>((resolve) => {
                let confirmed = false;

                const modal = new ModalCtor({
                    size: 'small',
                    title,
                    content,
                    footerButtons: [
                        {
                            label: cancelLabel,
                            type: 'secondary',
                            onClick: (_event: any, instance: any) => instance.close()
                        },
                        {
                            label: confirmLabel,
                            type: 'primary',
                            onClick: (_event: any, instance: any) => {
                                confirmed = true;
                                instance.close();
                            }
                        }
                    ],
                    onClose: () => {
                        modal.destroy();
                        resolve(confirmed);
                    }
                });

                modal.open();
            });
        } catch (error) {
            console.warn('Failed to initialize DS confirm modal', error);
            return window.confirm(message);
        }
    }

    // --- NODE MANAGEMENT ---

    addNode(type: string, x: number, y: number): void {
        const normalizedType = type === 'input' ? 'approval' : type;
        const node: EditorNode = {
            id: `node_${this.nextNodeId++}`,
            type: normalizedType,
            x,
            y,
            data: this.getDefaultData(normalizedType) as WorkflowNodeData
        };
        this.nodes.push(node);
        this.scheduleSave();
        this.renderNode(node);
        this.updateRunButton();
    }

    upgradeLegacyNodes(shouldRender: boolean = false) {
        let updated = false;
        const ifNodeIds = new Set();
        this.nodes.forEach((node) => {
            if (node.type === 'input') {
                node.type = 'approval';
                if (node.data && node.data.prompt === undefined) {
                    node.data.prompt = 'Review and approve this step.';
                }
                updated = true;
            }

            if (node.type === 'agent') {
                if (!node.data) node.data = {};
                const tools = (node.data.tools && typeof node.data.tools === 'object')
                    ? node.data.tools as Record<string, boolean>
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
                const rawLegacyCondition = typeof node.data.condition === 'string' ? node.data.condition : '';
                const rawConditions = Array.isArray(node.data.conditions) && node.data.conditions.length > 0
                    ? node.data.conditions
                    : [{ operator: 'contains', value: rawLegacyCondition }];
                node.data.conditions = rawConditions.map((condition) => this.normalizeIfCondition(condition));
                if (node.data.conditions.length === 0) {
                    node.data.conditions = [{ ...DEFAULT_IF_CONDITION }];
                }
                if ('condition' in node.data) {
                    delete node.data.condition;
                }
                updated = true;
            }
        });

        this.connections.forEach((connection) => {
            if (!ifNodeIds.has(connection.source)) return;
            if (connection.sourceHandle === 'true') {
                connection.sourceHandle = this.getIfConditionHandle(0);
                updated = true;
            }
        });

        if (updated && shouldRender) {
            this.render();
        } else if (updated) {
            this.updateRunButton();
        }
    }

    async loadConfig() {
        try {
            const cfg = await fetchConfig();
            const enabledProviders = (cfg.providers ?? []).filter((p: any) => p.enabled);
            if (enabledProviders.length === 0) return;
            const options: string[] = [];
            const efforts: Record<string, string[]> = {};
            for (const provider of enabledProviders) {
                for (const model of provider.models) {
                    options.push(model.id);
                    efforts[model.id] = model.reasoningEfforts;
                }
            }
            this.modelOptions = options;
            this.modelEfforts = efforts;
        } catch {
            // keep hardcoded defaults
        }
    }

    static get STORAGE_KEY() { return 'agentic-workflow'; }
    static get RUN_KEY() { return 'agentic-run-id'; }

    saveWorkflowState() {
        try {
            localStorage.setItem(
                WorkflowEditor.STORAGE_KEY,
                JSON.stringify({ nodes: this.nodes, connections: this.connections }),
            );
        } catch {
            // localStorage may be unavailable (private browsing quota, etc.) — fail silently
        }
    }

    scheduleSave() {
        if (!this.stateReady) return;
        if (this.saveTimer !== null) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.saveWorkflowState();
        }, 500);
    }

    saveRunId(runId: string) {
        try { localStorage.setItem(WorkflowEditor.RUN_KEY, runId); } catch { /* ignore */ }
    }

    clearRunId() {
        try { localStorage.removeItem(WorkflowEditor.RUN_KEY); } catch { /* ignore */ }
        if (this.pollTimer !== null) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    getStoredRunId() {
        try { return localStorage.getItem(WorkflowEditor.RUN_KEY); } catch { return null; }
    }

    async loadInitialWorkflow() {
        // 1. Try localStorage first — restores the canvas on refresh
        try {
            const raw = localStorage.getItem(WorkflowEditor.STORAGE_KEY);
            if (raw) {
                const graph = JSON.parse(raw) as unknown;
                if (this.isValidGraphInput(graph) && graph.nodes.length > 0) {
                    this.loadWorkflow(graph);
                    return; // localStorage wins — skip server fetch
                }
            }
        } catch {
            // corrupted storage — fall through to default workflow
        }

        // 2. Fall back to server default-workflow.json (first visit or after clear)
        await this.loadDefaultWorkflow();
    }

    async loadDefaultWorkflow() {
        try {
            const res = await fetch('/api/default-workflow');
            if (!res.ok) return;
            const graph = await res.json() as unknown;
            if (!this.isValidGraphInput(graph)) return;
            this.loadWorkflow(graph);
        } catch {
            // keep the default start node already rendered synchronously
        }
    }

    loadWorkflow(graph: WorkflowGraphInput) {
        this.nodes = graph.nodes ?? [];
        this.connections = graph.connections ?? [];
        const maxId = this.nodes.reduce((max, n) => {
            const num = parseInt(n.id.replace('node_', ''), 10);
            return isNaN(num) ? max : Math.max(max, num);
        }, 0);
        this.nextNodeId = maxId + 1;
        this.upgradeLegacyNodes();
        this.render();
    }

    addDefaultStartNode() {
        const startExists = this.nodes.some((n) => n.type === 'start');
        if (startExists) return;
        const { x, y } = this.getDefaultStartPosition();
        this.addNode('start', x, y);
    }

    getDefaultStartPosition() {
        const container = this.canvas;
        const fallback = { x: 370, y: 310 };
        if (!container) return fallback;
        const rect = container.getBoundingClientRect();
        if (!rect.width || !rect.height) return fallback;
        
        // Center the node accounting for approximate start node width and height
        const nodeWidth = 120; // Start node is narrow
        const nodeHeight = 60;
        const x = (rect.width / 2) - (nodeWidth / 2);
        const y = (rect.height / 2) - (nodeHeight / 2);
        return { x, y };
    }

    getDefaultData(type: any) {
        switch (type) {
            case 'agent': 
                return { 
                    agentName: 'Agent',
                    systemPrompt: 'You are a helpful assistant.', 
                    userPrompt: '{{PREVIOUS_OUTPUT}}',
                    model: 'gpt-5', 
                    reasoningEffort: 'low',
                    tools: { web_search: false, subagents: false },
                    collapsed: true
                };
            case 'if': 
                return {
                    conditions: [{ ...DEFAULT_IF_CONDITION }],
                    collapsed: true
                };
            case 'approval': 
                return { prompt: 'Review and approve this step.', collapsed: true };
            case 'start':
            case 'end':
                return { collapsed: true };
            default: 
                return { collapsed: true };
        }
    }

    nodeHasSettings(node: any) {
        if (!node) return false;
        return ['agent', 'if', 'approval'].includes(node.type);
    }

    deleteNode(id: string) {
        this.nodes = this.nodes.filter((n) => n.id !== id);
        this.connections = this.connections.filter((c) => c.source !== id && c.target !== id);
        this.render();
        this.updateRunButton();
    }

    duplicateAgentNode(sourceNode: EditorNode): void {
        if (sourceNode.type !== 'agent') return;
        const duplicatedData = sourceNode.data
            ? JSON.parse(JSON.stringify(sourceNode.data)) as WorkflowNodeData
            : {};
        duplicatedData.collapsed = true;

        const sourceEl = document.getElementById(sourceNode.id);
        const sourceHeight = sourceEl?.offsetHeight
            ?? (sourceNode.data?.collapsed ? 96 : 240);
        const duplicatedCollapsedHeight = 96;
        const duplicateSpacing = 24;
        const minWorldY = 16;
        const duplicateX = sourceNode.x;
        const proposedAboveY = sourceNode.y - duplicatedCollapsedHeight - duplicateSpacing;
        const duplicateY = proposedAboveY >= minWorldY
            ? proposedAboveY
            : sourceNode.y + sourceHeight + duplicateSpacing;

        const duplicatedNode: EditorNode = {
            id: `node_${this.nextNodeId++}`,
            type: 'agent',
            x: duplicateX,
            y: duplicateY,
            data: duplicatedData
        };

        this.nodes.push(duplicatedNode);
        this.renderNode(duplicatedNode);
        this.selectNode(duplicatedNode.id);
        this.scheduleSave();
        this.updateRunButton();
    }

    // --- RENDERING ---

    render() {
        if (!this.nodesLayer || !this.connectionsLayer) return;
        this.nodesLayer.innerHTML = '';
        this.connectionsLayer.innerHTML = '';
        this.nodes.forEach((n) => this.renderNode(n));
        this.renderConnections(); // renderConnections() already calls scheduleSave()
        this.updateRunButton();
    }

    renderNode(node: any) {
        const el = document.createElement('div');
        el.className = `node box card shadowed ${node.type === 'start' ? 'start-node' : ''}`;
        el.id = node.id;
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
        el.dataset.nodeId = node.id;
        const isSubagentTarget = node.type === 'agent' && this.isSubagentTargetNode(node.id);
        const isSubagentCandidate =
            node.type === 'agent' &&
            (isSubagentTarget || this.canNodeBecomeSubagentTarget(node.id));
        el.classList.toggle('subagent-target-node', isSubagentTarget);
        el.classList.toggle('subagent-candidate-node', isSubagentCandidate);

        if (!node.data) node.data = {};
        if (node.data.collapsed === undefined) {
            node.data.collapsed = node.type === 'start' || node.type === 'end';
        }
        const hasSettings = this.nodeHasSettings(node);
        el.classList.toggle('expanded', !node.data.collapsed);
        
        // Header
        const header = document.createElement('div');
        header.className = 'node-header';
        
        // Title
        const title = document.createElement('span');
        title.innerHTML = this.getNodeLabel(node);
        header.appendChild(title);

        // Header Controls (Collapse/Delete)
        const controls = document.createElement('div');
        controls.className = 'node-controls';

        let duplicateBtn: HTMLButtonElement | null = null;
        if (node.type === 'agent') {
            duplicateBtn = document.createElement('button');
            duplicateBtn.type = 'button';
            duplicateBtn.className = 'button button-tertiary button-small icon-btn duplicate';
            duplicateBtn.innerHTML = '<span class="icon icon-content icon-primary"></span>';
            duplicateBtn.title = 'Duplicate Agent';
            duplicateBtn.setAttribute('data-tooltip', 'Duplicate Agent');
            duplicateBtn.setAttribute('aria-label', 'Duplicate Agent');
            duplicateBtn.addEventListener('click', (e: any) => {
                e.stopPropagation();
                this.duplicateAgentNode(node);
            });
            controls.appendChild(duplicateBtn);
        }

        let collapseBtn: HTMLButtonElement | null = null;
        let updateCollapseIcon = () => {};
        if (hasSettings) {
            collapseBtn = document.createElement('button');
            collapseBtn.type = 'button';
            collapseBtn.className = 'button button-tertiary button-small icon-btn collapse';
            collapseBtn.innerHTML = '<span class="icon icon-data-engineering icon-primary"></span>';
            updateCollapseIcon = () => {
                if (!collapseBtn) return;
                const tooltip = node.data.collapsed ? 'Open settings' : 'Close settings';
                collapseBtn.title = tooltip;
                collapseBtn.setAttribute('data-tooltip', tooltip);
                el.classList.toggle('expanded', !node.data.collapsed);
            };
            updateCollapseIcon();
            collapseBtn.addEventListener('mousedown', (e: any) => {
                e.stopPropagation();
                node.data.collapsed = !node.data.collapsed;
                updateCollapseIcon();
                this.refreshNodePorts(node);
                this.renderConnections();
            });
            controls.appendChild(collapseBtn);
        }
        
        let delBtn = null;
        if (node.type !== 'start') {
            delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'button button-tertiary button-small icon-btn delete';
            delBtn.innerHTML = '<span class="icon icon-trash icon-danger"></span>';
            delBtn.title = 'Delete Node';
            delBtn.setAttribute('data-tooltip', 'Delete Node');
            delBtn.addEventListener('mousedown', async (e: any) => {
                 e.stopPropagation(); 
                 const confirmed = await this.openConfirmModal({
                    title: 'Delete Node',
                    message: 'Delete this node and its connections?',
                    confirmLabel: 'Delete',
                    cancelLabel: 'Cancel'
                 });
                 if(confirmed) this.deleteNode(node.id);
            });
            controls.appendChild(delBtn);
        }
        header.appendChild(controls);

        // Drag Handler
        header.addEventListener('mousedown', (e: any) => {
            const interactingWithDuplicate = duplicateBtn && duplicateBtn.contains(e.target);
            const interactingWithCollapse = collapseBtn && collapseBtn.contains(e.target);
            const interactingWithDelete = delBtn && delBtn.contains(e.target);
            if (interactingWithDuplicate || interactingWithCollapse || interactingWithDelete) return;
            
            e.stopPropagation();
            this.selectNode(node.id);
            this.isDragging = true;
            const pointer = this.screenToWorld(e.clientX, e.clientY);
            this.dragOffsetWorld = {
                x: pointer.x - node.x,
                y: pointer.y - node.y
            };
        });

        header.addEventListener('dblclick', (e: any) => {
            if (!hasSettings) return;
            e.stopPropagation();
            node.data.collapsed = !node.data.collapsed;
            updateCollapseIcon();
            this.refreshNodePorts(node);
            this.renderConnections();
        });

        el.appendChild(header);

        // Preview (Collapsed State)
        const preview = document.createElement('div');
        preview.className = 'node-preview';
        preview.innerHTML = this.getNodePreviewHTML(node);
        el.appendChild(preview);

        // Body (Form) - Only visible when expanded
        const body = document.createElement('div');
        body.className = 'node-body node-form';
        this.renderNodeForm(node, body);
        el.appendChild(body);

        if (this.nodesLayer) {
            this.nodesLayer.appendChild(el);
        }

        // Render ports after mount so row-based offsets can be measured correctly.
        this.renderPorts(node, el);
    }

    updateNodeHeader(node: any) {
        const el = document.getElementById(node.id);
        if (!el) return;
        const headerLabel = el.querySelector('.node-header span');
        if (headerLabel) {
            headerLabel.innerHTML = this.getNodeLabel(node);
        }
    }

    renderNodePosition(node: any) {
        const el = document.getElementById(node.id);
        if (el) {
            el.style.left = `${node.x}px`;
            el.style.top = `${node.y}px`;
        }
    }

    getNodeLabel(node: any) {
        if (node.type === 'agent') {
            const name = (node.data.agentName || 'Agent').trim() || 'Agent';
            return `<span class="icon icon-robot icon-primary"></span>${escapeHtml(name)}`;
        }
        if (node.type === 'start') return '<span class="icon icon-lesson-introduction icon-primary"></span>Start';
        if (node.type === 'end') return '<span class="icon icon-rectangle-2698 icon-primary"></span>End';
        if (node.type === 'if') return '<span class="icon icon-path icon-primary"></span>Condition';
        if (node.type === 'approval') return '<span class="icon icon-chermark-badge icon-primary"></span>User Approval';
        return `<span class="icon icon-primary"></span>${node.type}`;
    }

    getNodePreviewHTML(node: any) {
        let text: string;
        if (node.type === 'agent') {
            const name = (node.data.agentName || 'Agent').trim();
            const model = (node.data.model || 'gpt-5').toUpperCase();
            text = `${escapeHtml(name)} • ${escapeHtml(model)}`;
        } else if (node.type === 'if') {
            const conditions = this.getIfConditions(node);
            if (conditions.length === 1) {
                const condition = conditions[0];
                const operator = condition.operator === 'contains' ? 'Contains' : 'Equal';
                text = `Condition: ${operator} "${escapeHtml(condition.value || '...')}"`;
            } else {
                text = `${conditions.length} conditions`;
            }
        } else if (node.type === 'approval') {
            text = escapeHtml(node.data.prompt || 'Approval message required');
        } else if (node.type === 'start') {
            text = 'Uses Initial Prompt';
        } else {
            text = 'Configure this node';
        }

        const enabledToolIcons = node.type === 'agent'
            ? TOOLS_CONFIG
                .filter((t: any) => (node.data.tools || {})[t.key])
                .map((t: any) => `<span class="icon ${t.iconClass} icon-small node-preview-tool-icon"></span>`)
                .join('')
            : '';

        return `<span class="node-preview-text">${text}</span>${enabledToolIcons}`;
    }

    // --- IN-NODE FORMS ---

    renderNodeForm(node: EditorNode, container: HTMLElement) {
        container.innerHTML = '';
        if (!node.data) node.data = {};
        const data = node.data;

        const buildLabel = (text: string) => {
            const label = document.createElement('label');
            label.textContent = text;
            return label;
        };

        if (node.type === 'agent') {
            // Agent Name
            container.appendChild(buildLabel('Agent Name'));
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'input';
            nameInput.value = data.agentName || 'Agent';
            nameInput.placeholder = 'e.g., Research Agent';
            nameInput.addEventListener('input', (e: any) => {
                data.agentName = e.target.value;
                this.updatePreview(node);
                this.updateNodeHeader(node);
            });
            container.appendChild(nameInput);

            // System Prompt
            container.appendChild(buildLabel('System Prompt'));
            const sysInput = document.createElement('textarea');
            sysInput.className = 'input textarea-input';
            sysInput.placeholder = 'Define the agent\'s role, persona, or instructions.';
            sysInput.value = data.systemPrompt || '';
            sysInput.addEventListener('input', (e: any) => {
                data.systemPrompt = e.target.value;
                this.updatePreview(node);
            });
            container.appendChild(sysInput);

            // Input
            container.appendChild(buildLabel('Input'));
            const isSubagentTarget = this.isSubagentTargetNode(node.id);
            if (isSubagentTarget) {
                data.userPrompt = '';
                const helperText = document.createElement('div');
                helperText.className = 'subagent-input-lock-note';
                helperText.textContent = 'Input managed by parent agent.';
                container.appendChild(helperText);
            } else {
                const userInputWrapper = document.createElement('div');
                userInputWrapper.className = 'prompt-highlight-wrapper';
                const userInputHighlight = document.createElement('div');
                userInputHighlight.className = 'prompt-highlight-backdrop';
                userInputHighlight.setAttribute('aria-hidden', 'true');
                const userInputHighlightContent = document.createElement('div');
                userInputHighlightContent.className = 'prompt-highlight-content';
                userInputHighlight.appendChild(userInputHighlightContent);
                const userInput = document.createElement('textarea');
                userInput.className = 'input textarea-input prompt-highlight-input';
                userInput.placeholder = 'Use {{PREVIOUS_OUTPUT}} to include the previous node\'s output.';
                userInput.value = data.userPrompt ?? PREVIOUS_OUTPUT_TEMPLATE;
                const syncUserPromptHighlight = () => {
                    userInputHighlightContent.innerHTML = this.getUserPromptHighlightHTML(userInput.value);
                    userInputHighlightContent.style.transform = `translate(${-userInput.scrollLeft}px, ${-userInput.scrollTop}px)`;
                };
                syncUserPromptHighlight();
                userInput.addEventListener('focus', () => {
                    userInputWrapper.classList.add('is-editing');
                });
                userInput.addEventListener('blur', () => {
                    userInputWrapper.classList.remove('is-editing');
                    syncUserPromptHighlight();
                });
                userInput.addEventListener('input', (e: any) => {
                    data.userPrompt = e.target.value;
                    syncUserPromptHighlight();
                    this.scheduleSave();
                });
                userInput.addEventListener('scroll', syncUserPromptHighlight);
                userInputWrapper.appendChild(userInputHighlight);
                userInputWrapper.appendChild(userInput);
                container.appendChild(userInputWrapper);
            }

            // Model
            container.appendChild(buildLabel('Model'));
            const modelDropdown = document.createElement('div');
            modelDropdown.className = 'ds-dropdown';
            container.appendChild(modelDropdown);
            this.setupDropdown(
                modelDropdown,
                this.modelOptions.map((m) => ({ value: m, label: m.toUpperCase() })),
                data.model || this.modelOptions[0],
                'Select model',
                (value) => {
                    data.model = value;
                    this.updatePreview(node);
                    this.render();
                }
            );

            // Reasoning Effort
            container.appendChild(buildLabel('Reasoning Effort'));
            const effortDropdown = document.createElement('div');
            effortDropdown.className = 'ds-dropdown';
            container.appendChild(effortDropdown);
            const modelEfforts = data.model ? this.modelEfforts[data.model] : undefined;
            const effortSource = modelEfforts || this.modelEfforts[this.modelOptions[0]] || [];
            const effortOptions: DropdownItem[] = effortSource.map((optValue: string) => ({
                value: optValue,
                label: optValue.charAt(0).toUpperCase() + optValue.slice(1)
            }));
            const selectedEffort =
                effortOptions.find((o) => o.value === data.reasoningEffort)?.value
                ?? effortOptions[0]?.value
                ?? '';
            if (selectedEffort) {
                data.reasoningEffort = selectedEffort;
                this.setupDropdown(
                    effortDropdown,
                    effortOptions,
                    selectedEffort,
                    'Select effort',
                    (value) => {
                        data.reasoningEffort = value;
                        this.scheduleSave();
                    }
                );
            }

            // Tools
            container.appendChild(buildLabel('Tools'));
            const toolsList = document.createElement('div');
            toolsList.className = 'tools-checkbox-group';

            TOOLS_CONFIG.forEach((tool: any) => {
                const label = document.createElement('label');
                label.className = 'input-checkbox input-checkbox-small';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = Boolean(data.tools?.[tool.key]);
                checkbox.addEventListener('change', () => {
                    if (!data.tools) data.tools = {};
                    data.tools[tool.key] = checkbox.checked;
                    this.updatePreview(node);
                    if (tool.key === 'subagents') {
                        if (!checkbox.checked) {
                            this.removeOutgoingSubagentConnections(node.id);
                        }
                        this.refreshNodePorts(node);
                        this.renderConnections();
                        this.updateRunButton();
                    }
                });

                const box = document.createElement('span');
                box.className = 'input-checkbox-box';
                const checkmark = document.createElement('span');
                checkmark.className = 'input-checkbox-checkmark';
                box.appendChild(checkmark);

                label.appendChild(checkbox);
                label.appendChild(box);

                if (tool.iconClass) {
                    const icon = document.createElement('span');
                    icon.className = `icon ${tool.iconClass} icon-small`;
                    label.appendChild(icon);
                }

                const labelText = document.createElement('span');
                labelText.className = 'input-checkbox-label';
                labelText.textContent = tool.label;
                label.appendChild(labelText);

                toolsList.appendChild(label);
            });

            container.appendChild(toolsList);

        } else if (node.type === 'if') {
            const conditions = this.getIfConditions(node);
            container.appendChild(buildLabel('Conditions'));

            const conditionsList = document.createElement('div');
            conditionsList.className = 'condition-list';

            conditions.forEach((condition: any, index: any) => {
                const row = document.createElement('div');
                row.className = 'condition-row';

                const operatorDropdown = document.createElement('div');
                operatorDropdown.className = 'ds-dropdown';
                row.appendChild(operatorDropdown);
                this.setupDropdown(
                    operatorDropdown,
                    IF_CONDITION_OPERATORS,
                    condition.operator,
                    'Select operator',
                    (value: any) => {
                        conditions[index].operator = value === 'contains' ? 'contains' : 'equal';
                        data.conditions = conditions.map((entry: any) => this.normalizeIfCondition(entry));
                        this.updatePreview(node);
                    }
                );

                const valueInput = document.createElement('input');
                valueInput.type = 'text';
                valueInput.className = 'input';
                valueInput.placeholder = 'Value';
                valueInput.value = condition.value || '';
                valueInput.addEventListener('input', (e: any) => {
                    conditions[index].value = e.target.value;
                    data.conditions = conditions.map((entry: any) => this.normalizeIfCondition(entry));
                    this.updatePreview(node);
                });
                row.appendChild(valueInput);

                if (conditions.length > 1) {
                    const removeConditionButton = document.createElement('button');
                    removeConditionButton.type = 'button';
                    removeConditionButton.className = 'button button-tertiary button-small icon-btn condition-remove-btn';
                    removeConditionButton.title = `Remove condition ${index + 1}`;
                    removeConditionButton.innerHTML = '<span class="icon icon-trash icon-danger" aria-hidden="true"></span>';
                    removeConditionButton.addEventListener('click', (e: any) => {
                        e.preventDefault();
                        this.removeIfCondition(node, index);
                        this.updatePreview(node);
                        this.render();
                    });
                    row.appendChild(removeConditionButton);
                }

                conditionsList.appendChild(row);
            });

            container.appendChild(conditionsList);

            const addConditionButton = document.createElement('button');
            addConditionButton.type = 'button';
            addConditionButton.className = 'button button-secondary button-small add-condition-btn';
            addConditionButton.textContent = '+ Add Condition';
            addConditionButton.addEventListener('click', (e: any) => {
                e.preventDefault();
                data.conditions = [...conditions, { ...DEFAULT_IF_CONDITION }];
                this.updatePreview(node);
                this.render();
            });
            container.appendChild(addConditionButton);

        } else if (node.type === 'approval') {
            container.appendChild(buildLabel('Approval Message'));
            const pInput = document.createElement('input');
            pInput.type = 'text';
            pInput.className = 'input';
            pInput.value = data.prompt || '';
            pInput.placeholder = 'Message shown to user when approval is required';
            pInput.addEventListener('input', (e: any) => {
                data.prompt = e.target.value;
                this.scheduleSave();
            });
            container.appendChild(pInput);

        } else {
            container.textContent = 'No configurable options for this node.';
        }
    }

    updatePreview(node: any) {
        const el = document.getElementById(node.id);
        if(!el) return;
        const preview = el.querySelector('.node-preview');
        if(preview) preview.innerHTML = this.getNodePreviewHTML(node);
        this.scheduleSave();
    }

    enforceSubagentTargetInputLocks(): void {
        let changed = false;
        this.nodes.forEach((node) => {
            if (node.type !== 'agent') return;
            if (!this.isSubagentTargetNode(node.id)) return;
            if (!node.data) node.data = {};
            if ((node.data.userPrompt ?? '') !== '') {
                node.data.userPrompt = '';
                changed = true;
            }
        });
        if (changed) {
            this.scheduleSave();
        }
    }

    refreshSelectedNodeForm(): void {
        if (!this.selectedNodeId) return;
        const selectedNode = this.nodes.find((node) => node.id === this.selectedNodeId);
        if (!selectedNode) return;
        const selectedEl = document.getElementById(selectedNode.id);
        if (!selectedEl) return;
        const body = selectedEl.querySelector('.node-body.node-form');
        if (!(body instanceof HTMLElement)) return;
        this.renderNodeForm(selectedNode, body);
    }

    // --- PORTS & CONNECTIONS (Updated for Arrows) ---

    renderPorts(node: any, el: any) {
        if (node.type === 'agent') {
            el.appendChild(
                this.createPort(
                    node.id,
                    SUBAGENT_TARGET_HANDLE,
                    'port-subagent-target',
                    'Subagent target'
                )
            );
        }

        if (node.type !== 'start') {
            const portIn = this.createPort(node.id, 'input', 'port-in', '', this.getNodeHeaderPortTop(node));
            el.appendChild(portIn);
        }

        if (node.type !== 'end') {
            if (node.type === 'if') {
                const conditions = this.getIfConditions(node);
                if (this.shouldAggregateCollapsedIfPorts(node)) {
                    const title = `${conditions.length} condition branches (expand to wire specific branches)`;
                    const aggregateConditionPort = this.createPort(
                        node.id,
                        this.getIfConditionHandle(0),
                        'port-out port-condition port-condition-aggregate',
                        title,
                        this.getNodeHeaderCenterYOffset(node) - AGGREGATE_PORT_RADIUS,
                        false
                    );
                    aggregateConditionPort.textContent = String(conditions.length);
                    aggregateConditionPort.setAttribute('aria-label', `${conditions.length} conditions`);
                    el.appendChild(aggregateConditionPort);
                    el.appendChild(
                        this.createPort(
                            node.id,
                            IF_FALLBACK_HANDLE,
                            'port-out port-condition-fallback',
                            'False fallback',
                            this.getNodeSecondaryPortTop(node)
                        )
                    );
                } else {
                    conditions.forEach((condition: any, index: any) => {
                        const operatorLabel = condition.operator === 'contains' ? 'Contains' : 'Equal';
                        const conditionValue = condition.value || '';
                        const title = `Condition ${index + 1}: ${operatorLabel} "${conditionValue}"`;
                        el.appendChild(
                            this.createPort(
                                node.id,
                                this.getIfConditionHandle(index),
                                'port-out port-condition',
                                title,
                                this.getIfConditionPortTop(node, index)
                            )
                        );
                    });
                    el.appendChild(
                        this.createPort(
                            node.id,
                            IF_FALLBACK_HANDLE,
                            'port-out port-condition-fallback',
                            'False fallback',
                            this.getIfFallbackPortTop(node)
                        )
                    );
                }
            } else if (node.type === 'agent') {
                el.appendChild(this.createPort(node.id, 'output', 'port-out', '', this.getNodeHeaderPortTop(node)));
                if (node.data?.tools?.subagents) {
                    el.appendChild(
                        this.createPort(
                            node.id,
                            SUBAGENT_HANDLE,
                            'port-subagent',
                            'Subagent'
                        )
                    );
                }
            } else if (node.type === 'approval') {
                el.appendChild(
                    this.createPort(
                        node.id,
                        'approve',
                        'port-out port-true',
                        'Approve',
                        this.getNodeHeaderPortTop(node)
                    )
                );
                el.appendChild(
                    this.createPort(
                        node.id,
                        'reject',
                        'port-out port-false',
                        'Reject',
                        this.getNodeSecondaryPortTop(node)
                    )
                );
            } else {
                el.appendChild(this.createPort(node.id, 'output', 'port-out', '', this.getNodeHeaderPortTop(node)));
            }
        }
    }

    createPort(
        nodeId: string,
        handle: string,
        className: string,
        title = '',
        top: number | null = null,
        connectable = true
    ): HTMLDivElement {
        const port = document.createElement('div');
        port.className = `port ${className}${connectable ? '' : ' port-disabled'}`;
        if (title) port.title = title;
        if (typeof top === 'number') {
            port.style.top = `${top}px`;
        }
        port.dataset.nodeId = nodeId;
        port.dataset.handle = handle;
        if (!connectable) {
            port.setAttribute('aria-disabled', 'true');
        }
        
        if (handle === 'input' || handle === SUBAGENT_TARGET_HANDLE) {
            port.addEventListener('mouseup', (e: any) => this.onPortMouseUp(e, nodeId, handle));
        } else if (connectable) {
            port.addEventListener('mousedown', (e: any) => this.onPortMouseDown(e, nodeId, handle));
        }
        return port;
    }

    getConnectionLineClass(
        sourceHandle?: string,
        options: { editable?: boolean; reconnecting?: boolean } = {}
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
        return classes.join(' ');
    }

    // --- CONNECTION LOGIC (Same as before but renders arrows via CSS) ---
    
    onPortMouseDown(e: any, nodeId: any, handle: any) {
        e.stopPropagation();
        e.preventDefault();
        if (!this.connectionsLayer) return;
        this.setCanvasValidationMessage(null);
        const sourceNode = this.nodes.find((candidate: any) => candidate.id === nodeId);
        if (sourceNode && this.shouldAggregateCollapsedIfPorts(sourceNode) && this.getIfConditionIndexFromHandle(handle) !== null) {
            return;
        }
        const startPoint = sourceNode
            ? this.getConnectionStartPoint(sourceNode, handle)
            : this.screenToWorld(e.clientX, e.clientY);
        this.connectionStart = { nodeId, handle, x: startPoint.x, y: startPoint.y };
        
        this.tempConnection = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.tempConnection.setAttribute('class', this.getConnectionLineClass(handle));
        this.tempConnection.setAttribute('d', `M ${this.connectionStart.x} ${this.connectionStart.y} L ${this.connectionStart.x} ${this.connectionStart.y}`);
        this.connectionsLayer.appendChild(this.tempConnection);
    }

    updateTempConnection(e: any) {
        if (!this.connectionStart) return;
        if (!this.tempConnection) return;
        const world = this.screenToWorld(e.clientX, e.clientY);
        this.tempConnection.setAttribute(
            'd',
            this.getPathD(
                this.connectionStart.x,
                this.connectionStart.y,
                world.x,
                world.y,
                this.connectionStart.handle
            )
        );
    }

    onPortMouseUp(e: any, nodeId: any, handle: any) {
        e.stopPropagation();
        if (this.connectionStart && this.connectionStart.nodeId !== nodeId) {
            if (this.connectionStart.handle === SUBAGENT_HANDLE && handle !== SUBAGENT_TARGET_HANDLE) {
                this.setCanvasValidationMessage('Subagent links must connect to the top green subagent connector.');
                if (this.reconnectingConnection !== null) {
                    this.reconnectingConnection = null;
                    this.renderConnections();
                }
                this.clearPendingConnectionDragState();
                this.updateRunButton();
                return;
            }

            if (this.connectionStart.handle !== SUBAGENT_HANDLE && handle === SUBAGENT_TARGET_HANDLE) {
                this.setCanvasValidationMessage('Regular workflow links must connect to the side input connector.');
                if (this.reconnectingConnection !== null) {
                    this.reconnectingConnection = null;
                    this.renderConnections();
                }
                this.clearPendingConnectionDragState();
                this.updateRunButton();
                return;
            }

            const targetHandle = handle === SUBAGENT_TARGET_HANDLE ? 'input' : handle;
            this.applyConnectionToTarget(nodeId, targetHandle);
        } else if (this.reconnectingConnection !== null) {
            // Released without connecting to anything - connection already deleted, just clean up
            this.reconnectingConnection = null;
            this.renderConnections();
            if(this.tempConnection) this.tempConnection.remove();
            this.connectionStart = null;
            this.tempConnection = null;
            this.updateRunButton();
        }
    }

    onConnectionLineMouseDown(e: any, connection: WorkflowConnection, connIndex: number) {
        e.stopPropagation();
        e.preventDefault();
        if (!this.connectionsLayer) return;
        
        // Track that we're reconnecting this connection
        this.reconnectingConnection = connIndex;
        
        const sourceNode = this.nodes.find((n: any) => n.id === connection.source);
        if (!sourceNode) return;
        const startPoint = this.getConnectionStartPoint(sourceNode, connection.sourceHandle);
        const startX = startPoint.x;
        const startY = startPoint.y;
        const world = this.screenToWorld(e.clientX, e.clientY);
        
        this.connectionStart = {
            nodeId: connection.source,
            handle: connection.sourceHandle ?? '',
            x: startX,
            y: startY
        };
        
        // Remove the original connection temporarily
        this.connections.splice(connIndex, 1);
        this.renderConnections();
        this.updateRunButton();
        
        // Create temp connection for dragging
        this.tempConnection = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.tempConnection.setAttribute(
            'class',
            this.getConnectionLineClass(connection.sourceHandle, { reconnecting: true })
        );
        this.tempConnection.setAttribute(
            'd',
            this.getPathD(startX, startY, world.x, world.y, connection.sourceHandle)
        );
        this.connectionsLayer.appendChild(this.tempConnection);
    }

    renderConnections(refreshSelectedForm = true) {
        if (!this.connectionsLayer) return;
        this.enforceSubagentTargetInputLocks();
        this.updateSubagentTargetNodeStyles();
        const connectionsLayer = this.connectionsLayer;
        // Clear only permanent lines
        const lines = Array.from(connectionsLayer.querySelectorAll('.connection-line'));
        lines.forEach((line: any) => {
            if (line !== this.tempConnection) line.remove();
        });

        this.connections.forEach((conn: any, index: any) => {
            const sourceNode = this.nodes.find((n: any) => n.id === conn.source);
            const targetNode = this.nodes.find((n: any) => n.id === conn.target);
            if (!sourceNode || !targetNode) return;

            const startPoint = this.getConnectionStartPoint(sourceNode, conn.sourceHandle);
            const endPoint = this.getConnectionEndPoint(targetNode, conn.sourceHandle);
            const startX = startPoint.x;
            const startY = startPoint.y;
            const endX = endPoint.x;
            const endY = endPoint.y;

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', this.getConnectionLineClass(conn.sourceHandle, { editable: true }));
            path.setAttribute('d', this.getPathD(startX, startY, endX, endY, conn.sourceHandle));
            path.dataset.connectionIndex = index;
            path.dataset.sourceNodeId = conn.source;
            path.dataset.sourceHandle = conn.sourceHandle;
            path.dataset.targetNodeId = conn.target;
            path.addEventListener('mousedown', (e: any) => this.onConnectionLineMouseDown(e, conn, index));
            connectionsLayer.appendChild(path);
        });
        if (refreshSelectedForm) {
            this.refreshSelectedNodeForm();
        }
        this.scheduleSave();
    }

    updateSubagentTargetNodeStyles(connections: WorkflowConnection[] = this.connections): void {
        const subagentTargets = this.getSubagentTargetIds(connections);
        this.nodes.forEach((node) => {
            const el = document.getElementById(node.id);
            if (!el) return;
            const isSubagentTarget = node.type === 'agent' && subagentTargets.has(node.id);
            el.classList.toggle('subagent-target-node', isSubagentTarget);
            const isSubagentCandidate =
                node.type === 'agent' &&
                (isSubagentTarget || this.canNodeBecomeSubagentTarget(node.id, connections));
            el.classList.toggle('subagent-candidate-node', isSubagentCandidate);
        });
    }

    getPathD(
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        sourceHandle?: string
    ): string {
        if (sourceHandle === SUBAGENT_HANDLE) {
            const verticalControlOffset = Math.max(40, Math.abs(endY - startY) * 0.35);
            return `M ${startX} ${startY} C ${startX} ${startY + verticalControlOffset}, ${endX} ${endY - verticalControlOffset}, ${endX} ${endY}`;
        }
        const controlPointOffset = Math.abs(endX - startX) * 0.5;
        return `M ${startX} ${startY} C ${startX + controlPointOffset} ${startY}, ${endX - controlPointOffset} ${endY}, ${endX} ${endY}`;
    }

    formatApprovalMessage(decision: any, note: any) {
        const base = decision === 'approve' ? 'User approved this step.' : 'User rejected this step.';
        const trimmedNote = (note || '').trim();
        return trimmedNote ? `${base} Feedback: ${trimmedNote}` : base;
    }

    replaceApprovalWithResult(decision: any, note: any) {
        if (!this.pendingApprovalRequest?.container) return;
        
        const container = this.pendingApprovalRequest.container;
        this.renderApprovalResultCard(container, decision, note);
        this.pendingApprovalRequest = null;
    }

    renderApprovalResultCard(container: HTMLElement, decision: 'approve' | 'reject', note: string = '') {
        container.className = 'chat-message approval-result';
        container.classList.add(decision === 'approve' ? 'approved' : 'rejected');
        
        const trimmedNote = (note || '').trim();
        const icon = decision === 'approve' ? '✓' : '✗';
        const text = decision === 'approve' ? 'Approved' : 'Rejected';
        
        container.innerHTML = '';

        const labelEl = document.createElement('span');
        labelEl.className = 'chat-message-label';
        labelEl.textContent = 'Approval decision';
        container.appendChild(labelEl);
        
        const content = document.createElement('div');
        content.className = 'approval-result-content';

        const status = document.createElement('div');
        status.className = 'approval-result-status';
        
        const iconEl = document.createElement('span');
        iconEl.className = 'approval-result-icon';
        iconEl.textContent = icon;
        status.appendChild(iconEl);
        
        const textEl = document.createElement('span');
        textEl.className = 'approval-result-text';
        textEl.textContent = text;
        status.appendChild(textEl);

        content.appendChild(status);
        
        if (trimmedNote) {
            const noteEl = document.createElement('div');
            noteEl.className = 'approval-result-note';
            noteEl.textContent = trimmedNote;
            content.appendChild(noteEl);
        }
        
        container.appendChild(content);
    }

    showApprovalMessage(nodeId: any) {
        if (!this.chatMessages) return;
        this.clearApprovalMessage();
        const node = this.getRunNodeById(nodeId);
        const messageText = node?.data?.prompt || 'Approval required before continuing.';

        const message = document.createElement('div');
        message.className = 'chat-message approval-request';

        const labelEl = document.createElement('span');
        labelEl.className = 'chat-message-label';
        labelEl.textContent = 'Approval required';
        message.appendChild(labelEl);

        const body = document.createElement('div');
        body.className = 'approval-body';

        const textEl = document.createElement('div');
        textEl.className = 'approval-text';
        textEl.textContent = messageText;
        body.appendChild(textEl);

        const helperEl = document.createElement('div');
        helperEl.className = 'approval-helper';
        helperEl.textContent = 'Choose how this workflow should proceed.';
        body.appendChild(helperEl);

        const actions = document.createElement('div');
        actions.className = 'approval-actions';

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'button button-secondary reject-btn';
        rejectBtn.textContent = 'Reject';

        const approveBtn = document.createElement('button');
        approveBtn.className = 'button button-primary approve-btn';
        approveBtn.textContent = 'Approve';

        rejectBtn.addEventListener('click', () => this.submitApprovalDecision('reject'));
        approveBtn.addEventListener('click', () => this.submitApprovalDecision('approve'));

        actions.appendChild(rejectBtn);
        actions.appendChild(approveBtn);
        body.appendChild(actions);
        message.appendChild(body);

        this.chatMessages.appendChild(message);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        this.pendingApprovalRequest = { nodeId, container: message, approveBtn, rejectBtn };
    }

    clearApprovalMessage() {
        if (this.pendingApprovalRequest?.container) {
            this.pendingApprovalRequest.container.remove();
        }
        this.pendingApprovalRequest = null;
    }

    setApprovalButtonsDisabled(disabled: any) {
        if (!this.pendingApprovalRequest) return;
        this.pendingApprovalRequest.approveBtn.disabled = disabled;
        this.pendingApprovalRequest.rejectBtn.disabled = disabled;
    }

    extractWaitingNodeId(logs: any = []) {
        if (!Array.isArray(logs)) return null;
        for (let i = logs.length - 1; i >= 0; i -= 1) {
            if (logs[i].type === 'wait_input') {
                return logs[i].nodeId;
            }
        }
        return null;
    }

    selectNode(id: any) {
        this.selectedNodeId = id;
        document.querySelectorAll('.node').forEach((el: any) => el.classList.remove('selected'));
        const el = document.getElementById(id);
        if (el) el.classList.add('selected');
    }

    // --- CHAT PANEL HELPERS ---

    appendChatMessage(text: any, role: any = 'system', agentName?: string) {
        if (!this.chatMessages) return;
        const message = document.createElement('div');
        message.className = `chat-message ${role}`;
        const normalizedText =
            role === 'error' && !String(text).trim().toLowerCase().startsWith('error:')
                ? `Error: ${text}`
                : text;
        if (role === 'agent') {
            const label = document.createElement('span');
            label.className = 'chat-message-label';
            label.textContent = agentName || this.getPrimaryAgentName();
            message.appendChild(label);
        }
        const body = document.createElement('div');
        if (role === 'agent') {
            body.className = 'chat-message-body markdown';
            body.innerHTML = renderMarkdown(normalizedText);
        } else {
            body.textContent = normalizedText;
        }
        message.appendChild(body);
        this.chatMessages.appendChild(message);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    startChatSession(_promptText: any) {
        if (!this.chatMessages) return;
        this.chatMessages.innerHTML = '';
        this.pendingAgentMessages.clear();
        this.pendingAgentMessageCounts.clear();
        this.clearSubagentSpinnerState();
        if (typeof _promptText === 'string' && _promptText.trim()) {
            this.appendChatMessage(_promptText, 'user');
        }
    }

    mapLogEntryToRole(entry: any) {
        const type = entry.type || '';
        if (type.includes('llm_response')) return 'agent';
        if (type.includes('llm_error') || type === 'error') return 'error';
        if (type.includes('input_received')) return 'user';
        return null;
    }

    formatLogContent(entry: any) {
        const content = entry.content;
        return typeof content === 'string' ? content : '';
    }

    getInitialPromptFromLogs(logs: any[] = []): string | null {
        if (!Array.isArray(logs)) return null;
        const entry = logs.find((item: any) => item?.type === 'start_prompt' && typeof item.content === 'string' && item.content.trim());
        return entry?.content ?? null;
    }

    isApprovalInputLog(entry: any): boolean {
        if (!entry || entry.type !== 'input_received') return false;
        const node = this.getRunNodeById(entry.nodeId);
        return node?.type === 'approval' || node?.type === 'input';
    }

    parseApprovalInputLog(content: string): { decision: 'approve' | 'reject'; note: string } {
        const decisionPrefixMatch = content.match(/(?:^|\n)\s*(?:Decision|Status)\s*:\s*(approve|approved|reject|rejected)\b/i);
        const sentencePrefixMatch = content.match(/(?:^|\n)\s*User\s+(approved|rejected)\b/i);
        const rawDecision = (decisionPrefixMatch?.[1] || sentencePrefixMatch?.[1] || 'approve').toLowerCase();
        const decision = rawDecision.startsWith('reject') ? 'reject' : 'approve';
        const feedbackMatch = content.match(/feedback:\s*(.*)$/i);
        const note = feedbackMatch?.[1]?.trim() || '';
        return { decision, note };
    }

    appendApprovalResultFromLog(content: string): void {
        if (!this.chatMessages) return;
        const { decision, note } = this.parseApprovalInputLog(content);
        const message = document.createElement('div');
        this.renderApprovalResultCard(message, decision, note);
        this.chatMessages.appendChild(message);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    getAgentNameForNode(nodeId: string): string {
        const node = this.getRunNodeById(nodeId);
        return (node?.data?.agentName || '').trim() || 'Agent';
    }

    isSubagentCallLogType(type: string): boolean {
        return (
            type === 'subagent_call_start' ||
            type === 'subagent_call_end' ||
            type === 'subagent_call_error'
        );
    }

    parseSubagentRuntimeLogPayload(entry: any): SubagentRuntimeLogPayload | null {
        if (!this.isSubagentCallLogType(entry?.type || '')) {
            return null;
        }
        if (typeof entry?.content !== 'string' || !entry.content.trim()) {
            return null;
        }

        try {
            const parsed = JSON.parse(entry.content) as Partial<SubagentRuntimeLogPayload>;
            if (
                typeof parsed.callId !== 'string' ||
                typeof parsed.subagentNodeId !== 'string' ||
                typeof parsed.subagentName !== 'string' ||
                typeof parsed.depth !== 'number'
            ) {
                return null;
            }
            return {
                callId: parsed.callId,
                subagentNodeId: parsed.subagentNodeId,
                subagentName: parsed.subagentName,
                depth: parsed.depth,
                parentCallId: typeof parsed.parentCallId === 'string' ? parsed.parentCallId : undefined,
                parentNodeId: typeof parsed.parentNodeId === 'string' ? parsed.parentNodeId : undefined,
                message: typeof parsed.message === 'string' ? parsed.message : undefined
            };
        } catch {
            return null;
        }
    }

    ensureSpinnerSubagentList(spinner: HTMLElement): HTMLElement {
        const existing = spinner.querySelector('.chat-subagent-list');
        if (existing instanceof HTMLElement) {
            return existing;
        }
        const created = document.createElement('div');
        created.className = 'chat-subagent-list';
        spinner.appendChild(created);
        return created;
    }

    ensureSpinnerSubagentSummary(spinner: HTMLElement): HTMLElement {
        const existing = spinner.querySelector('.chat-subagent-summary');
        if (existing instanceof HTMLElement) {
            return existing;
        }

        const list = this.ensureSpinnerSubagentList(spinner);
        const created = document.createElement('div');
        created.className = 'chat-subagent-summary';
        spinner.insertBefore(created, list);
        return created;
    }

    updateSubagentToggleState(item: HTMLElement): void {
        const toggle = item.querySelector('.chat-subagent-toggle');
        if (!(toggle instanceof HTMLButtonElement)) return;

        const hasChildren = item.classList.contains('has-children');
        if (!hasChildren) {
            toggle.hidden = true;
            toggle.disabled = true;
            toggle.textContent = '';
            toggle.removeAttribute('aria-label');
            return;
        }

        const isCollapsed = item.classList.contains('collapsed');
        toggle.hidden = false;
        toggle.disabled = false;
        toggle.textContent = isCollapsed ? '▸' : '▾';
        toggle.setAttribute('aria-label', isCollapsed ? 'Expand nested subagents' : 'Collapse nested subagents');
    }

    markSubagentItemHasChildren(callId: string): void {
        const parentItem = this.subagentCallElements.get(callId);
        if (!parentItem) return;
        parentItem.classList.add('has-children');
        parentItem.classList.remove('collapsed');
        this.updateSubagentToggleState(parentItem);
    }

    updateSpinnerSubagentSummary(spinnerKey: string): void {
        const spinner = this.pendingAgentMessages.get(spinnerKey);
        if (!spinner) return;

        const callIds = this.spinnerSubagentCallIds.get(spinnerKey);
        if (!callIds || callIds.size === 0) {
            const existing = spinner.querySelector('.chat-subagent-summary');
            if (existing instanceof HTMLElement) {
                existing.remove();
            }
            return;
        }

        let running = 0;
        let completed = 0;
        let failed = 0;

        callIds.forEach((callId) => {
            const status = this.subagentCallStatuses.get(callId);
            if (status === 'running') running += 1;
            else if (status === 'completed') completed += 1;
            else if (status === 'failed') failed += 1;
        });

        const summary = this.ensureSpinnerSubagentSummary(spinner);
        const parts = [`${running} running`, `${completed} done`];
        if (failed > 0) {
            parts.push(`${failed} failed`);
        }
        summary.textContent = `Subagents: ${parts.join(' · ')}`;
    }

    ensureSubagentCallItem(spinnerKey: string, payload: SubagentRuntimeLogPayload): HTMLElement | null {
        const existing = this.subagentCallElements.get(payload.callId);
        if (existing) {
            return existing;
        }

        const spinner = this.pendingAgentMessages.get(spinnerKey);
        if (!spinner) {
            return null;
        }

        const item = document.createElement('div');
        item.className = 'chat-subagent-item running';
        item.dataset.callId = payload.callId;
        item.dataset.depth = String(payload.depth);

        const row = document.createElement('div');
        row.className = 'chat-subagent-row';
        const main = document.createElement('div');
        main.className = 'chat-subagent-main';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'chat-subagent-toggle';
        toggle.hidden = true;
        toggle.disabled = true;
        toggle.addEventListener('click', (event) => {
            event.preventDefault();
            item.classList.toggle('collapsed');
            this.updateSubagentToggleState(item);
        });
        const name = document.createElement('span');
        name.className = 'chat-subagent-name';
        name.textContent = payload.subagentName;
        main.appendChild(toggle);
        main.appendChild(name);
        const status = document.createElement('span');
        status.className = 'chat-subagent-status';
        row.appendChild(main);
        row.appendChild(status);
        item.appendChild(row);

        const children = document.createElement('div');
        children.className = 'chat-subagent-children';
        item.appendChild(children);

        const parentContainer = payload.parentCallId
            ? (() => {
                this.markSubagentItemHasChildren(payload.parentCallId);
                return this.subagentCallElements.get(payload.parentCallId)?.querySelector('.chat-subagent-children');
            })()
            : null;
        const hostContainer = parentContainer instanceof HTMLElement
            ? parentContainer
            : this.ensureSpinnerSubagentList(spinner);
        hostContainer.appendChild(item);
        this.updateSubagentToggleState(item);

        this.subagentCallElements.set(payload.callId, item);
        this.subagentCallSpinnerKeys.set(payload.callId, spinnerKey);
        const callIdsForSpinner = this.spinnerSubagentCallIds.get(spinnerKey) ?? new Set<string>();
        callIdsForSpinner.add(payload.callId);
        this.spinnerSubagentCallIds.set(spinnerKey, callIdsForSpinner);
        return item;
    }

    setSubagentCallItemStatus(
        callId: string,
        statusClass: SubagentCallStatus,
        message?: string
    ): void {
        const item = this.subagentCallElements.get(callId);
        if (!item) return;
        this.subagentCallStatuses.set(callId, statusClass);
        item.classList.remove('running', 'completed', 'failed');
        item.classList.add(statusClass);
        const statusEl = item.querySelector('.chat-subagent-status');
        if (!(statusEl instanceof HTMLElement)) return;
        statusEl.classList.remove('running-indicator', 'done-indicator');
        statusEl.replaceChildren();

        if (statusClass === 'running') {
            statusEl.classList.add('running-indicator');
            statusEl.setAttribute('aria-label', 'Running');
            const spinner = document.createElement('span');
            spinner.className = 'chat-spinner chat-spinner-inline';
            spinner.setAttribute('aria-hidden', 'true');
            spinner.innerHTML = '<span></span><span></span><span></span>';
            statusEl.appendChild(spinner);
            return;
        }
        if (statusClass === 'completed') {
            statusEl.classList.add('done-indicator');
            statusEl.removeAttribute('aria-label');
            statusEl.textContent = '✓';
            return;
        }
        statusEl.removeAttribute('aria-label');
        statusEl.textContent = message && message.trim() ? message.trim() : 'Failed';
    }

    handleSubagentLogEntry(entry: any, options: { createSpinnerIfMissing?: boolean } = {}): void {
        const payload = this.parseSubagentRuntimeLogPayload(entry);
        if (!payload) return;

        const spinnerKey =
            payload.parentNodeId ||
            (typeof entry?.nodeId === 'string' ? entry.nodeId : GENERIC_AGENT_SPINNER_KEY);
        const createSpinnerIfMissing = options.createSpinnerIfMissing ?? true;

        if (!this.pendingAgentMessages.has(spinnerKey) && createSpinnerIfMissing) {
            this.showAgentSpinner(this.getAgentNameForNode(spinnerKey), spinnerKey);
        }
        if (!this.pendingAgentMessages.has(spinnerKey)) {
            return;
        }

        if (entry.type === 'subagent_call_start') {
            const item = this.ensureSubagentCallItem(spinnerKey, payload);
            if (item) {
                this.setSubagentCallItemStatus(payload.callId, 'running');
            }
            this.updateSpinnerSubagentSummary(spinnerKey);
            return;
        }

        const mappedStatus = entry.type === 'subagent_call_error' ? 'failed' : 'completed';
        this.setSubagentCallItemStatus(payload.callId, mappedStatus, payload.message);
        this.updateSpinnerSubagentSummary(spinnerKey);
    }

    onLogEntry(entry: any) {
        const type = entry.type || '';
        if (type === 'step_start') {
            const node = this.getRunNodeById(entry.nodeId);
            if (node?.type === 'agent') {
                this.hideAgentSpinner(GENERIC_AGENT_SPINNER_KEY);
                this.showAgentSpinner(this.getAgentNameForNode(entry.nodeId), entry.nodeId);
            }
        } else if (this.isSubagentCallLogType(type)) {
            this.handleSubagentLogEntry(entry);
        } else if (type === 'llm_response') {
            this.hideAgentSpinner(GENERIC_AGENT_SPINNER_KEY);
            this.hideAgentSpinner(entry.nodeId);
            this.lastLlmResponseContent = entry.content ?? null;
            this.appendChatMessage(entry.content || '', 'agent', this.getAgentNameForNode(entry.nodeId));
        } else if (type === 'llm_error' || type === 'error') {
            this.hideAgentSpinner(GENERIC_AGENT_SPINNER_KEY);
            const node = this.getRunNodeById(entry.nodeId);
            if (node?.type === 'agent') {
                this.hideAgentSpinner(entry.nodeId);
            }
            this.appendChatMessage(entry.content || '', 'error');
        }
    }

    renderChatFromLogs(logs: any = []) {
        if (!this.chatMessages) return;
        this.chatMessages.innerHTML = '';
        this.pendingAgentMessages.clear();
        this.pendingAgentMessageCounts.clear();
        this.clearSubagentSpinnerState();
        this.lastLlmResponseContent = null;
        const initialPromptFromLogs = this.getInitialPromptFromLogs(logs);
        if (initialPromptFromLogs) {
            this.appendChatMessage(initialPromptFromLogs, 'user');
        }
        const activeAgentNodeCounts = new Map<string, number>();
        const subagentEntries: any[] = [];
        logs.forEach((entry: any) => {
            const entryNodeId = typeof entry?.nodeId === 'string' ? entry.nodeId : null;
            const entryNode = entryNodeId ? this.getRunNodeById(entryNodeId) : undefined;
            if (entry.type === 'step_start' && entryNode?.type === 'agent' && entryNodeId) {
                const nextCount = (activeAgentNodeCounts.get(entryNodeId) ?? 0) + 1;
                activeAgentNodeCounts.set(entryNodeId, nextCount);
            }
            if (
                (entry.type === 'llm_response' || entry.type === 'llm_error' || entry.type === 'error') &&
                entryNode?.type === 'agent' &&
                entryNodeId
            ) {
                const nextCount = (activeAgentNodeCounts.get(entryNodeId) ?? 0) - 1;
                if (nextCount > 0) {
                    activeAgentNodeCounts.set(entryNodeId, nextCount);
                } else {
                    activeAgentNodeCounts.delete(entryNodeId);
                }
            }

            if (this.isSubagentCallLogType(entry.type || '')) {
                subagentEntries.push(entry);
                return;
            }

            if (this.isApprovalInputLog(entry)) {
                const approvalText = this.formatLogContent(entry);
                if (approvalText) {
                    this.appendApprovalResultFromLog(approvalText);
                }
                return;
            }
            const role = this.mapLogEntryToRole(entry);
            if (!role) return;
            if (entry.type === 'llm_response') this.lastLlmResponseContent = entry.content ?? null;
            const text = this.formatLogContent(entry);
            if (!text) return;
            const agentName = role === 'agent' ? this.getAgentNameForNode(entry.nodeId) : undefined;
            this.appendChatMessage(text, role, agentName);
        });

        activeAgentNodeCounts.forEach((activeCount, nodeId) => {
            for (let i = 0; i < activeCount; i += 1) {
                this.showAgentSpinner(this.getAgentNameForNode(nodeId), nodeId);
            }
        });

        subagentEntries.forEach((entry) => this.handleSubagentLogEntry(entry, { createSpinnerIfMissing: false }));
    }

    async runWorkflow() {
        // Don't start new workflow if already running or paused
        if (this.workflowState !== 'idle') return;

        this.upgradeLegacyNodes();
        const startNode = this.nodes.find((n) => n.type === 'start');
        if (!startNode) {
            alert('Add a Start node and connect your workflow before running.');
            return;
        }

        this.setWorkflowState('running');

        this.currentPrompt = this.initialPrompt?.value || '';
        this.startChatSession(this.currentPrompt);
        this.lastLlmResponseContent = null;

        // Update Start Node with initial input
        if (!startNode.data) startNode.data = {};
        startNode.data.initialInput = this.currentPrompt;

        const graph = this.cloneGraphPayload({
            nodes: this.nodes,
            connections: this.connections
        });
        this.setActiveRunGraph(graph);
        const controller = new AbortController();
        this.activeRunController = controller;

        try {
            const result = await runWorkflowStream(
                graph,
                (entry: any) => this.onLogEntry(entry),
                { signal: controller.signal, onStart: (id: string) => this.saveRunId(id) }
            );
            this.handleRunResult(result, true);

        } catch (e) {
            if (this.isAbortError(e)) return;
            this.appendChatMessage(this.getErrorMessage(e), 'error');
            this.appendStatusMessage('Failed', 'failed');
            this.hideAgentSpinner();
            this.setActiveRunGraph(null);
            this.setWorkflowState('idle');
        } finally {
            if (this.activeRunController === controller) {
                this.activeRunController = null;
            }
        }
    }

    handleRunResult(result: WorkflowRunResult, fromStream = false) {
        this.syncActiveRunGraphFromResult(result);
        if (!fromStream && result.logs) {
            this.renderChatFromLogs(result.logs);
        }
        const hasLlmError = Array.isArray(result.logs)
            ? result.logs.some((entry) => (entry?.type || '').includes('llm_error'))
            : false;

        if (result.status === 'paused' && result.waitingForInput) {
            this.hideAgentSpinner();
            this.currentRunId = result.runId;
            const pausedNodeId = result.currentNodeId || this.extractWaitingNodeId(result.logs);
            this.showApprovalMessage(pausedNodeId);
            this.setWorkflowState('paused');
        } else if (result.status === 'completed') {
            this.clearRunId();
            this.clearApprovalMessage();
            if (hasLlmError) {
                this.appendStatusMessage('Failed', 'failed');
            } else {
                this.appendStatusMessage('Completed', 'completed');
            }
            this.hideAgentSpinner();
            this.setWorkflowState('idle');
            this.currentRunId = null;
            this.setActiveRunGraph(null);
        } else if (result.status === 'failed') {
            this.clearRunId();
            this.clearApprovalMessage();
            this.appendStatusMessage('Failed', 'failed');
            this.hideAgentSpinner();
            this.setWorkflowState('idle');
            this.currentRunId = null;
            this.setActiveRunGraph(null);
        } else {
            this.clearApprovalMessage();
            this.hideAgentSpinner();
            this.setWorkflowState('idle');
            this.setActiveRunGraph(null);
        }
    }

    async recoverRun() {
        const runId = this.getStoredRunId();
        if (!runId) return;

        let result;
        try {
            result = await fetchRun(runId);
        } catch {
            // Transient error (network blip, server 5xx) — don't clear the stored
            // runId so recovery can be reattempted on the next page load.
            return;
        }
        if (!result) {
            this.clearRunId();
            this.setActiveRunGraph(null);
            return;
        } // 404 — run genuinely gone

        this.syncActiveRunGraphFromResult(result);

        if (result.status === 'running') {
            // Engine still executing on server — show partial chat and poll for updates
            this.currentRunId = runId;
            this.renderChatFromLogs(result.logs);
            if (this.pendingAgentMessages.size === 0) {
                this.showAgentSpinner();
            }
            this.setWorkflowState('running');
            this.pollForRun(runId, result.logs.length);
        } else if (result.status === 'paused' && !result.waitingForInput) {
            // Engine was lost (server restarted before our fix, or corrupt record) —
            // the run can't be resumed; show what ran and return to idle.
            this.clearRunId();
            this.renderChatFromLogs(result.logs);
            this.appendStatusMessage('Previous paused run was lost (server restarted).', 'failed');
            this.setWorkflowState('idle');
            this.setActiveRunGraph(null);
        } else {
            // completed, failed, or paused-with-waitingForInput —
            // handleRunResult covers all three cases
            // (fromStream=false → it calls renderChatFromLogs internally)
            this.handleRunResult(result);
            if (result.status !== 'paused') this.clearRunId();
        }
    }

    pollForRun(runId: string, knownLogCount: number) {
        this.pollTimer = setTimeout(async () => {
            this.pollTimer = null;
            let result;
            try {
                result = await fetchRun(runId);
            } catch {
                // Transient error — keep the runId and retry on next poll cycle.
                if (this.getStoredRunId() === runId) this.pollForRun(runId, knownLogCount);
                return;
            }
            // Guard: bail out if this run was cancelled or replaced while the
            // request was in-flight (clearRunId() can't cancel an already-fired timer).
            if (this.getStoredRunId() !== runId) return;
            if (!result) {
                // 404 — run is genuinely gone from server and disk
                this.clearRunId();
                this.setWorkflowState('idle');
                this.setActiveRunGraph(null);
                return;
            }
            this.syncActiveRunGraphFromResult(result);
            // Re-render chat if new log entries arrived since last poll
            const logs = Array.isArray(result.logs) ? result.logs : [];
            if (logs.length > knownLogCount) {
                this.renderChatFromLogs(logs);
            }
            if (result.status === 'running') {
                this.pollForRun(runId, logs.length); // keep polling
            } else {
                this.handleRunResult(result);
                if (result.status !== 'paused') this.clearRunId();
            }
        }, 2000);
    }

    async submitApprovalDecision(decision: any) {
        if (!this.currentRunId) return;
        this.setApprovalButtonsDisabled(true);
        const note = '';
        this.replaceApprovalWithResult(decision, note);
        this.setWorkflowState('running');
        this.showAgentSpinner();
        const controller = new AbortController();
        this.activeRunController = controller;
        
        try {
            const result = await resumeWorkflowStream(
                this.currentRunId,
                { decision, note },
                (entry: any) => this.onLogEntry(entry),
                { signal: controller.signal }
            );
            this.handleRunResult(result, true);
        } catch (e) {
            if (this.isAbortError(e)) return;
            this.appendChatMessage(this.getErrorMessage(e), 'error');
            this.appendStatusMessage('Failed', 'failed');
            this.hideAgentSpinner();
            this.setWorkflowState('idle');
            this.setActiveRunGraph(null);
        } finally {
            if (this.activeRunController === controller) {
                this.activeRunController = null;
            }
        }
    }
}

export default WorkflowEditor;
