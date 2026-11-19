import type { WorkflowLogEntry } from '@agentflow/types';
import { CHAT_PINNED_THRESHOLD_PX, GENERIC_AGENT_SPINNER_KEY } from '../constants';
import { renderMarkdown } from '../markdown';
import type { ApprovalDecision, EditorNode } from '../types';
import type { ApprovalRequestCard } from './approval-card';
import { buildApprovalRequestCard, parseApprovalInputLog, renderApprovalResultCard } from './approval-card';
import { SubagentTree, isSubagentCallLogType, parseSubagentRuntimeLogPayload } from './subagent-tree';

export type ChatRole = 'system' | 'user' | 'agent' | 'error';

type PendingApproval = ApprovalRequestCard & {
    nodeId: string | null;
};

export type ChatViewDeps = {
    /** Looks a node up in the graph of the active run (or the canvas when idle). */
    getRunNodeById: (nodeId: string | null | undefined) => EditorNode | undefined;
    getPrimaryAgentName: () => string;
    onApprovalDecision: (decision: ApprovalDecision) => void;
};

function mapLogEntryToRole(entry: WorkflowLogEntry): ChatRole | null {
    const type = entry.type || '';
    if (type.includes('llm_response')) return 'agent';
    if (type.includes('llm_error') || type === 'error') return 'error';
    if (type.includes('input_received')) return 'user';
    return null;
}

function formatLogContent(entry: WorkflowLogEntry): string {
    const content: unknown = entry.content;
    return typeof content === 'string' ? content : '';
}

function getInitialPromptFromLogs(logs: WorkflowLogEntry[]): string | null {
    const entry = logs.find((item) => item?.type === 'start_prompt' && typeof item.content === 'string' && item.content.trim());
    return entry?.content ?? null;
}

/** The Run Console: messages, "agent is working" spinners and the approval card. */
export class ChatView {
    private readonly pendingAgentMessages = new Map<string, HTMLElement>();

    private readonly pendingAgentMessageCounts = new Map<string, number>();

    private readonly subagentTree = new SubagentTree((key) => this.pendingAgentMessages.get(key));

    private pendingApproval: PendingApproval | null = null;

    /** The "Approved"/"Rejected" card of a decision that is still being sent. */
    private submittedApprovalCard: HTMLElement | null = null;

    constructor(
        private readonly chatMessages: HTMLElement | null,
        private readonly deps: ChatViewDeps
    ) {}

    // --- Scrolling ---

    private isPinnedToBottom(): boolean {
        const el = this.chatMessages;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight <= CHAT_PINNED_THRESHOLD_PX;
    }

    /** Appends and follows the conversation, unless the user has scrolled up to read. */
    private append(element: HTMLElement): void {
        if (!this.chatMessages) return;
        const pinned = this.isPinnedToBottom();
        this.chatMessages.appendChild(element);
        if (pinned) {
            this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        }
    }

    // --- Messages ---

    reset(systemMessage?: string): void {
        if (!this.chatMessages) return;
        this.chatMessages.innerHTML = '';
        this.pendingAgentMessages.clear();
        this.pendingAgentMessageCounts.clear();
        this.subagentTree.clear();
        this.pendingApproval = null;
        this.submittedApprovalCard = null;
        if (systemMessage) {
            const message = document.createElement('div');
            message.className = 'chat-message system';
            message.textContent = systemMessage;
            this.chatMessages.appendChild(message);
        }
    }

    startSession(promptText: string): void {
        this.reset();
        if (promptText.trim()) {
            this.appendChatMessage(promptText, 'user');
        }
    }

    appendStatusMessage(text: string, type: string = ''): void {
        const message = document.createElement('div');
        message.className = `chat-message status ${type}`;
        message.textContent = text;
        this.append(message);
    }

    appendChatMessage(text: string, role: ChatRole = 'system', agentName?: string): void {
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
            label.textContent = agentName || this.deps.getPrimaryAgentName();
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
        this.append(message);
    }

    private getAgentNameForNode(nodeId: string): string {
        const node = this.deps.getRunNodeById(nodeId);
        return (node?.data?.agentName || '').trim() || 'Agent';
    }

    // --- Spinners ---

    hasSpinners(): boolean {
        return this.pendingAgentMessages.size > 0;
    }

    showAgentSpinner(name?: string, nodeId?: string): void {
        if (!this.chatMessages) return;
        const spinnerKey = nodeId || GENERIC_AGENT_SPINNER_KEY;
        const currentCount = this.pendingAgentMessageCounts.get(spinnerKey) ?? 0;
        this.pendingAgentMessageCounts.set(spinnerKey, currentCount + 1);
        if (currentCount > 0 && this.pendingAgentMessages.has(spinnerKey)) return;
        const resolvedName = name || this.deps.getPrimaryAgentName();
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
        dots.setAttribute('aria-hidden', 'true');
        dots.innerHTML = '<span></span><span></span><span></span>';
        body.appendChild(text);
        body.appendChild(dots);
        spinner.appendChild(body);

        this.append(spinner);
        this.pendingAgentMessages.set(spinnerKey, spinner);
    }

    hideAgentSpinner(nodeId?: string): void {
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
            this.subagentTree.clear(nodeId);
            return;
        }

        this.pendingAgentMessages.forEach((spinner) => spinner.remove());
        this.pendingAgentMessages.clear();
        this.pendingAgentMessageCounts.clear();
        this.subagentTree.clear();
    }

    // --- Approval card ---

    showApprovalMessage(nodeId: string | null): void {
        if (!this.chatMessages) return;
        this.clearApprovalMessage();
        const node = this.deps.getRunNodeById(nodeId);
        const messageText = node?.data?.prompt || 'Approval required before continuing.';
        const card = buildApprovalRequestCard(messageText, (decision) => this.deps.onApprovalDecision(decision));
        this.append(card.container);
        this.pendingApproval = { ...card, nodeId };
    }

    getPendingApprovalNodeId(): string | null {
        return this.pendingApproval?.nodeId ?? null;
    }

    clearApprovalMessage(): void {
        if (this.pendingApproval?.container) {
            this.pendingApproval.container.remove();
        }
        this.pendingApproval = null;
    }

    setApprovalButtonsDisabled(disabled: boolean): void {
        if (!this.pendingApproval) return;
        this.pendingApproval.approveBtn.disabled = disabled;
        this.pendingApproval.rejectBtn.disabled = disabled;
    }

    /** Shows the decision in place of the request while it is sent to the server. */
    replaceApprovalWithResult(decision: ApprovalDecision, note: string): void {
        if (!this.pendingApproval?.container) return;

        const container = this.pendingApproval.container;
        renderApprovalResultCard(container, decision, note);
        this.submittedApprovalCard = container;
        this.pendingApproval = null;
    }

    /** The decision reached the server; its card is now a permanent part of the log. */
    confirmSubmittedApproval(): void {
        this.submittedApprovalCard = null;
    }

    /** The decision could not be sent: remove its card so the request can be shown again. */
    discardSubmittedApproval(): void {
        this.submittedApprovalCard?.remove();
        this.submittedApprovalCard = null;
    }

    // --- Log entries ---

    private isApprovalInputLog(entry: WorkflowLogEntry): boolean {
        if (!entry || entry.type !== 'input_received') return false;
        const node = this.deps.getRunNodeById(entry.nodeId);
        // `input` is the pre-upgrade name of the approval node.
        return node?.type === 'approval' || node?.type === 'input';
    }

    private handleSubagentLogEntry(entry: WorkflowLogEntry, options: { createSpinnerIfMissing?: boolean } = {}): void {
        const payload = parseSubagentRuntimeLogPayload(entry);
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

        this.subagentTree.handleEntry(spinnerKey, entry.type, payload);
    }

    /** Applies one live log entry (from the stream, or newly seen while polling). */
    onLogEntry(entry: WorkflowLogEntry): void {
        const type = entry.type || '';
        if (type === 'step_start') {
            const node = this.deps.getRunNodeById(entry.nodeId);
            if (node?.type === 'agent') {
                this.hideAgentSpinner(GENERIC_AGENT_SPINNER_KEY);
                this.showAgentSpinner(this.getAgentNameForNode(entry.nodeId), entry.nodeId);
            }
        } else if (isSubagentCallLogType(type)) {
            this.handleSubagentLogEntry(entry);
        } else if (type === 'llm_response') {
            this.hideAgentSpinner(GENERIC_AGENT_SPINNER_KEY);
            this.hideAgentSpinner(entry.nodeId);
            this.appendChatMessage(entry.content || '', 'agent', this.getAgentNameForNode(entry.nodeId));
        } else if (type === 'llm_error' || type === 'error') {
            this.hideAgentSpinner(GENERIC_AGENT_SPINNER_KEY);
            const node = this.deps.getRunNodeById(entry.nodeId);
            if (node?.type === 'agent') {
                this.hideAgentSpinner(entry.nodeId);
            }
            this.appendChatMessage(entry.content || '', 'error');
        }
    }

    /** Rebuilds the whole conversation from a run's logs (after a reload). */
    renderChatFromLogs(logs: WorkflowLogEntry[] = []): void {
        if (!this.chatMessages) return;
        this.reset();
        const initialPromptFromLogs = getInitialPromptFromLogs(logs);
        if (initialPromptFromLogs) {
            this.appendChatMessage(initialPromptFromLogs, 'user');
        }
        const activeAgentNodeCounts = new Map<string, number>();
        const subagentEntries: WorkflowLogEntry[] = [];
        logs.forEach((entry) => {
            const entryNodeId = typeof entry?.nodeId === 'string' ? entry.nodeId : null;
            const entryNode = entryNodeId ? this.deps.getRunNodeById(entryNodeId) : undefined;
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

            if (isSubagentCallLogType(entry.type || '')) {
                subagentEntries.push(entry);
                return;
            }

            if (this.isApprovalInputLog(entry)) {
                const approvalText = formatLogContent(entry);
                if (approvalText) {
                    const { decision, note } = parseApprovalInputLog(approvalText);
                    const message = document.createElement('div');
                    renderApprovalResultCard(message, decision, note);
                    this.append(message);
                }
                return;
            }
            const role = mapLogEntryToRole(entry);
            if (!role) return;
            const text = formatLogContent(entry);
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
}
