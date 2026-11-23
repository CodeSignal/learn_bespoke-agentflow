import {
    DEFAULT_APPROVAL_PROMPT,
    DEFAULT_IF_CONDITION,
    DEFAULT_MODEL,
    DEFAULT_REASONING_EFFORT,
    KEYBOARD_NODE_NUDGE_PX,
    PREVIOUS_OUTPUT_TEMPLATE,
    TOOLS_CONFIG
} from '../constants';
import type { EditorHost } from '../editor-host';
import { getIfConditions } from '../graph/if-conditions';
import { canNodeBecomeSubagentTarget, isSubagentTargetNode } from '../graph/validation';
import { escapeHtml } from '../markdown';
import type { EditorNode, WorkflowNodeData } from '../types';
import type { NodeForms } from './node-forms';
import { createPortElement, renderPorts } from './ports';

export function getDefaultNodeData(type: string, defaultModel: string = DEFAULT_MODEL): WorkflowNodeData {
    switch (type) {
        case 'agent':
            return {
                agentName: 'Agent',
                systemPrompt: 'You are a helpful assistant.',
                userPrompt: PREVIOUS_OUTPUT_TEMPLATE,
                model: defaultModel,
                reasoningEffort: DEFAULT_REASONING_EFFORT,
                tools: { web_search: false, subagents: false },
                collapsed: true
            };
        case 'if':
            return {
                conditions: [{ ...DEFAULT_IF_CONDITION }],
                collapsed: true
            };
        case 'approval':
            return { prompt: DEFAULT_APPROVAL_PROMPT, collapsed: true };
        default:
            return { collapsed: true };
    }
}

export function nodeHasSettings(node: EditorNode | null | undefined): boolean {
    if (!node) return false;
    return ['agent', 'if', 'approval'].includes(node.type);
}

/** Plain-text name of a node, for accessible labels. */
export function getNodeAccessibleName(node: EditorNode): string {
    if (node.type === 'agent') {
        const name = (node.data?.agentName || 'Agent').trim() || 'Agent';
        return `Agent node: ${name}`;
    }
    if (node.type === 'start') return 'Start node';
    if (node.type === 'if') return 'Condition node';
    if (node.type === 'approval') return 'User Approval node';
    return `${node.type} node`;
}

export function getNodeLabel(node: EditorNode): string {
    if (node.type === 'agent') {
        const name = (node.data?.agentName || 'Agent').trim() || 'Agent';
        return `<span class="icon icon-robot icon-primary"></span>${escapeHtml(name)}`;
    }
    if (node.type === 'start') return '<span class="icon icon-lesson-introduction icon-primary"></span>Start';
    if (node.type === 'if') return '<span class="icon icon-path icon-primary"></span>Condition';
    if (node.type === 'approval') return '<span class="icon icon-chermark-badge icon-primary"></span>User Approval';
    return `<span class="icon icon-primary"></span>${escapeHtml(String(node.type))}`;
}

export function getNodePreviewHTML(node: EditorNode, modelLabels: Record<string, string> = {}): string {
    const data = node.data ?? {};
    let text: string;
    if (node.type === 'agent') {
        const name = (data.agentName || 'Agent').trim();
        const modelId = data.model || DEFAULT_MODEL;
        const model = modelLabels[modelId] ?? modelId;
        text = `${escapeHtml(name)} • ${escapeHtml(model)}`;
    } else if (node.type === 'if') {
        const conditions = getIfConditions(node);
        if (conditions.length === 1) {
            const condition = conditions[0];
            const operator = condition.operator === 'contains' ? 'Contains' : 'Equal';
            text = `Condition: ${operator} "${escapeHtml(condition.value || '...')}"`;
        } else {
            text = `${conditions.length} conditions`;
        }
    } else if (node.type === 'approval') {
        text = escapeHtml(data.prompt || 'Approval message required');
    } else if (node.type === 'start') {
        text = 'Uses Initial Prompt';
    } else {
        text = 'Configure this node';
    }

    const enabledToolIcons = node.type === 'agent'
        ? TOOLS_CONFIG
            .filter((t) => (data.tools || {})[t.key])
            .map((t) => `<span class="icon ${t.iconClass} icon-small node-preview-tool-icon"></span>`)
            .join('')
        : '';

    return `<span class="node-preview-text">${text}</span>${enabledToolIcons}`;
}

const ARROW_KEY_DELTAS: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
};

/** Renders node elements on the canvas (header, preview, form body, ports). */
export class NodeView {
    constructor(
        private readonly host: EditorHost,
        private readonly forms: NodeForms
    ) {}

    renderNode(node: EditorNode): void {
        const { host } = this;
        const { nodes, connections } = host.store;
        const el = document.createElement('div');
        el.className = `node box card shadowed ${node.type === 'start' ? 'start-node' : ''}`;
        el.id = node.id;
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
        el.dataset.nodeId = node.id;
        el.tabIndex = 0;
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', getNodeAccessibleName(node));
        const isSubagentTarget = node.type === 'agent' && isSubagentTargetNode(node.id, connections);
        const isSubagentCandidate =
            node.type === 'agent' &&
            (isSubagentTarget || canNodeBecomeSubagentTarget(nodes, connections, node.id));
        el.classList.toggle('subagent-target-node', isSubagentTarget);
        el.classList.toggle('subagent-candidate-node', isSubagentCandidate);
        el.classList.toggle('selected', host.store.selectedNodeId === node.id);

        if (!node.data) node.data = {};
        if (node.data.collapsed === undefined) {
            node.data.collapsed = node.type === 'start';
        }
        const hasSettings = nodeHasSettings(node);
        el.classList.toggle('expanded', !node.data.collapsed);

        // Header
        const header = document.createElement('div');
        header.className = 'node-header';

        // Title
        const title = document.createElement('span');
        title.innerHTML = getNodeLabel(node);
        header.appendChild(title);

        // Header Controls (Duplicate/Collapse/Delete)
        const controls = document.createElement('div');
        controls.className = 'node-controls';

        if (node.type === 'agent') {
            const duplicateBtn = document.createElement('button');
            duplicateBtn.type = 'button';
            duplicateBtn.className = 'button button-tertiary button-small icon-btn duplicate';
            duplicateBtn.innerHTML = '<span class="icon icon-content icon-primary" aria-hidden="true"></span>';
            duplicateBtn.title = 'Duplicate Agent';
            duplicateBtn.setAttribute('data-tooltip', 'Duplicate Agent');
            duplicateBtn.setAttribute('aria-label', 'Duplicate Agent');
            duplicateBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                host.duplicateAgentNode(node);
            });
            controls.appendChild(duplicateBtn);
        }

        if (hasSettings) {
            const collapseBtn = document.createElement('button');
            collapseBtn.type = 'button';
            collapseBtn.className = 'button button-tertiary button-small icon-btn collapse';
            collapseBtn.innerHTML = '<span class="icon icon-data-engineering icon-primary" aria-hidden="true"></span>';
            collapseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                host.toggleNodeCollapsed(node);
            });
            controls.appendChild(collapseBtn);
        }

        if (node.type !== 'start') {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'button button-tertiary button-small icon-btn delete';
            delBtn.innerHTML = '<span class="icon icon-trash icon-danger" aria-hidden="true"></span>';
            delBtn.title = 'Delete Node';
            delBtn.setAttribute('data-tooltip', 'Delete Node');
            delBtn.setAttribute('aria-label', 'Delete Node');
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                void host.requestDeleteNode(node.id);
            });
            controls.appendChild(delBtn);
        }
        header.appendChild(controls);

        // Drag Handler
        header.addEventListener('mousedown', (e) => {
            if (e.target instanceof Node && controls.contains(e.target)) return;

            e.stopPropagation();
            host.selectNode(node.id);
            host.beginNodeDrag(node, e);
        });

        header.addEventListener('dblclick', (e) => {
            if (!hasSettings) return;
            if (e.target instanceof Node && controls.contains(e.target)) return;
            e.stopPropagation();
            host.toggleNodeCollapsed(node);
        });

        el.appendChild(header);

        // Selecting by pointer anywhere in the node, or by keyboard focus on the node itself.
        el.addEventListener('mousedown', () => host.selectNode(node.id));
        el.addEventListener('focus', () => host.selectNode(node.id));
        el.addEventListener('keydown', (e) => {
            if (e.target !== el) return;
            if ((e.key === 'Enter' || e.key === ' ') && hasSettings) {
                e.preventDefault();
                host.toggleNodeCollapsed(node);
                return;
            }
            const delta = ARROW_KEY_DELTAS[e.key];
            if (delta) {
                e.preventDefault();
                host.nudgeNode(node, delta[0] * KEYBOARD_NODE_NUDGE_PX, delta[1] * KEYBOARD_NODE_NUDGE_PX);
            }
        });

        // Preview (Collapsed State)
        const preview = document.createElement('div');
        preview.className = 'node-preview';
        preview.innerHTML = getNodePreviewHTML(node, this.host.store.modelLabels);
        el.appendChild(preview);

        // Body (Form) - Only visible when expanded
        const body = document.createElement('div');
        body.className = 'node-body node-form';
        this.forms.renderNodeForm(node, body);
        el.appendChild(body);

        this.syncCollapseState(node, el);

        if (host.nodesLayer) {
            host.nodesLayer.appendChild(el);
        }

        // Render ports after mount so row-based offsets can be measured correctly.
        this.renderPorts(node, el);
    }

    /** Reflects `node.data.collapsed` on the node element and its settings button. */
    syncCollapseState(node: EditorNode, el: HTMLElement | null = document.getElementById(node.id)): void {
        if (!el) return;
        const collapsed = Boolean(node.data?.collapsed);
        el.classList.toggle('expanded', !collapsed);
        const collapseBtn = el.querySelector('.icon-btn.collapse');
        if (!(collapseBtn instanceof HTMLButtonElement)) return;
        const tooltip = collapsed ? 'Open settings' : 'Close settings';
        collapseBtn.title = tooltip;
        collapseBtn.setAttribute('data-tooltip', tooltip);
        collapseBtn.setAttribute('aria-label', tooltip);
        collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    }

    renderPorts(node: EditorNode, el: HTMLElement): void {
        renderPorts(node, el, (nodeId, handle, className, title, top, connectable) =>
            createPortElement(this.host, nodeId, handle, className, title, top, connectable));
    }

    refreshNodePorts(node: EditorNode): void {
        const el = document.getElementById(node.id);
        if (!el) return;
        el.querySelectorAll('.port').forEach((port) => port.remove());
        this.renderPorts(node, el);
    }

    updateNodeHeader(node: EditorNode): void {
        const el = document.getElementById(node.id);
        if (!el) return;
        const headerLabel = el.querySelector('.node-header span');
        if (headerLabel) {
            headerLabel.innerHTML = getNodeLabel(node);
        }
        el.setAttribute('aria-label', getNodeAccessibleName(node));
    }

    renderNodePosition(node: EditorNode): void {
        const el = document.getElementById(node.id);
        if (el) {
            el.style.left = `${node.x}px`;
            el.style.top = `${node.y}px`;
        }
    }

    updatePreview(node: EditorNode): void {
        const el = document.getElementById(node.id);
        if (!el) return;
        const preview = el.querySelector('.node-preview');
        if (preview) preview.innerHTML = getNodePreviewHTML(node, this.host.store.modelLabels);
        this.host.scheduleSave();
    }
}
