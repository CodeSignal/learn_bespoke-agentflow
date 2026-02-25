// @ts-nocheck
// Bespoke Agent Builder - Client Logic

import { runWorkflowStream, resumeWorkflow, fetchConfig } from '../services/api';
import { renderMarkdown, escapeHtml } from './markdown';

const EXPANDED_NODE_WIDTH = 420;

const TOOLS_CONFIG: Array<{ key: string; label: string; iconClass: string }> = [
    { key: 'web_search', label: 'Web Search', iconClass: 'icon-globe' }
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
const IF_PORT_BASE_TOP = 45;
const IF_PORT_STEP = 30;
const IF_CONDITION_OPERATORS = [
    { value: 'equal', label: 'Equal' },
    { value: 'contains', label: 'Contains' }
];
const DEFAULT_IF_CONDITION = { operator: 'equal', value: '' };

export class WorkflowEditor {
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
        this.initialPrompt = document.getElementById('initial-prompt');
        this.runButton = document.getElementById('btn-run');
        this.cancelRunButton = document.getElementById('btn-cancel-run');
        this.zoomValue = document.getElementById('zoom-value');
        this.workflowState = 'idle'; // 'idle' | 'running' | 'paused'
        this.rightPanel = document.getElementById('right-panel');
        this.pendingAgentMessage = null;
        this.currentPrompt = '';
        this.pendingApprovalRequest = null;
        this.activeRunController = null;
        this.lastLlmResponseContent = null;

        this.splitPanelCtorPromise = null;
        this.dropdownCtorPromise = null;
        this.modalCtorPromise = null;
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
        this.loadConfig().then(() => this.loadDefaultWorkflow());
    }

    async getDropdownCtor() {
        if (!this.dropdownCtorPromise) {
            const origin = window.location.origin;
            const dropdownModulePath = `${origin}/design-system/components/dropdown/dropdown.js`;
            this.dropdownCtorPromise = import(/* @vite-ignore */ dropdownModulePath).then((mod) => mod.default);
        }
        return this.dropdownCtorPromise;
    }

    async getSplitPanelCtor() {
        if (!this.splitPanelCtorPromise) {
            const origin = window.location.origin;
            const splitPanelModulePath = `${origin}/design-system/components/split-panel/split-panel.js`;
            this.splitPanelCtorPromise = import(/* @vite-ignore */ splitPanelModulePath).then((mod) => mod.default);
        }
        return this.splitPanelCtorPromise;
    }

    async getModalCtor() {
        if (!this.modalCtorPromise) {
            const origin = window.location.origin;
            const modalModulePath = `${origin}/design-system/components/modal/modal.js`;
            this.modalCtorPromise = import(/* @vite-ignore */ modalModulePath).then((mod) => mod.default);
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
            const startNode = this.nodes.find(n => n.type === 'start');
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

    async setupDropdown(container, items, selectedValue, placeholder, onSelect) {
        const DropdownCtor = await this.getDropdownCtor();
        const dropdown = new DropdownCtor(container, {
            placeholder,
            items,
            selectedValue,
            width: '100%',
            onSelect
        });
        return dropdown;
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

    screenToWorld(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (clientX - rect.left - this.viewport.x) / this.viewport.scale,
            y: (clientY - rect.top - this.viewport.y) / this.viewport.scale
        };
    }

    getPrimaryAgentName() {
        const agentNode = this.nodes.find(n => n.type === 'agent');
        if (agentNode && agentNode.data) {
            const name = (agentNode.data.agentName || '').trim();
            if (name) return name;
        }
        return 'Agent';
    }

    getNodeWidth(node) {
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

    normalizeIfCondition(condition) {
        const normalizedOperator = condition?.operator === 'contains' ? 'contains' : 'equal';
        const rawValue = condition?.value;
        return {
            operator: normalizedOperator,
            value: typeof rawValue === 'string' ? rawValue : ''
        };
    }

    getIfConditionHandle(index) {
        return `${IF_CONDITION_HANDLE_PREFIX}${index}`;
    }

    getIfConditionIndexFromHandle(handle) {
        if (handle === 'true') return 0;
        if (typeof handle !== 'string' || !handle.startsWith(IF_CONDITION_HANDLE_PREFIX)) return null;
        const parsedIndex = Number.parseInt(handle.slice(IF_CONDITION_HANDLE_PREFIX.length), 10);
        return Number.isInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : null;
    }

    getIfPortTop(index) {
        return IF_PORT_BASE_TOP + (index * IF_PORT_STEP);
    }

    getIfConditions(node) {
        if (!node.data) node.data = {};
        if (!Array.isArray(node.data.conditions) || node.data.conditions.length === 0) {
            node.data.conditions = [{ ...DEFAULT_IF_CONDITION }];
        }
        node.data.conditions = node.data.conditions.map((condition) => this.normalizeIfCondition(condition));
        return node.data.conditions;
    }

    removeIfCondition(node, conditionIndex) {
        const conditions = this.getIfConditions(node);
        if (conditions.length <= 1) return;

        node.data.conditions = conditions.filter((_, index) => index !== conditionIndex);
        this.connections = this.connections.reduce((nextConnections, connection) => {
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

    getOutputPortCenterYOffset(node, sourceHandle) {
        if (node.type === 'if') {
            if (sourceHandle === IF_FALLBACK_HANDLE) {
                return this.getIfPortTop(this.getIfConditions(node).length) + 6;
            }
            const conditionIndex = this.getIfConditionIndexFromHandle(sourceHandle);
            if (conditionIndex !== null) {
                return this.getIfPortTop(conditionIndex) + 6;
            }
        }

        if (sourceHandle === 'approve') return 51;
        if (sourceHandle === 'reject') return 81;
        return 24;
    }

    setWorkflowState(state) {
        this.workflowState = state;
        this.updateRunButton();
    }

    setRunButtonHint(reason) {
        if (!this.runButton) return;
        if (reason) {
            this.runButton.setAttribute('data-disabled-hint', reason);
        } else {
            this.runButton.removeAttribute('data-disabled-hint');
        }
    }

    isAbortError(error) {
        if (!error) return false;
        if (error.name === 'AbortError') return true;
        const message = typeof error.message === 'string' ? error.message : '';
        return message.toLowerCase().includes('aborted');
    }

    cancelRunningWorkflow() {
        if (this.activeRunController) {
            this.activeRunController.abort();
            this.activeRunController = null;
        }
        if (this.workflowState === 'running') {
            this.hideAgentSpinner();
            this.clearApprovalMessage();
            this.appendStatusMessage('Cancelled');
            this.currentRunId = null;
            this.setWorkflowState('idle');
        }
    }

    getRunDisableReason() {
        const startNodes = this.nodes.filter(node => node.type === 'start');
        if (startNodes.length === 0) {
            return 'Add a Start node to run the workflow.';
        }
        if (startNodes.length > 1) {
            return 'Use only one Start node before running.';
        }

        const nodeIdSet = new Set(this.nodes.map(node => node.id));
        const hasBrokenConnection = this.connections.some(
            (conn) => !nodeIdSet.has(conn.source) || !nodeIdSet.has(conn.target)
        );
        if (hasBrokenConnection) {
            return 'Fix broken connections before running.';
        }

        const startNode = startNodes[0];
        const adjacency = new Map();
        this.connections.forEach((conn) => {
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
            next.forEach((conn) => {
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
                const hasConditionBranch = outgoing.some((conn) => this.getIfConditionIndexFromHandle(conn.sourceHandle) !== null);
                const hasFallbackBranch = outgoing.some((conn) => conn.sourceHandle === IF_FALLBACK_HANDLE);
                if (!hasConditionBranch && !hasFallbackBranch) {
                    return 'Connect at least one branch for each Condition node.';
                }
            }
            if (node.type === 'approval' || node.type === 'input') {
                const outgoing = adjacency.get(node.id) || [];
                const hasApprove = outgoing.some((conn) => conn.sourceHandle === 'approve');
                const hasReject = outgoing.some((conn) => conn.sourceHandle === 'reject');
                if (!hasApprove && !hasReject) {
                    return 'Connect at least one branch for each approval node.';
                }
            }
        }

        return null;
    }

    updateRunButton() {
        if (!this.runButton) return;
        if (this.cancelRunButton) {
            const showCancel = this.workflowState === 'running';
            this.cancelRunButton.style.display = showCancel ? 'inline-flex' : 'none';
            this.cancelRunButton.disabled = !showCancel;
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

    appendStatusMessage(text, type = '') {
        if (!this.chatMessages) return;
        const message = document.createElement('div');
        message.className = `chat-message status ${type}`;
        message.textContent = text;
        this.chatMessages.appendChild(message);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    logManualUserMessage(text) {
        this.appendChatMessage(text, 'user');
        if (!this.runHistory) this.runHistory = [];
        this.runHistory.push({ role: 'user', content: text });
    }

    showAgentSpinner(name?: string) {
        if (!this.chatMessages) return;
        this.hideAgentSpinner();
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
        this.pendingAgentMessage = spinner;
    }

    hideAgentSpinner() {
        if (this.pendingAgentMessage) {
            this.pendingAgentMessage.remove();
            this.pendingAgentMessage = null;
        }
    }

    renderEffortSelect(node) {
        const select = document.createElement('select');
        select.className = 'input ds-select';
        const options = this.modelEfforts[node.data.model] || this.modelEfforts[this.modelOptions[0]] || [];
        if (!options.includes(node.data.reasoningEffort)) {
            node.data.reasoningEffort = options[0];
        }
        options.forEach(optValue => {
            const opt = document.createElement('option');
            opt.value = optValue;
            opt.text = optValue.charAt(0).toUpperCase() + optValue.slice(1);
            if (node.data.reasoningEffort === optValue) opt.selected = true;
            select.appendChild(opt);
        });
        select.addEventListener('change', (e) => {
            node.data.reasoningEffort = e.target.value;
        });
        return select;
    }

    zoomCanvas(stepPercent) {
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
        draggables.forEach(el => {
            el.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('type', el.dataset.type);
            });
        });

        this.canvas.addEventListener('dragover', (e) => e.preventDefault());
        this.canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const type = e.dataTransfer.getData('type');
            const worldPos = this.screenToWorld(e.clientX, e.clientY);
            this.addNode(type, worldPos.x, worldPos.y);
        });
    }

    initCanvasInteractions() {
        if (this.canvas) {
            this.canvas.addEventListener('mousedown', (e) => {
                const isHint = e.target.classList && e.target.classList.contains('canvas-hint');
                const isBackground = e.target === this.canvas ||
                    e.target === this.canvasStage ||
                    e.target === this.connectionsLayer ||
                    e.target === this.nodesLayer ||
                    isHint;
                if (isBackground) {
                    e.preventDefault();
                    this.isPanning = true;
                    this.canvas.classList.add('panning');
                    this.panStart = { x: e.clientX, y: e.clientY };
                    this.viewportStart = { ...this.viewport };
                }
            });
        }

        document.addEventListener('mousemove', (e) => {
            if (this.isPanning) {
                this.viewport.x = this.viewportStart.x + (e.clientX - this.panStart.x);
                this.viewport.y = this.viewportStart.y + (e.clientY - this.panStart.y);
                this.applyViewport();
                return;
            }

            if (this.isDragging && this.selectedNodeId) {
                if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

                const node = this.nodes.find(n => n.id === this.selectedNodeId);
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

        document.addEventListener('mouseup', (e) => {
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
                }
                // Clean up will happen in onPortMouseUp if we connected, or here if we didn't
                if (!targetPort) {
                    this.reconnectingConnection = null;
                    this.tempConnection.remove();
                    this.tempConnection = null;
                    this.connectionStart = null;
                }
            } else if (this.tempConnection && !this.reconnectingConnection) {
                // Normal connection creation cancelled
                this.tempConnection.remove();
                this.tempConnection = null;
                this.connectionStart = null;
            }
        });
    }

    initButtons() {
        document.getElementById('btn-run').addEventListener('click', () => this.runWorkflow());
        const cancelRunBtn = document.getElementById('btn-cancel-run');
        if (cancelRunBtn) {
            cancelRunBtn.addEventListener('click', () => this.cancelRunningWorkflow());
        }
        document.getElementById('btn-clear').addEventListener('click', async () => {
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
            if (this.chatMessages) {
                this.chatMessages.innerHTML = '<div class="chat-message system">Canvas cleared. Start building your next workflow.</div>';
            }
            this.setWorkflowState('idle');
        });
        
        if (this.approveBtn) {
            this.approveBtn.addEventListener('click', () => this.submitApprovalDecision('approve'));
        }
        if (this.rejectBtn) {
            this.rejectBtn.addEventListener('click', () => this.submitApprovalDecision('reject'));
        }

        const zoomInBtn = document.getElementById('btn-zoom-in');
        const zoomOutBtn = document.getElementById('btn-zoom-out');
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.zoomCanvas(10));
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.zoomCanvas(-10));
    }

    initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}`);
        ws.onmessage = (_event) => {
            // Placeholder for future real-time feedback
        };
    }

    async openConfirmModal(options = {}) {
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

            return await new Promise((resolve) => {
                let confirmed = false;

                const modal = new ModalCtor({
                    size: 'small',
                    title,
                    content,
                    footerButtons: [
                        {
                            label: cancelLabel,
                            type: 'secondary',
                            onClick: (_event, instance) => instance.close()
                        },
                        {
                            label: confirmLabel,
                            type: 'primary',
                            onClick: (_event, instance) => {
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

    addNode(type, x, y) {
        const normalizedType = type === 'input' ? 'approval' : type;
        const node = {
            id: `node_${this.nextNodeId++}`,
            type: normalizedType,
            x,
            y,
            data: this.getDefaultData(normalizedType)
        };
        this.nodes.push(node);
        this.renderNode(node);
        this.updateRunButton();
    }

    upgradeLegacyNodes(shouldRender = false) {
        let updated = false;
        const ifNodeIds = new Set();
        this.nodes.forEach(node => {
            if (node.type === 'input') {
                node.type = 'approval';
                if (node.data && node.data.prompt === undefined) {
                    node.data.prompt = 'Review and approve this step.';
                }
                updated = true;
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
            const enabledProviders = (cfg.providers ?? []).filter(p => p.enabled);
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

    async loadDefaultWorkflow() {
        try {
            const res = await fetch('/api/default-workflow');
            if (!res.ok) return;
            const graph = await res.json();
            this.loadWorkflow(graph);
        } catch {
            // keep the default start node already rendered synchronously
        }
    }

    loadWorkflow(graph) {
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
        const startExists = this.nodes.some(n => n.type === 'start');
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

    getDefaultData(type) {
        switch (type) {
            case 'agent': 
                return { 
                    agentName: 'Agent',
                    systemPrompt: 'You are a helpful assistant.', 
                    userPrompt: '{{PREVIOUS_OUTPUT}}',
                    model: 'gpt-5', 
                    reasoningEffort: 'low',
                    tools: { web_search: false },
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

    nodeHasSettings(node) {
        if (!node) return false;
        return ['agent', 'if', 'approval'].includes(node.type);
    }

    deleteNode(id) {
        this.nodes = this.nodes.filter(n => n.id !== id);
        this.connections = this.connections.filter(c => c.source !== id && c.target !== id);
        this.render();
        this.updateRunButton();
    }

    // --- RENDERING ---

    render() {
        this.nodesLayer.innerHTML = '';
        this.connectionsLayer.innerHTML = '';
        this.nodes.forEach(n => this.renderNode(n));
        this.renderConnections();
        this.updateRunButton();
    }

    renderNode(node) {
        const el = document.createElement('div');
        el.className = `node box card shadowed ${node.type === 'start' ? 'start-node' : ''}`;
        el.id = node.id;
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
        el.dataset.nodeId = node.id;

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

        let collapseBtn = null;
        let updateCollapseIcon = () => {};
        if (hasSettings) {
            collapseBtn = document.createElement('button');
            collapseBtn.type = 'button';
            collapseBtn.className = 'button button-tertiary button-small icon-btn collapse';
            collapseBtn.innerHTML = '<span class="icon icon-data-engineering icon-primary"></span>';
            updateCollapseIcon = () => {
                collapseBtn.title = node.data.collapsed ? 'Open settings' : 'Close settings';
                el.classList.toggle('expanded', !node.data.collapsed);
            };
            updateCollapseIcon();
            collapseBtn.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                node.data.collapsed = !node.data.collapsed;
                updateCollapseIcon();
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
            delBtn.addEventListener('mousedown', async (e) => {
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
        header.addEventListener('mousedown', (e) => {
            const interactingWithCollapse = collapseBtn && collapseBtn.contains(e.target);
            const interactingWithDelete = delBtn && delBtn.contains(e.target);
            if (interactingWithCollapse || interactingWithDelete) return;
            
            e.stopPropagation();
            this.selectNode(node.id);
            this.isDragging = true;
            const pointer = this.screenToWorld(e.clientX, e.clientY);
            this.dragOffsetWorld = {
                x: pointer.x - node.x,
                y: pointer.y - node.y
            };
        });

        header.addEventListener('dblclick', (e) => {
            if (!hasSettings) return;
            e.stopPropagation();
            node.data.collapsed = !node.data.collapsed;
            updateCollapseIcon();
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

        // Ports
        this.renderPorts(node, el);

        this.nodesLayer.appendChild(el);
    }

    updateNodeHeader(node) {
        const el = document.getElementById(node.id);
        if (!el) return;
        const headerLabel = el.querySelector('.node-header span');
        if (headerLabel) {
            headerLabel.innerHTML = this.getNodeLabel(node);
        }
    }

    renderNodePosition(node) {
        const el = document.getElementById(node.id);
        if (el) {
            el.style.left = `${node.x}px`;
            el.style.top = `${node.y}px`;
        }
    }

    getNodeLabel(node) {
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

    getNodePreviewHTML(node) {
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
                .filter(t => (node.data.tools || {})[t.key])
                .map(t => `<span class="icon ${t.iconClass} icon-small node-preview-tool-icon"></span>`)
                .join('')
            : '';

        return `<span class="node-preview-text">${text}</span>${enabledToolIcons}`;
    }

    // --- IN-NODE FORMS ---

    renderNodeForm(node, container) {
        container.innerHTML = '';

        const buildLabel = (text) => {
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
            nameInput.value = node.data.agentName || 'Agent';
            nameInput.placeholder = 'e.g., Research Agent';
            nameInput.addEventListener('input', (e) => {
                node.data.agentName = e.target.value;
                this.updatePreview(node);
                this.updateNodeHeader(node);
            });
            container.appendChild(nameInput);

            // System Prompt
            container.appendChild(buildLabel('System Prompt'));
            const sysInput = document.createElement('textarea');
            sysInput.className = 'input textarea-input';
            sysInput.placeholder = 'Define the agent\'s role, persona, or instructions.';
            sysInput.value = node.data.systemPrompt || '';
            sysInput.addEventListener('input', (e) => {
                node.data.systemPrompt = e.target.value;
                this.updatePreview(node);
            });
            container.appendChild(sysInput);

            // Input
            container.appendChild(buildLabel('Input'));
            const userInput = document.createElement('textarea');
            userInput.className = 'input textarea-input';
            userInput.placeholder = 'Use {{PREVIOUS_OUTPUT}} to include the previous node\'s output.';
            userInput.value = node.data.userPrompt ?? '{{PREVIOUS_OUTPUT}}';
            userInput.addEventListener('input', (e) => {
                node.data.userPrompt = e.target.value;
            });
            container.appendChild(userInput);

            // Model
            container.appendChild(buildLabel('Model'));
            const modelDropdown = document.createElement('div');
            modelDropdown.className = 'ds-dropdown';
            container.appendChild(modelDropdown);
            this.setupDropdown(
                modelDropdown,
                this.modelOptions.map(m => ({ value: m, label: m.toUpperCase() })),
                node.data.model || this.modelOptions[0],
                'Select model',
                (value) => {
                    node.data.model = value;
                    this.updatePreview(node);
                    this.render();
                }
            );

            // Reasoning Effort
            container.appendChild(buildLabel('Reasoning Effort'));
            const effortDropdown = document.createElement('div');
            effortDropdown.className = 'ds-dropdown';
            container.appendChild(effortDropdown);
            const effortOptions = (this.modelEfforts[node.data.model] || this.modelEfforts[this.modelOptions[0]] || []).map(optValue => ({
                value: optValue,
                label: optValue.charAt(0).toUpperCase() + optValue.slice(1)
            }));
            const selectedEffort = effortOptions.find(o => o.value === node.data.reasoningEffort)?.value || effortOptions[0].value;
            node.data.reasoningEffort = selectedEffort;
            this.setupDropdown(
                effortDropdown,
                effortOptions,
                selectedEffort,
                'Select effort',
                (value) => {
                    node.data.reasoningEffort = value;
                }
            );

            // Tools
            container.appendChild(buildLabel('Tools'));
            const toolsList = document.createElement('div');
            toolsList.className = 'tools-checkbox-group';

            TOOLS_CONFIG.forEach(tool => {
                const label = document.createElement('label');
                label.className = 'input-checkbox input-checkbox-small';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = Boolean(node.data.tools?.[tool.key]);
                checkbox.addEventListener('change', () => {
                    if (!node.data.tools) node.data.tools = {};
                    node.data.tools[tool.key] = checkbox.checked;
                    this.updatePreview(node);
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

            conditions.forEach((condition, index) => {
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
                    (value) => {
                        conditions[index].operator = value;
                        node.data.conditions = conditions.map((entry) => this.normalizeIfCondition(entry));
                        this.updatePreview(node);
                    }
                );

                const valueInput = document.createElement('input');
                valueInput.type = 'text';
                valueInput.className = 'input';
                valueInput.placeholder = 'Value';
                valueInput.value = condition.value || '';
                valueInput.addEventListener('input', (e) => {
                    conditions[index].value = e.target.value;
                    node.data.conditions = conditions.map((entry) => this.normalizeIfCondition(entry));
                    this.updatePreview(node);
                });
                row.appendChild(valueInput);

                if (conditions.length > 1) {
                    const removeConditionButton = document.createElement('button');
                    removeConditionButton.type = 'button';
                    removeConditionButton.className = 'button button-tertiary button-small icon-btn condition-remove-btn';
                    removeConditionButton.title = `Remove condition ${index + 1}`;
                    removeConditionButton.innerHTML = '<span class="icon icon-trash icon-danger" aria-hidden="true"></span>';
                    removeConditionButton.addEventListener('click', (e) => {
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
            addConditionButton.addEventListener('click', (e) => {
                e.preventDefault();
                node.data.conditions = [...conditions, { ...DEFAULT_IF_CONDITION }];
                this.updatePreview(node);
                this.render();
            });
            container.appendChild(addConditionButton);

        } else if (node.type === 'approval') {
            container.appendChild(buildLabel('Approval Message'));
            const pInput = document.createElement('input');
            pInput.type = 'text';
            pInput.className = 'input';
            pInput.value = node.data.prompt || '';
            pInput.placeholder = 'Message shown to user when approval is required';
            pInput.addEventListener('input', (e) => {
                node.data.prompt = e.target.value;
            });
            container.appendChild(pInput);

        } else {
            container.textContent = 'No configurable options for this node.';
        }
    }

    updatePreview(node) {
        const el = document.getElementById(node.id);
        if(!el) return;
        const preview = el.querySelector('.node-preview');
        if(preview) preview.innerHTML = this.getNodePreviewHTML(node);
    }

    // --- PORTS & CONNECTIONS (Updated for Arrows) ---

    renderPorts(node, el) {
        if (node.type !== 'start') {
            const portIn = this.createPort(node.id, 'input', 'port-in');
            el.appendChild(portIn);
        }

        if (node.type !== 'end') {
            if (node.type === 'if') {
                const conditions = this.getIfConditions(node);
                conditions.forEach((condition, index) => {
                    const operatorLabel = condition.operator === 'contains' ? 'Contains' : 'Equal';
                    const conditionValue = condition.value || '';
                    const title = `Condition ${index + 1}: ${operatorLabel} "${conditionValue}"`;
                    el.appendChild(
                        this.createPort(
                            node.id,
                            this.getIfConditionHandle(index),
                            'port-out port-condition',
                            title,
                            this.getIfPortTop(index)
                        )
                    );
                });
                el.appendChild(
                    this.createPort(
                        node.id,
                        IF_FALLBACK_HANDLE,
                        'port-out port-condition-fallback',
                        'False fallback',
                        this.getIfPortTop(conditions.length)
                    )
                );
            } else if (node.type === 'approval') {
                el.appendChild(this.createPort(node.id, 'approve', 'port-out port-true', 'Approve'));
                el.appendChild(this.createPort(node.id, 'reject', 'port-out port-false', 'Reject'));
            } else {
                el.appendChild(this.createPort(node.id, 'output', 'port-out'));
            }
        }
    }

    createPort(nodeId, handle, className, title = '', top = null) {
        const port = document.createElement('div');
        port.className = `port ${className}`;
        if (title) port.title = title;
        if (typeof top === 'number') {
            port.style.top = `${top}px`;
        }
        port.dataset.nodeId = nodeId;
        port.dataset.handle = handle;
        
        if (handle === 'input') {
            port.addEventListener('mouseup', (e) => this.onPortMouseUp(e, nodeId, handle));
        } else {
            port.addEventListener('mousedown', (e) => this.onPortMouseDown(e, nodeId, handle));
        }
        return port;
    }

    // --- CONNECTION LOGIC (Same as before but renders arrows via CSS) ---
    
    onPortMouseDown(e, nodeId, handle) {
        e.stopPropagation();
        e.preventDefault();
        if (!this.connectionsLayer) return;
        const world = this.screenToWorld(e.clientX, e.clientY);
        this.connectionStart = { nodeId, handle, x: world.x, y: world.y };
        
        this.tempConnection = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.tempConnection.setAttribute('class', 'connection-line');
        this.tempConnection.setAttribute('d', `M ${this.connectionStart.x} ${this.connectionStart.y} L ${this.connectionStart.x} ${this.connectionStart.y}`);
        this.connectionsLayer.appendChild(this.tempConnection);
    }

    updateTempConnection(e) {
        if (!this.connectionStart) return;
        const world = this.screenToWorld(e.clientX, e.clientY);
        this.tempConnection.setAttribute('d', this.getPathD(this.connectionStart.x, this.connectionStart.y, world.x, world.y));
    }

    onPortMouseUp(e, nodeId, handle) {
        e.stopPropagation();
        if (this.connectionStart && this.connectionStart.nodeId !== nodeId) {
            // If we're reconnecting an existing connection, create new connection with updated target
            if (this.reconnectingConnection !== null) {
                // Connection was already removed from array, just create new one
                this.connections.push({
                    source: this.connectionStart.nodeId,
                    target: nodeId,
                    sourceHandle: this.connectionStart.handle,
                    targetHandle: handle
                });
                this.reconnectingConnection = null;
            } else {
                // Creating a new connection
                this.connections.push({
                    source: this.connectionStart.nodeId,
                    target: nodeId,
                    sourceHandle: this.connectionStart.handle,
                    targetHandle: handle
                });
            }
            this.renderConnections();
            if(this.tempConnection) this.tempConnection.remove();
            this.connectionStart = null;
            this.tempConnection = null;
            this.updateRunButton();
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

    onConnectionLineMouseDown(e, connection, connIndex) {
        e.stopPropagation();
        e.preventDefault();
        if (!this.connectionsLayer) return;
        
        // Track that we're reconnecting this connection
        this.reconnectingConnection = connIndex;
        
        const sourceNode = this.nodes.find(n => n.id === connection.source);
        if (!sourceNode) return;
        
        const startYOffset = this.getOutputPortCenterYOffset(sourceNode, connection.sourceHandle);
        
        const startX = sourceNode.x + this.getNodeWidth(sourceNode);
        const startY = sourceNode.y + startYOffset;
        const world = this.screenToWorld(e.clientX, e.clientY);
        
        this.connectionStart = { 
            nodeId: connection.source, 
            handle: connection.sourceHandle, 
            x: startX, 
            y: startY 
        };
        
        // Remove the original connection temporarily
        this.connections.splice(connIndex, 1);
        this.renderConnections();
        this.updateRunButton();
        
        // Create temp connection for dragging
        this.tempConnection = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.tempConnection.setAttribute('class', 'connection-line reconnecting');
        this.tempConnection.setAttribute('d', this.getPathD(startX, startY, world.x, world.y));
        this.connectionsLayer.appendChild(this.tempConnection);
    }

    renderConnections() {
        if (!this.connectionsLayer) return;
        // Clear only permanent lines
        const lines = Array.from(this.connectionsLayer.querySelectorAll('.connection-line'));
        lines.forEach(line => {
            if (line !== this.tempConnection) line.remove();
        });

        this.connections.forEach((conn, index) => {
            const sourceNode = this.nodes.find(n => n.id === conn.source);
            const targetNode = this.nodes.find(n => n.id === conn.target);
            if (!sourceNode || !targetNode) return;

            const startYOffset = this.getOutputPortCenterYOffset(sourceNode, conn.sourceHandle);

            // Calculate start/end points based on node position + standard port offsets
            const startX = sourceNode.x + this.getNodeWidth(sourceNode);
            const startY = sourceNode.y + startYOffset;
            const endX = targetNode.x;
            const endY = targetNode.y + 24; // Input port offset

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', 'connection-line editable');
            path.setAttribute('d', this.getPathD(startX, startY, endX, endY));
            path.dataset.connectionIndex = index;
            path.dataset.sourceNodeId = conn.source;
            path.dataset.sourceHandle = conn.sourceHandle;
            path.dataset.targetNodeId = conn.target;
            path.addEventListener('mousedown', (e) => this.onConnectionLineMouseDown(e, conn, index));
            this.connectionsLayer.appendChild(path);
        });
    }

    getPathD(startX, startY, endX, endY) {
        const controlPointOffset = Math.abs(endX - startX) * 0.5;
        return `M ${startX} ${startY} C ${startX + controlPointOffset} ${startY}, ${endX - controlPointOffset} ${endY}, ${endX} ${endY}`;
    }

    formatApprovalMessage(decision, note) {
        const base = decision === 'approve' ? 'User approved this step.' : 'User rejected this step.';
        const trimmedNote = (note || '').trim();
        return trimmedNote ? `${base} Feedback: ${trimmedNote}` : base;
    }

    replaceApprovalWithResult(decision, note) {
        if (!this.pendingApprovalRequest?.container) return;
        
        const container = this.pendingApprovalRequest.container;
        container.className = 'chat-message approval-result';
        container.classList.add(decision === 'approve' ? 'approved' : 'rejected');
        
        const trimmedNote = (note || '').trim();
        const icon = decision === 'approve' ? '✓' : '✗';
        const text = decision === 'approve' ? 'Approved' : 'Rejected';
        
        container.innerHTML = '';
        
        const content = document.createElement('div');
        content.className = 'approval-result-content';
        
        const iconEl = document.createElement('span');
        iconEl.className = 'approval-result-icon';
        iconEl.textContent = icon;
        content.appendChild(iconEl);
        
        const textEl = document.createElement('span');
        textEl.className = 'approval-result-text';
        textEl.textContent = text;
        content.appendChild(textEl);
        
        if (trimmedNote) {
            const noteEl = document.createElement('div');
            noteEl.className = 'approval-result-note';
            noteEl.textContent = trimmedNote;
            content.appendChild(noteEl);
        }
        
        container.appendChild(content);
        this.pendingApprovalRequest = null;
    }

    showApprovalMessage(nodeId) {
        if (!this.chatMessages) return;
        this.clearApprovalMessage();
        const node = this.nodes.find(n => n.id === nodeId);
        const messageText = node?.data?.prompt || 'Approval required before continuing.';

        const message = document.createElement('div');
        message.className = 'chat-message approval-request';

        const textEl = document.createElement('div');
        textEl.className = 'approval-text';
        textEl.textContent = messageText;
        message.appendChild(textEl);

        const actions = document.createElement('div');
        actions.className = 'approval-actions';

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'button button-danger reject-btn';
        rejectBtn.textContent = 'Reject';

        const approveBtn = document.createElement('button');
        approveBtn.className = 'button button-success approve-btn';
        approveBtn.textContent = 'Approve';

        rejectBtn.addEventListener('click', () => this.submitApprovalDecision('reject'));
        approveBtn.addEventListener('click', () => this.submitApprovalDecision('approve'));

        actions.appendChild(rejectBtn);
        actions.appendChild(approveBtn);
        message.appendChild(actions);

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

    setApprovalButtonsDisabled(disabled) {
        if (!this.pendingApprovalRequest) return;
        this.pendingApprovalRequest.approveBtn.disabled = disabled;
        this.pendingApprovalRequest.rejectBtn.disabled = disabled;
    }

    extractWaitingNodeId(logs = []) {
        if (!Array.isArray(logs)) return null;
        for (let i = logs.length - 1; i >= 0; i -= 1) {
            if (logs[i].type === 'wait_input') {
                return logs[i].nodeId;
            }
        }
        return null;
    }

    selectNode(id) {
        this.selectedNodeId = id;
        document.querySelectorAll('.node').forEach(el => el.classList.remove('selected'));
        const el = document.getElementById(id);
        if (el) el.classList.add('selected');
    }

    // --- CHAT PANEL HELPERS ---

    appendChatMessage(text, role = 'system', agentName?: string) {
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

    startChatSession(_promptText) {
        if (!this.chatMessages) return;
        this.chatMessages.innerHTML = '';
        this.showAgentSpinner();
    }

    mapLogEntryToRole(entry) {
        const type = entry.type || '';
        if (type.includes('llm_response')) return 'agent';
        if (type.includes('llm_error') || type === 'error') return 'error';
        if (type.includes('input_received') || type.includes('start_prompt')) return 'user';
        return null;
    }

    formatLogContent(entry) {
        const content = entry.content;
        return typeof content === 'string' ? content : '';
    }

    getAgentNameForNode(nodeId: string): string {
        const node = this.nodes.find(n => n.id === nodeId);
        return (node?.data?.agentName || '').trim() || 'Agent';
    }

    onLogEntry(entry) {
        const type = entry.type || '';
        if (type === 'step_start') {
            const node = this.nodes.find(n => n.id === entry.nodeId);
            if (node?.type === 'agent') {
                this.showAgentSpinner(this.getAgentNameForNode(entry.nodeId));
            }
        } else if (type === 'start_prompt') {
            // Only show the user's initial input (before any agent has responded)
            if (entry.content && this.lastLlmResponseContent === null) {
                this.hideAgentSpinner();
                this.appendChatMessage(entry.content, 'user');
                this.showAgentSpinner(this.getAgentNameForNode(entry.nodeId));
            }
        } else if (type === 'llm_response') {
            this.hideAgentSpinner();
            this.lastLlmResponseContent = entry.content ?? null;
            this.appendChatMessage(entry.content || '', 'agent', this.getAgentNameForNode(entry.nodeId));
        } else if (type === 'llm_error' || type === 'error') {
            this.hideAgentSpinner();
            this.appendChatMessage(entry.content || '', 'error');
        }
    }

    renderChatFromLogs(logs = []) {
        if (!this.chatMessages) return;
        this.chatMessages.innerHTML = '';
        this.lastLlmResponseContent = null;
        let messageShown = false;
        logs.forEach(entry => {
            const role = this.mapLogEntryToRole(entry);
            if (!role) return;
            // Only show the user's initial input (before any agent has responded)
            if (entry.type === 'start_prompt' && this.lastLlmResponseContent !== null) return;
            if (entry.type === 'llm_response') this.lastLlmResponseContent = entry.content ?? null;
            if ((role === 'agent' || role === 'error') && !messageShown) {
                this.hideAgentSpinner();
                messageShown = true;
            }
            const text = this.formatLogContent(entry);
            if (!text) return;
            const agentName = role === 'agent' ? this.getAgentNameForNode(entry.nodeId) : undefined;
            this.appendChatMessage(text, role, agentName);
        });
        if (!messageShown) {
            this.showAgentSpinner();
        }
    }

    async runWorkflow() {
        // Don't start new workflow if already running or paused
        if (this.workflowState !== 'idle') return;

        this.upgradeLegacyNodes();
        const startNode = this.nodes.find(n => n.type === 'start');
        if (!startNode) {
            alert('Add a Start node and connect your workflow before running.');
            return;
        }

        this.setWorkflowState('running');

        this.currentPrompt = this.initialPrompt.value || '';
        this.startChatSession(this.currentPrompt);
        this.lastLlmResponseContent = null;

        // Update Start Node with initial input
        startNode.data.initialInput = this.currentPrompt;

        const graph = {
            nodes: this.nodes,
            connections: this.connections
        };
        const controller = new AbortController();
        this.activeRunController = controller;

        try {
            const result = await runWorkflowStream(
                graph,
                (entry) => this.onLogEntry(entry),
                { signal: controller.signal }
            );
            this.handleRunResult(result, true);

        } catch (e) {
            if (this.isAbortError(e)) return;
            this.appendChatMessage(e.message, 'error');
            this.appendStatusMessage('Failed', 'failed');
            this.hideAgentSpinner();
            this.setWorkflowState('idle');
        } finally {
            if (this.activeRunController === controller) {
                this.activeRunController = null;
            }
        }
    }

    handleRunResult(result, fromStream = false) {
        if (!fromStream && result.logs) {
            this.renderChatFromLogs(result.logs);
        }
        const hasLlmError = Array.isArray(result.logs)
            ? result.logs.some(entry => (entry?.type || '').includes('llm_error'))
            : false;

        if (result.status === 'paused' && result.waitingForInput) {
            this.currentRunId = result.runId;
            const pausedNodeId = result.currentNodeId || this.extractWaitingNodeId(result.logs);
            this.showApprovalMessage(pausedNodeId);
            this.setWorkflowState('paused');
        } else if (result.status === 'completed') {
            this.clearApprovalMessage();
            if (hasLlmError) {
                this.appendStatusMessage('Failed', 'failed');
            } else {
                this.appendStatusMessage('Completed', 'completed');
            }
            this.hideAgentSpinner();
            this.setWorkflowState('idle');
            this.currentRunId = null;
        } else if (result.status === 'failed') {
            this.clearApprovalMessage();
            this.appendStatusMessage('Failed', 'failed');
            this.hideAgentSpinner();
            this.setWorkflowState('idle');
            this.currentRunId = null;
        } else {
            this.clearApprovalMessage();
            if (result.status !== 'paused') {
                this.hideAgentSpinner();
                this.setWorkflowState('idle');
            }
        }
    }

    async submitApprovalDecision(decision) {
        if (!this.currentRunId) return;
        this.setApprovalButtonsDisabled(true);
        const note = '';
        this.replaceApprovalWithResult(decision, note);
        this.setWorkflowState('running');
        this.showAgentSpinner();
        const controller = new AbortController();
        this.activeRunController = controller;
        
        try {
            const result = await resumeWorkflow(this.currentRunId, { decision, note }, { signal: controller.signal });
            this.handleRunResult(result);
        } catch (e) {
            if (this.isAbortError(e)) return;
            this.appendChatMessage(e.message, 'error');
            this.appendStatusMessage('Failed', 'failed');
            this.hideAgentSpinner();
            this.setWorkflowState('idle');
        } finally {
            if (this.activeRunController === controller) {
                this.activeRunController = null;
            }
        }
    }
}

export default WorkflowEditor;
