// Bespoke Agent Builder - Client Logic

const COLLAPSED_NODE_WIDTH = 240;
const EXPANDED_NODE_WIDTH = 420;
const MODEL_OPTIONS = ['gpt-5', 'gpt-5-mini', 'gpt-5.1'];
const MODEL_EFFORTS = {
    'gpt-5': ['minimal', 'low', 'medium', 'high'],
    'gpt-5-mini': ['minimal', 'low', 'medium', 'high'],
    'gpt-5.1': ['none', 'low', 'medium', 'high']
};

class WorkflowEditor {
    constructor() {
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

        // DOM Elements
        this.canvas = document.getElementById('canvas-container');
        this.canvasStage = document.getElementById('canvas-stage');
        this.nodesLayer = document.getElementById('nodes-layer');
        this.connectionsLayer = document.getElementById('connections-layer');
        this.chatMessages = document.getElementById('chat-messages');
        this.initialPrompt = document.getElementById('initial-prompt');
        this.chatStatusEl = document.getElementById('chat-status');
        this.runButton = document.getElementById('btn-run');
        this.rightPanel = document.getElementById('right-panel');
        this.rightResizer = document.getElementById('right-resizer');
        this.pendingAgentMessage = null;
        this.currentPrompt = '';

        // Bindings
        this.initDragAndDrop();
        this.initCanvasInteractions();
        this.initButtons();
        this.initPanelControls();
        
        // WebSocket for Logs
        this.initWebSocket();

        this.applyViewport();
        this.setStatus('Idle');
        this.setRunState(false);
    }

    applyViewport() {
        if (this.canvasStage) {
            this.canvasStage.style.transform = `translate(${this.viewport.x}px, ${this.viewport.y}px) scale(${this.viewport.scale})`;
        }
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
        if (!node || !node.data) return COLLAPSED_NODE_WIDTH;
        return node.data.collapsed ? COLLAPSED_NODE_WIDTH : EXPANDED_NODE_WIDTH;
    }

    setStatus(text) {
        if (this.chatStatusEl) {
            this.chatStatusEl.innerText = text;
        }
    }

    setRunState(isRunning) {
        this.isRunning = isRunning;
        if (this.runButton) {
            this.runButton.disabled = isRunning;
        }
    }

    logManualUserMessage(text) {
        this.appendChatMessage(text, 'user');
        if (!this.runHistory) this.runHistory = [];
        this.runHistory.push({ role: 'user', content: text });
    }

    showAgentSpinner() {
        if (!this.chatMessages) return;
        this.hideAgentSpinner();
        const name = this.getPrimaryAgentName();
        const spinner = document.createElement('div');
        spinner.className = 'chat-message agent spinner';
        const label = document.createElement('span');
        label.className = 'chat-message-label';
        label.textContent = `${name} agent`;
        spinner.appendChild(label);
        const body = document.createElement('div');
        body.className = 'chat-spinner-row';
        const text = document.createElement('span');
        text.className = 'chat-spinner-text';
        text.textContent = `${name} is working`;
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
        const options = MODEL_EFFORTS[node.data.model] || MODEL_EFFORTS['gpt-5'];
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

    zoomCanvas(factor) {
        if (!this.canvas) return;
        const newScale = Math.min(2, Math.max(0.5, this.viewport.scale * factor));
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

    resetViewport() {
        this.viewport = { x: 0, y: 0, scale: 1 };
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

        document.addEventListener('mouseup', () => {
            if (this.isPanning) {
                this.isPanning = false;
                if (this.canvas) {
                    this.canvas.classList.remove('panning');
                }
            }
            this.isDragging = false;
            if (this.tempConnection) {
                this.tempConnection.remove();
                this.tempConnection = null;
                this.connectionStart = null;
            }
        });
    }

    initButtons() {
        document.getElementById('btn-run').addEventListener('click', () => this.runWorkflow());
        document.getElementById('btn-clear').addEventListener('click', () => {
            if(confirm('Clear canvas?')) {
                this.nodes = [];
                this.connections = [];
                this.render();
                this.currentPrompt = '';
                if (this.chatMessages) {
                    this.chatMessages.innerHTML = '<div class="chat-message system">Canvas cleared. Start building your next workflow.</div>';
                }
                this.setStatus('Idle');
            }
        });
        
        document.getElementById('btn-submit-input').addEventListener('click', () => this.submitHumanInput());

        const zoomInBtn = document.getElementById('btn-zoom-in');
        const zoomOutBtn = document.getElementById('btn-zoom-out');
        const zoomResetBtn = document.getElementById('btn-zoom-reset');
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.zoomCanvas(1.2));
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.zoomCanvas(0.8));
        if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => this.resetViewport());
    }

    initPanelControls() {
        if (this.rightResizer && this.rightPanel) {
            let isDragging = false;

            const onMouseMove = (e) => {
                if (!isDragging) return;
                const newWidth = Math.min(600, Math.max(240, window.innerWidth - e.clientX));
                document.documentElement.style.setProperty('--right-sidebar-width', `${newWidth}px`);
            };

            const onMouseUp = () => {
                if (!isDragging) return;
                isDragging = false;
                this.rightResizer.classList.remove('dragging');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            this.rightResizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                isDragging = true;
                this.rightResizer.classList.add('dragging');
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }
    }

    initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}`);
        ws.onmessage = (event) => {
            // Placeholder for future real-time feedback
        };
    }

    // --- NODE MANAGEMENT ---

    addNode(type, x, y) {
        const node = {
            id: `node_${this.nextNodeId++}`,
            type,
            x,
            y,
            data: this.getDefaultData(type)
        };
        this.nodes.push(node);
        this.renderNode(node);
    }

    getDefaultData(type) {
        switch (type) {
            case 'agent': 
                return { 
                    agentName: 'Agent',
                    systemPrompt: 'You are a helpful assistant.', 
                    userPrompt: '',
                    model: 'gpt-5', 
                    reasoningEffort: 'minimal',
                    tools: { web_search: false },
                    collapsed: true
                };
            case 'if': 
                return { condition: '', collapsed: true };
            case 'input': 
                return { prompt: 'Please provide input:', collapsed: true };
            case 'start':
            case 'end':
                return { collapsed: true };
            default: 
                return { collapsed: true };
        }
    }

    deleteNode(id) {
        this.nodes = this.nodes.filter(n => n.id !== id);
        this.connections = this.connections.filter(c => c.source !== id && c.target !== id);
        this.render();
    }

    // --- RENDERING ---

    render() {
        this.nodesLayer.innerHTML = '';
        this.connectionsLayer.innerHTML = '';
        this.nodes.forEach(n => this.renderNode(n));
        this.renderConnections();
    }

    renderNode(node) {
        const el = document.createElement('div');
        el.className = `node ${node.type === 'start' ? 'start-node' : ''}`;
        el.id = node.id;
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
        el.dataset.nodeId = node.id;

        if (!node.data) node.data = {};
        if (node.data.collapsed === undefined) {
            node.data.collapsed = node.type === 'start' || node.type === 'end';
        }
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

        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'icon-btn collapse';
        collapseBtn.innerHTML = '<span class="material-icons">tune</span>';
        const updateCollapseIcon = () => {
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
        
        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn delete';
        delBtn.innerHTML = '<span class="material-icons">delete</span>';
        delBtn.title = 'Delete Node';
        delBtn.addEventListener('mousedown', (e) => {
             e.stopPropagation(); 
             if(confirm('Delete node?')) this.deleteNode(node.id);
        });
        controls.appendChild(delBtn);
        header.appendChild(controls);

        // Drag Handler
        header.addEventListener('mousedown', (e) => {
            if (e.target === collapseBtn || e.target === delBtn) return;
            
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
            e.stopPropagation();
            node.data.collapsed = !node.data.collapsed;
            updateCollapseIcon();
            this.renderConnections();
        });

        el.appendChild(header);

        // Preview (Collapsed State)
        const preview = document.createElement('div');
        preview.className = 'node-preview';
        preview.innerText = this.getNodePreviewText(node);
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
            return `<span class="material-icons">smart_toy</span>${name}`;
        }
        if (node.type === 'start') return '<span class="material-icons">play_circle</span>Start';
        if (node.type === 'end') return '<span class="material-icons">flag</span>End';
        if (node.type === 'if') return '<span class="material-icons">call_split</span>If/Else';
        if (node.type === 'input') return '<span class="material-icons">person</span>Input';
        return node.type;
    }

    getNodePreviewText(node) {
        if (node.type === 'agent') {
            const name = (node.data.agentName || 'Agent').trim();
            const model = (node.data.model || 'gpt-5').toUpperCase();
            return `${name} • ${model}`;
        }
        if (node.type === 'if') return `Condition: ${node.data.condition || '...'} `;
        if (node.type === 'input') return node.data.prompt || 'Prompt required';
        if (node.type === 'start') return 'Uses Initial Prompt';
        return 'Configure this node';
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
            sysInput.value = node.data.systemPrompt || '';
            sysInput.addEventListener('input', (e) => {
                node.data.systemPrompt = e.target.value;
                this.updatePreview(node);
            });
            container.appendChild(sysInput);

            // User Prompt Override
            container.appendChild(buildLabel('User Prompt Override (optional)'));
            const userInput = document.createElement('textarea');
            userInput.placeholder = 'If left empty, uses previous node output.';
            userInput.value = node.data.userPrompt || '';
            userInput.addEventListener('input', (e) => {
                node.data.userPrompt = e.target.value;
            });
            container.appendChild(userInput);

            // Model
            container.appendChild(buildLabel('Model'));
            const modelSelect = document.createElement('select');
            MODEL_OPTIONS.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.text = m.toUpperCase();
                if (node.data.model === m) opt.selected = true;
                modelSelect.appendChild(opt);
            });
            modelSelect.addEventListener('change', (e) => {
                node.data.model = e.target.value;
                this.updatePreview(node);
                this.render();
            });
            container.appendChild(modelSelect);

            // Reasoning Effort
            container.appendChild(buildLabel('Reasoning Effort'));
            container.appendChild(this.renderEffortSelect(node));

            // Tools
            container.appendChild(buildLabel('Tools'));
            const toolsList = document.createElement('div');
            toolsList.className = 'tool-list';

            const toolItems = [
                { key: 'web_search', label: 'Web Search' }
            ];

            toolItems.forEach(tool => {
                const row = document.createElement('label');
                row.className = 'row';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = node.data.tools?.[tool.key] || false;
                checkbox.addEventListener('change', (e) => {
                    if (!node.data.tools) node.data.tools = {};
                    node.data.tools[tool.key] = e.target.checked;
                });
                row.appendChild(checkbox);
                row.appendChild(document.createTextNode(` ${tool.label}`));
                toolsList.appendChild(row);
            });

            container.appendChild(toolsList);

        } else if (node.type === 'if') {
            container.appendChild(buildLabel('Condition (Text contains)'));
            const condInput = document.createElement('input');
            condInput.type = 'text';
            condInput.value = node.data.condition || '';
            condInput.addEventListener('input', (e) => {
                node.data.condition = e.target.value;
                this.updatePreview(node);
            });
            container.appendChild(condInput);

        } else if (node.type === 'input') {
            container.appendChild(buildLabel('Input Prompt'));
            const pInput = document.createElement('input');
            pInput.type = 'text';
            pInput.value = node.data.prompt || '';
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
        if(preview) preview.innerText = this.getNodePreviewText(node);
    }

    // --- PORTS & CONNECTIONS (Updated for Arrows) ---

    renderPorts(node, el) {
        if (node.type !== 'start') {
            const portIn = this.createPort(node.id, 'input', 'port-in');
            el.appendChild(portIn);
        }

        if (node.type !== 'end') {
            if (node.type === 'if') {
                el.appendChild(this.createPort(node.id, 'true', 'port-out port-true', 'True'));
                el.appendChild(this.createPort(node.id, 'false', 'port-out port-false', 'False'));
            } else {
                el.appendChild(this.createPort(node.id, 'output', 'port-out'));
            }
        }
    }

    createPort(nodeId, handle, className, title = '') {
        const port = document.createElement('div');
        port.className = `port ${className}`;
        if (title) port.title = title;
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
            this.connections.push({
                source: this.connectionStart.nodeId,
                target: nodeId,
                sourceHandle: this.connectionStart.handle,
                targetHandle: handle
            });
            this.renderConnections();
            if(this.tempConnection) this.tempConnection.remove();
            this.connectionStart = null;
            this.tempConnection = null;
        }
    }

    renderConnections() {
        if (!this.connectionsLayer) return;
        // Clear only permanent lines
        const lines = Array.from(this.connectionsLayer.querySelectorAll('.connection-line'));
        lines.forEach(line => {
            if (line !== this.tempConnection) line.remove();
        });

        this.connections.forEach(conn => {
            const sourceNode = this.nodes.find(n => n.id === conn.source);
            const targetNode = this.nodes.find(n => n.id === conn.target);
            if (!sourceNode || !targetNode) return;

            let startYOffset = 24; // center of port
            if (conn.sourceHandle === 'true') startYOffset = 51;
            if (conn.sourceHandle === 'false') startYOffset = 81;
            if (conn.sourceHandle === 'output' && sourceNode.type === 'agent') startYOffset = 24;

            // Calculate start/end points based on node position + standard port offsets
            const startX = sourceNode.x + this.getNodeWidth(sourceNode);
            const startY = sourceNode.y + startYOffset;
            const endX = targetNode.x;
            const endY = targetNode.y + 24; // Input port offset

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', 'connection-line');
            path.setAttribute('d', this.getPathD(startX, startY, endX, endY));
            this.connectionsLayer.appendChild(path);
        });
    }

    getPathD(startX, startY, endX, endY) {
        const controlPointOffset = Math.abs(endX - startX) * 0.5;
        return `M ${startX} ${startY} C ${startX + controlPointOffset} ${startY}, ${endX - controlPointOffset} ${endY}, ${endX} ${endY}`;
    }

    selectNode(id) {
        this.selectedNodeId = id;
        document.querySelectorAll('.node').forEach(el => el.classList.remove('selected'));
        const el = document.getElementById(id);
        if (el) el.classList.add('selected');
    }

    // --- CHAT PANEL HELPERS ---

    appendChatMessage(text, role = 'system') {
        if (!this.chatMessages) return;
        const message = document.createElement('div');
        message.className = `chat-message ${role}`;
        if (role === 'agent') {
            const label = document.createElement('span');
            label.className = 'chat-message-label';
            label.textContent = this.getPrimaryAgentName();
            message.appendChild(label);
        }
        const body = document.createElement('div');
        body.textContent = text;
        message.appendChild(body);
        this.chatMessages.appendChild(message);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    startChatSession(promptText) {
        if (!this.chatMessages) return;
        this.chatMessages.innerHTML = '';
        if (promptText && promptText.trim().length > 0) {
            this.logManualUserMessage(promptText.trim());
        }
        this.showAgentSpinner();
    }

    mapLogEntryToRole(entry) {
        const type = entry.type || '';
        if (type.includes('llm_response')) return 'agent';
        if (type.includes('input_received') || type.includes('start_prompt')) return 'user';
        return null;
    }

    formatLogContent(entry) {
        const content = entry.content;
        return typeof content === 'string' ? content : '';
    }

    renderChatFromLogs(logs = []) {
        if (!this.chatMessages) return;
        this.chatMessages.innerHTML = '';
        if (this.currentPrompt && this.currentPrompt.trim().length > 0) {
            this.appendChatMessage(this.currentPrompt.trim(), 'user');
        }
        let agentMessageShown = false;
        logs.forEach(entry => {
            const role = this.mapLogEntryToRole(entry);
            if (!role) return;
            if (role === 'agent' && !agentMessageShown) {
                this.hideAgentSpinner();
                agentMessageShown = true;
            }
            const text = this.formatLogContent(entry);
            if (!text) return;
            this.appendChatMessage(text, role);
        });
        if (!agentMessageShown) {
            this.showAgentSpinner();
        }
    }

    async runWorkflow() {
        const startNode = this.nodes.find(n => n.type === 'start');
        if (!startNode) {
            alert('Add a Start node and connect your workflow before running.');
            this.setStatus('Missing start node');
            return;
        }

        this.setStatus('Running');
        this.setRunState(true);

        this.currentPrompt = this.initialPrompt.value || '';
        this.startChatSession(this.currentPrompt);

        // Update Start Node with initial input
        startNode.data.initialInput = this.currentPrompt;

        const graph = {
            nodes: this.nodes,
            connections: this.connections
        };

        try {
            const res = await fetch('/api/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ graph })
            });
            
            const result = await res.json();
            this.handleRunResult(result);

        } catch (e) {
            this.appendChatMessage('Error: ' + e.message, 'error');
            this.setStatus('Failed');
            this.hideAgentSpinner();
            this.setRunState(false);
        }
    }

    handleRunResult(result) {
        if (result.logs) {
            this.renderChatFromLogs(result.logs);
        }

        if (result.status === 'paused' && result.waitingForInput) {
            this.currentRunId = result.runId;
            document.getElementById('input-modal').style.display = 'block';
            this.setStatus('Waiting for input');
        } else if (result.status === 'completed') {
            this.setStatus('Completed');
            this.hideAgentSpinner();
            this.setRunState(false);
  } else {
            this.setStatus(result.status || 'Idle');
            if (result.status !== 'paused') {
                this.hideAgentSpinner();
                this.setRunState(false);
            }
        }
    }

    async submitHumanInput() {
        const val = document.getElementById('human-input-value').value;
        document.getElementById('input-modal').style.display = 'none';
        this.logManualUserMessage(val);
        this.showAgentSpinner();
        
        try {
            const res = await fetch('/api/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    runId: this.currentRunId,
                    input: val 
                })
            });
            const result = await res.json();
            this.handleRunResult(result);
        } catch (e) {
            this.appendChatMessage(e.message, 'error');
            this.hideAgentSpinner();
            this.setRunState(false);
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.editor = new WorkflowEditor();
});
