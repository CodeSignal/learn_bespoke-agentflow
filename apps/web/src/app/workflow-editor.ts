// AgentFlow workflow editor - composition root.
//
// The editor is split into modules under this folder; this class owns the
// shared state, wires the modules together and handles page-level input
// (toolbar, palette, keyboard, pan/zoom, undo/redo, persistence).

import type { WorkflowConnection } from '@agentflow/types';
import { fetchConfig } from '../services/api';
import { applyModelAliases, buildModelCatalog } from './model-catalog';
import { ConnectionsController } from './canvas/connections';
import { ViewportController } from './canvas/viewport';
import { ChatView } from './chat/chat-view';
import {
    CANVAS_MESSAGE_TIMEOUT_MS,
    COLLAPSED_NODE_FALLBACK_HEIGHT,
    DEFAULT_MODEL,
    DEFAULT_MODEL_EFFORTS,
    DEFAULT_MODEL_LABELS,
    DEFAULT_MODEL_OPTIONS,
    DEFAULT_RIGHT_PANEL_WIDTH,
    DUPLICATE_NODE_MIN_WORLD_Y,
    DUPLICATE_NODE_SPACING,
    EXPANDED_AGENT_FALLBACK_HEIGHT,
    KEYBOARD_ADD_NODE_STAGGER_PX,
    SAVE_DEBOUNCE_MS,
    SPLIT_PANEL_MAX_LEFT,
    SPLIT_PANEL_MIN_LEFT,
    SPLIT_PANEL_MIN_RIGHT,
    START_NODE_APPROX_SIZE,
    START_NODE_FALLBACK_POSITION,
    WHEEL_ZOOM_SENSITIVITY,
    ZOOM_BUTTON_STEP_PERCENT
} from './constants';
import { getSplitPanelCtor, openConfirmModal } from './ds-loader';
import type { SplitPanelInstance } from './ds-loader';
import type { EditorHost, EditorStore } from './editor-host';
import { GraphHistory } from './graph/history';
import { upgradeLegacyGraph } from './graph/legacy-upgrade';
import { getRunDisableReason, isSubagentTargetNode } from './graph/validation';
import { NodeForms } from './nodes/node-forms';
import { NodeView, getDefaultNodeData } from './nodes/node-view';
import { fetchDefaultWorkflow, loadStoredWorkflow, saveStoredWorkflow } from './persistence';
import { RunController } from './run/run-controller';
import type { ConfirmOptions, EditorNode, Point, WorkflowGraphPayload, WorkflowState } from './types';

const TEXT_ENTRY_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'];
const INTERACTIVE_TAGS = [...TEXT_ENTRY_TAGS, 'BUTTON', 'A'];

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

export class WorkflowEditor implements EditorHost {
    readonly store: EditorStore;

    private modelAliases: Record<string, string> = {};

    readonly viewport: ViewportController;

    readonly nodesLayer: HTMLElement | null;

    readonly connectionsLayer: SVGSVGElement | HTMLElement | null;

    private readonly canvas: HTMLElement | null;

    private readonly canvasStage: HTMLElement | null;

    private readonly initialPrompt: HTMLInputElement | HTMLTextAreaElement | null;

    private readonly runButton: HTMLButtonElement | null;

    private readonly cancelRunButton: HTMLButtonElement | null;

    private readonly clearButton: HTMLButtonElement | null;

    private readonly canvasValidationMessage: HTMLElement | null;

    private readonly rightPanel: HTMLElement | null;

    private readonly nodeForms: NodeForms;

    private readonly nodeView: NodeView;

    private readonly connections: ConnectionsController;

    private readonly chat: ChatView;

    private readonly run: RunController;

    private readonly history: GraphHistory;

    private canvasValidationTimeout: ReturnType<typeof setTimeout> | null = null;

    private pendingLayoutSyncFrame: number | null = null;

    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    private stateReady = false;

    private splitPanel: SplitPanelInstance | null = null;

    // Node drag
    private draggingNodeId: string | null = null;

    private dragOffsetWorld: Point = { x: 0, y: 0 };

    private dragMoved = false;

    // Canvas pan
    private isPanning = false;

    private panStart: Point = { x: 0, y: 0 };

    private viewportStart: Point = { x: 0, y: 0 };

    constructor() {
        this.store = {
            nodes: [],
            connections: [],
            nextNodeId: 1,
            selectedNodeId: null,
            selectedConnection: null,
            modelOptions: [...DEFAULT_MODEL_OPTIONS],
            modelEfforts: { ...DEFAULT_MODEL_EFFORTS },
            modelLabels: { ...DEFAULT_MODEL_LABELS },
            modelProviders: {},
            modelDefaultEfforts: {},
            defaultModel: DEFAULT_MODEL
        };

        // DOM Elements
        this.canvas = document.getElementById('canvas-container');
        this.canvasStage = document.getElementById('canvas-stage');
        this.nodesLayer = document.getElementById('nodes-layer');
        this.connectionsLayer = document.getElementById('connections-layer');
        this.initialPrompt = document.getElementById('initial-prompt') as HTMLInputElement | HTMLTextAreaElement | null;
        this.runButton = document.getElementById('btn-run') as HTMLButtonElement | null;
        this.cancelRunButton = document.getElementById('btn-cancel-run') as HTMLButtonElement | null;
        this.clearButton = document.getElementById('btn-clear') as HTMLButtonElement | null;
        this.canvasValidationMessage = document.getElementById('canvas-validation-message');
        this.rightPanel = document.getElementById('right-panel');

        this.viewport = new ViewportController(this.canvas, this.canvasStage, document.getElementById('zoom-value'));
        this.nodeForms = new NodeForms(this);
        this.nodeView = new NodeView(this, this.nodeForms);
        this.nodeForms.view = this.nodeView;
        this.connections = new ConnectionsController(this);
        this.chat = new ChatView(document.getElementById('chat-messages'), {
            getRunNodeById: (nodeId) => this.run.getRunNodeById(nodeId),
            getPrimaryAgentName: () => this.run.getPrimaryAgentName(),
            onApprovalDecision: (decision) => void this.run.submitApprovalDecision(decision)
        });
        this.run = new RunController({
            chat: this.chat,
            getGraph: () => this.getGraph(),
            getPromptValue: () => this.initialPrompt?.value || '',
            prepareGraphForRun: () => this.upgradeLegacyNodes(),
            onStateChange: () => this.updateRunButton()
        });
        this.history = new GraphHistory(this.getGraph());

        void this.initSplitPanelLayout();

        // Bindings
        this.initPalette();
        this.initCanvasInteractions();
        this.initButtons();
        this.initKeyboard();

        this.viewport.apply();
        this.updateRunButton();
        this.addDefaultStartNode();
        this.loadConfig().then(async () => {
            await this.loadInitialWorkflow();
            this.applyModelAliases();
            this.stateReady = true;
            this.history.reset(this.getGraph());
            this.saveWorkflowState();
            await this.run.recover();
        }).catch((err: unknown) => {
            console.error('Workflow editor initialization failed', getErrorMessage(err));
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

    private getGraph(): WorkflowGraphPayload {
        return { nodes: this.store.nodes, connections: this.store.connections };
    }

    private get workflowState(): WorkflowState {
        return this.run.getState();
    }

    // --- LAYOUT ---

    private async initSplitPanelLayout(): Promise<void> {
        const mainLayout = document.querySelector('.main-layout');
        if (!mainLayout || !this.canvas || !this.rightPanel) return;

        const rightWidthVar = getComputedStyle(document.documentElement)
            .getPropertyValue('--right-sidebar-width')
            .trim();
        const rightWidth = Number.parseFloat(rightWidthVar) || DEFAULT_RIGHT_PANEL_WIDTH;
        const containerWidth = mainLayout.getBoundingClientRect().width || window.innerWidth || 1280;
        const initialSplit = ((containerWidth - rightWidth) / containerWidth) * 100;
        const clampedSplit = Math.max(SPLIT_PANEL_MIN_LEFT, Math.min(SPLIT_PANEL_MAX_LEFT, initialSplit));

        try {
            const SplitPanelCtor = await getSplitPanelCtor();
            this.splitPanel = new SplitPanelCtor(mainLayout, {
                initialSplit: clampedSplit,
                minLeft: SPLIT_PANEL_MIN_LEFT,
                minRight: SPLIT_PANEL_MIN_RIGHT,
                dividerLabel: 'Resize run console'
            });
            this.splitPanel.getLeftPanel().appendChild(this.canvas);
            this.splitPanel.getRightPanel().appendChild(this.rightPanel);

            // Canvas now has correct dimensions — reposition the Start node if it's
            // still the only node (i.e. no default-workflow.json was loaded yet or at all)
            const startNode = this.store.nodes.find((n) => n.type === 'start');
            if (startNode && this.store.nodes.length === 1) {
                const pos = this.getDefaultStartPosition();
                startNode.x = pos.x;
                startNode.y = pos.y;
                this.render();
                if (this.stateReady) this.history.reset(this.getGraph());
            }
        } catch (error) {
            console.warn('Failed to initialize split panel layout', error);
        }
    }

    scheduleConnectionLayoutSync(): void {
        if (this.pendingLayoutSyncFrame !== null) return;
        this.pendingLayoutSyncFrame = window.requestAnimationFrame(() => {
            this.pendingLayoutSyncFrame = null;
            this.connections.render();
        });
    }

    // --- RUN CONTROLS ---

    private setButtonHint(button: HTMLButtonElement | null, attribute: string, reason: string | null): void {
        if (!button) return;
        if (reason) {
            button.setAttribute(attribute, reason);
        } else {
            button.removeAttribute(attribute);
        }
        // Mirror the hint into the button's hidden description so it is not hover-only.
        const describedBy = button.getAttribute('aria-describedby');
        const description = describedBy ? document.getElementById(describedBy) : null;
        if (description) {
            description.textContent = reason ?? '';
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
        }, CANVAS_MESSAGE_TIMEOUT_MS);
    }

    private getClearDisableReason(): string | null {
        if (this.workflowState === 'running') {
            return 'Cannot clear canvas while workflow is running. Cancel the run first.';
        }
        if (this.workflowState === 'paused') {
            return 'Cannot clear canvas while workflow is paused waiting for approval. Cancel the run first.';
        }
        return null;
    }

    updateRunButton(): void {
        if (!this.runButton) return;
        const state = this.workflowState;
        if (this.cancelRunButton) {
            // A run can be cancelled while it is running and while it waits for approval.
            const showCancel = state === 'running' || state === 'paused';
            const cancelling = this.run.isCancelling();
            this.cancelRunButton.style.display = showCancel ? 'inline-flex' : 'none';
            this.cancelRunButton.disabled = !showCancel || cancelling;
            this.setButtonHint(
                this.cancelRunButton,
                'data-tooltip',
                showCancel ? (cancelling ? 'Cancelling...' : 'Cancel workflow') : null
            );
        }

        if (this.clearButton) {
            const clearDisabledReason = this.getClearDisableReason();
            this.clearButton.disabled = Boolean(clearDisabledReason);
            this.setButtonHint(this.clearButton, 'data-disabled-hint', clearDisabledReason);
        }

        if (state === 'running') {
            this.runButton.textContent = 'Running...';
            this.runButton.disabled = true;
            this.setButtonHint(this.runButton, 'data-disabled-hint', 'Workflow is currently running.');
        } else if (state === 'paused') {
            this.runButton.textContent = 'Paused';
            this.runButton.disabled = true;
            this.setButtonHint(
                this.runButton,
                'data-disabled-hint',
                'Workflow is paused waiting for approval. Approve, reject, or cancel the run.'
            );
        } else {
            const disabledReason = getRunDisableReason(this.store.nodes, this.store.connections);
            this.runButton.innerHTML = 'Run Workflow <span class="icon icon-rocket icon-small" aria-hidden="true"></span>';
            this.runButton.disabled = Boolean(disabledReason);
            this.setButtonHint(this.runButton, 'data-disabled-hint', disabledReason);
        }
    }

    // --- INITIALIZATION ---

    private initPalette(): void {
        const draggables = document.querySelectorAll<HTMLElement>('.draggable-node');
        draggables.forEach((el) => {
            el.addEventListener('dragstart', (e) => {
                e.dataTransfer?.setData('type', el.dataset.type ?? '');
            });
            // Keyboard (and click-free) alternative to dragging: add at the centre of the view.
            el.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                const type = el.dataset.type;
                if (!type) return;
                const node = this.addNodeAtViewportCenter(type);
                this.selectNode(node.id);
                document.getElementById(node.id)?.focus();
            });
        });

        if (!this.canvas) return;
        this.canvas.addEventListener('dragover', (e) => e.preventDefault());
        this.canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const type = e.dataTransfer?.getData('type');
            if (!type) return;
            const worldPos = this.viewport.screenToWorld(e.clientX, e.clientY);
            this.addNode(type, worldPos.x, worldPos.y);
        });
    }

    private initCanvasInteractions(): void {
        if (this.canvas) {
            const canvas = this.canvas;
            canvas.addEventListener('mousedown', (e) => {
                const isBackground = e.target === canvas ||
                    e.target === this.canvasStage ||
                    e.target === this.connectionsLayer ||
                    e.target === this.nodesLayer;
                if (isBackground) {
                    e.preventDefault();
                    this.selectNode(null);
                    if (document.activeElement instanceof HTMLElement && canvas.contains(document.activeElement)) {
                        document.activeElement.blur();
                    }
                    this.isPanning = true;
                    canvas.classList.add('panning');
                    this.panStart = { x: e.clientX, y: e.clientY };
                    this.viewportStart = { x: this.viewport.viewport.x, y: this.viewport.viewport.y };
                }
            });

            // Ctrl/Cmd + wheel (which is also what a trackpad pinch sends) zooms at the cursor.
            canvas.addEventListener('wheel', (e) => {
                if (!e.ctrlKey && !e.metaKey) return;
                e.preventDefault();
                const nextScale = this.viewport.viewport.scale * Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
                this.viewport.zoomAtClientPoint(nextScale, e.clientX, e.clientY);
            }, { passive: false });
        }

        document.addEventListener('mousemove', (e) => {
            if (this.isPanning) {
                this.viewport.panTo(
                    this.viewportStart.x + (e.clientX - this.panStart.x),
                    this.viewportStart.y + (e.clientY - this.panStart.y)
                );
                return;
            }

            if (this.draggingNodeId) {
                if (e.target instanceof HTMLElement && TEXT_ENTRY_TAGS.includes(e.target.tagName)) return;

                const node = this.store.nodes.find((n) => n.id === this.draggingNodeId);
                if (node) {
                    const pointer = this.viewport.screenToWorld(e.clientX, e.clientY);
                    node.x = pointer.x - this.dragOffsetWorld.x;
                    node.y = pointer.y - this.dragOffsetWorld.y;
                    this.dragMoved = true;
                    this.nodeView.renderNodePosition(node);
                    this.connections.render();
                }
            }

            this.connections.handleDocumentMouseMove(e);
        });

        document.addEventListener('mouseup', (e) => {
            if (this.isPanning) {
                this.isPanning = false;
                if (this.canvas) {
                    this.canvas.classList.remove('panning');
                }
            }
            if (this.draggingNodeId) {
                this.draggingNodeId = null;
                if (this.dragMoved) {
                    this.dragMoved = false;
                    this.commitHistory();
                }
            }

            this.connections.handleDocumentMouseUp(e);
        });
    }

    private initButtons(): void {
        if (this.runButton) {
            this.runButton.addEventListener('click', () => void this.run.run());
        }
        if (this.cancelRunButton) {
            this.cancelRunButton.addEventListener('click', () => void this.run.cancel());
        }
        if (this.clearButton) {
            this.clearButton.addEventListener('click', () => void this.clearCanvas());
        }

        const zoomInBtn = document.getElementById('btn-zoom-in');
        const zoomOutBtn = document.getElementById('btn-zoom-out');
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.viewport.zoomByStep(ZOOM_BUTTON_STEP_PERCENT));
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.viewport.zoomByStep(-ZOOM_BUTTON_STEP_PERCENT));
    }

    private initKeyboard(): void {
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
    }

    private onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            if (this.connections.cancelPendingConnection()) {
                e.preventDefault();
                this.setCanvasValidationMessage(null);
            }
            return;
        }

        const target = e.target instanceof HTMLElement || e.target instanceof SVGElement ? e.target : null;
        const tagName = target?.tagName.toUpperCase() ?? '';
        const isTextEntry = TEXT_ENTRY_TAGS.includes(tagName) ||
            (target instanceof HTMLElement && target.isContentEditable);
        // Text fields keep their own editing keys (including native undo).
        if (isTextEntry) return;
        // Only act on keys pressed on the canvas or the page itself, not inside dialogs or the run console.
        const onCanvasOrPage = !target || target === document.body || Boolean(this.canvas?.contains(target));
        if (!onCanvasOrPage) return;

        const modifier = e.metaKey || e.ctrlKey;
        const key = e.key.toLowerCase();
        if (modifier && key === 'z') {
            e.preventDefault();
            if (e.shiftKey) this.redo();
            else this.undo();
            return;
        }
        if (modifier && key === 'y') {
            e.preventDefault();
            this.redo();
            return;
        }

        if ((e.key === 'Delete' || e.key === 'Backspace') && !modifier && !INTERACTIVE_TAGS.includes(tagName)) {
            if (this.store.selectedConnection) {
                e.preventDefault();
                this.connections.deleteConnection(this.store.selectedConnection);
            } else if (this.store.selectedNodeId) {
                const node = this.store.nodes.find((n) => n.id === this.store.selectedNodeId);
                if (node && node.type !== 'start') {
                    e.preventDefault();
                    void this.requestDeleteNode(node.id);
                }
            }
        }
    }

    private confirm(options: ConfirmOptions): Promise<boolean> {
        return openConfirmModal(options);
    }

    private async clearCanvas(): Promise<void> {
        if (this.workflowState !== 'idle') return;
        const confirmed = await this.confirm({
            title: 'Clear Canvas',
            message: 'Remove all nodes and connections from the canvas?',
            confirmLabel: 'Clear',
            cancelLabel: 'Keep'
        });
        if (!confirmed || this.workflowState !== 'idle') return;
        this.store.nodes = [];
        this.store.connections = [];
        this.store.nextNodeId = 1;
        this.store.selectedNodeId = null;
        this.store.selectedConnection = null;
        this.render();
        this.addDefaultStartNode();
        this.run.reset();
        this.chat.reset('Canvas cleared. Start building your next workflow.');
        this.commitHistory();
        this.updateRunButton();
    }

    // --- UNDO / REDO ---

    commitHistory(): void {
        if (!this.stateReady) return;
        this.history.observe(this.getGraph());
    }

    private undo(): void {
        this.applyHistoryStep(() => this.history.undo(this.getGraph()), 'Nothing to undo.');
    }

    private redo(): void {
        this.applyHistoryStep(() => this.history.redo(this.getGraph()), 'Nothing to redo.');
    }

    private applyHistoryStep(step: () => WorkflowGraphPayload | null, emptyMessage: string): void {
        if (!this.stateReady) return;
        if (this.workflowState !== 'idle') {
            this.setCanvasValidationMessage('Undo and redo are unavailable while a workflow is running or paused.');
            return;
        }
        this.connections.cancelPendingConnection();
        const graph = step();
        if (!graph) {
            this.setCanvasValidationMessage(emptyMessage);
            return;
        }
        this.restoreGraph(graph);
    }

    /** Replaces the canvas with a history snapshot, keeping view-only state as it is now. */
    private restoreGraph(graph: WorkflowGraphPayload): void {
        const { store } = this;
        const collapsedById = new Map(store.nodes.map((node) => [node.id, node.data?.collapsed]));
        const currentInitialInput = store.nodes.find((node) => node.type === 'start')?.data?.initialInput;

        store.nodes = graph.nodes;
        store.connections = graph.connections;
        store.nodes.forEach((node) => {
            if (!node.data) node.data = {};
            if (collapsedById.has(node.id)) {
                node.data.collapsed = collapsedById.get(node.id);
            }
            if (node.type === 'start' && currentInitialInput !== undefined) {
                node.data.initialInput = currentInitialInput;
            }
        });
        store.nextNodeId = Math.max(store.nextNodeId, this.getMaxNodeNumber() + 1);
        if (store.selectedNodeId && !store.nodes.some((node) => node.id === store.selectedNodeId)) {
            store.selectedNodeId = null;
        }
        store.selectedConnection = null;
        this.render();
    }

    // --- NODE MANAGEMENT ---

    addNode(type: string, x: number, y: number): EditorNode {
        const normalizedType = type === 'input' ? 'approval' : type;
        const node: EditorNode = {
            id: `node_${this.store.nextNodeId++}`,
            type: normalizedType,
            x,
            y,
            data: getDefaultNodeData(normalizedType, this.store.defaultModel)
        };
        this.store.nodes.push(node);
        this.scheduleSave();
        this.nodeView.renderNode(node);
        this.updateRunButton();
        this.commitHistory();
        return node;
    }

    private addNodeAtViewportCenter(type: string): EditorNode {
        const center = this.viewport.getVisibleCenterWorld() ?? START_NODE_FALLBACK_POSITION;
        // Offset each new node a little so several added in a row do not stack exactly.
        const stagger = (this.store.nodes.length % 6) * KEYBOARD_ADD_NODE_STAGGER_PX;
        return this.addNode(type, center.x + stagger, center.y + stagger);
    }

    private upgradeLegacyNodes(): void {
        if (upgradeLegacyGraph(this.store.nodes, this.store.connections)) {
            this.render();
        }
    }

    private async loadConfig(): Promise<void> {
        try {
            const catalog = buildModelCatalog(await fetchConfig());
            if (!catalog) return;
            this.store.modelOptions = catalog.options;
            this.store.modelEfforts = catalog.efforts;
            this.store.modelLabels = catalog.labels;
            this.store.modelProviders = catalog.providers;
            this.store.modelDefaultEfforts = catalog.defaultEfforts;
            this.store.defaultModel = catalog.defaultModel;
            this.modelAliases = catalog.aliases;
        } catch {
            // keep hardcoded defaults
        }
    }

    private applyModelAliases(): void {
        if (applyModelAliases(this.store.nodes, this.modelAliases, this.store.modelOptions)) {
            this.render();
        }
    }

    // --- PERSISTENCE ---

    private saveWorkflowState(): void {
        saveStoredWorkflow(this.getGraph());
    }

    scheduleSave(): void {
        if (!this.stateReady) return;
        if (this.saveTimer !== null) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.saveWorkflowState();
            // Edits that arrive in a burst (typing, dragging) settle into one undo step.
            this.history.observe(this.getGraph());
        }, SAVE_DEBOUNCE_MS);
    }

    private async loadInitialWorkflow(): Promise<void> {
        // 1. localStorage first — restores the canvas on refresh
        // 2. otherwise the server's default-workflow.json (first visit or after clear)
        const graph = loadStoredWorkflow() ?? await fetchDefaultWorkflow();
        if (graph) {
            this.loadWorkflow(graph);
        }
        // else: keep the default start node already rendered synchronously
    }

    private getMaxNodeNumber(): number {
        return this.store.nodes.reduce((max, n) => {
            const num = parseInt(n.id.replace('node_', ''), 10);
            return isNaN(num) ? max : Math.max(max, num);
        }, 0);
    }

    loadWorkflow(graph: Partial<WorkflowGraphPayload>): void {
        this.store.nodes = graph.nodes ?? [];
        this.store.connections = graph.connections ?? [];
        this.store.nextNodeId = this.getMaxNodeNumber() + 1;
        this.store.selectedNodeId = null;
        this.store.selectedConnection = null;
        upgradeLegacyGraph(this.store.nodes, this.store.connections);
        this.render();
        this.restoreInitialPrompt();
    }

    /** Puts the last run's prompt back in the prompt box after a reload. */
    private restoreInitialPrompt(): void {
        if (!this.initialPrompt || this.initialPrompt.value) return;
        const savedPrompt = this.store.nodes.find((n) => n.type === 'start')?.data?.initialInput;
        if (typeof savedPrompt === 'string') {
            this.initialPrompt.value = savedPrompt;
        }
    }

    private addDefaultStartNode(): void {
        const startExists = this.store.nodes.some((n) => n.type === 'start');
        if (startExists) return;
        const { x, y } = this.getDefaultStartPosition();
        this.addNode('start', x, y);
    }

    /** Centre of the visible canvas (so it also works after panning or zooming). */
    private getDefaultStartPosition(): Point {
        const center = this.viewport.getVisibleCenterWorld();
        if (!center) return { ...START_NODE_FALLBACK_POSITION };
        return {
            x: center.x - (START_NODE_APPROX_SIZE.width / 2),
            y: center.y - (START_NODE_APPROX_SIZE.height / 2)
        };
    }

    deleteNode(id: string): void {
        const { store } = this;
        store.nodes = store.nodes.filter((n) => n.id !== id);
        store.connections = store.connections.filter((c) => c.source !== id && c.target !== id);
        if (store.selectedNodeId === id) {
            store.selectedNodeId = null;
        }
        this.render();
        this.updateRunButton();
        this.commitHistory();
    }

    async requestDeleteNode(id: string): Promise<void> {
        const node = this.store.nodes.find((n) => n.id === id);
        if (!node || node.type === 'start') return;
        const confirmed = await this.confirm({
            title: 'Delete Node',
            message: 'Delete this node and its connections?',
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel'
        });
        if (confirmed) this.deleteNode(id);
    }

    duplicateAgentNode(sourceNode: EditorNode): void {
        if (sourceNode.type !== 'agent') return;
        const duplicatedData = sourceNode.data
            ? JSON.parse(JSON.stringify(sourceNode.data)) as NonNullable<EditorNode['data']>
            : {};
        duplicatedData.collapsed = true;

        const sourceEl = document.getElementById(sourceNode.id);
        const sourceHeight = sourceEl?.offsetHeight
            ?? (sourceNode.data?.collapsed ? COLLAPSED_NODE_FALLBACK_HEIGHT : EXPANDED_AGENT_FALLBACK_HEIGHT);
        const duplicateX = sourceNode.x;
        const proposedAboveY = sourceNode.y - COLLAPSED_NODE_FALLBACK_HEIGHT - DUPLICATE_NODE_SPACING;
        const duplicateY = proposedAboveY >= DUPLICATE_NODE_MIN_WORLD_Y
            ? proposedAboveY
            : sourceNode.y + sourceHeight + DUPLICATE_NODE_SPACING;

        const duplicatedNode: EditorNode = {
            id: `node_${this.store.nextNodeId++}`,
            type: 'agent',
            x: duplicateX,
            y: duplicateY,
            data: duplicatedData
        };

        this.store.nodes.push(duplicatedNode);
        this.nodeView.renderNode(duplicatedNode);
        this.selectNode(duplicatedNode.id);
        this.scheduleSave();
        this.updateRunButton();
        this.commitHistory();
    }

    toggleNodeCollapsed(node: EditorNode): void {
        if (!node.data) node.data = {};
        node.data.collapsed = !node.data.collapsed;
        this.nodeView.syncCollapseState(node);
        this.refreshNodePorts(node);
        this.renderConnections();
    }

    beginNodeDrag(node: EditorNode, event: MouseEvent): void {
        this.draggingNodeId = node.id;
        this.dragMoved = false;
        const pointer = this.viewport.screenToWorld(event.clientX, event.clientY);
        this.dragOffsetWorld = {
            x: pointer.x - node.x,
            y: pointer.y - node.y
        };
    }

    nudgeNode(node: EditorNode, dx: number, dy: number): void {
        node.x += dx;
        node.y += dy;
        this.nodeView.renderNodePosition(node);
        this.connections.render();
    }

    // --- SELECTION ---

    selectNode(id: string | null): void {
        this.store.selectedNodeId = id;
        if (this.store.selectedConnection) {
            this.store.selectedConnection = null;
            this.connections.syncSelectionClasses();
        }
        document.querySelectorAll('.node').forEach((el) => el.classList.remove('selected'));
        const el = id ? document.getElementById(id) : null;
        if (el) el.classList.add('selected');
    }

    selectConnection(connection: WorkflowConnection | null): void {
        if (connection) {
            this.store.selectedNodeId = null;
            document.querySelectorAll('.node').forEach((el) => el.classList.remove('selected'));
        }
        this.store.selectedConnection = connection;
        this.connections.syncSelectionClasses();
    }

    // --- PORTS (forwarded to the connections controller) ---

    onPortMouseDown(event: MouseEvent, nodeId: string, handle: string): void {
        this.connections.onPortMouseDown(event, nodeId, handle);
    }

    onPortMouseUp(event: MouseEvent, nodeId: string, handle: string): void {
        this.connections.onPortMouseUp(event, nodeId, handle);
    }

    onPortKeyActivate(nodeId: string, handle: string): void {
        this.connections.onPortKeyActivate(nodeId, handle);
    }

    // --- RENDERING ---

    render(): void {
        if (!this.nodesLayer || !this.connectionsLayer) return;
        this.nodesLayer.querySelectorAll<HTMLElement>('.node-body.node-form').forEach((form) => {
            this.nodeForms.teardown(form);
        });
        this.nodesLayer.innerHTML = '';
        this.connectionsLayer.innerHTML = '';
        this.store.nodes.forEach((n) => this.nodeView.renderNode(n));
        this.renderConnections(); // renderConnections() already calls scheduleSave()
        this.updateRunButton();
    }

    refreshNodePorts(node: EditorNode): void {
        this.nodeView.refreshNodePorts(node);
    }

    rerenderNodeForm(node: EditorNode): void {
        const body = document.getElementById(node.id)?.querySelector('.node-body.node-form');
        if (!(body instanceof HTMLElement)) return;
        this.nodeForms.renderNodeForm(node, body);
        this.scheduleConnectionLayoutSync();
    }

    renderConnections(): void {
        this.connections.render();
        this.syncSubagentInputLocks();
    }

    /**
     * An agent's Input field is replaced by a note while it is a subagent target.
     * Rebuild only the forms whose status changed since they were rendered.
     */
    private syncSubagentInputLocks(): void {
        this.store.nodes.forEach((node) => {
            if (node.type !== 'agent') return;
            const body = document.getElementById(node.id)?.querySelector('.node-body.node-form');
            if (!(body instanceof HTMLElement)) return;
            const isTarget = isSubagentTargetNode(node.id, this.store.connections);
            if (this.nodeForms.isRenderedAsSubagentTarget(body) !== isTarget) {
                this.nodeForms.renderNodeForm(node, body);
            }
        });
    }
}

export default WorkflowEditor;
