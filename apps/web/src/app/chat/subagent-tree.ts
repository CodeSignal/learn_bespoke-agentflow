import type { WorkflowLogEntry } from '@agentflow/types';
import type { SubagentCallStatus, SubagentRuntimeLogPayload } from '../types';

export function isSubagentCallLogType(type: string): boolean {
    return (
        type === 'subagent_call_start' ||
        type === 'subagent_call_end' ||
        type === 'subagent_call_error'
    );
}

export function parseSubagentRuntimeLogPayload(entry: WorkflowLogEntry): SubagentRuntimeLogPayload | null {
    if (!isSubagentCallLogType(entry?.type || '')) {
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

/**
 * The nested list of subagent calls shown inside an agent's "is working"
 * spinner message. Spinner elements are owned by the chat view and looked up
 * by key through `getSpinner`.
 */
export class SubagentTree {
    private readonly callElements = new Map<string, HTMLElement>();

    private readonly callSpinnerKeys = new Map<string, string>();

    private readonly spinnerCallIds = new Map<string, Set<string>>();

    private readonly callStatuses = new Map<string, SubagentCallStatus>();

    constructor(private readonly getSpinner: (spinnerKey: string) => HTMLElement | undefined) {}

    /** Forgets the calls of one spinner, or of all spinners when no key is given. */
    clear(spinnerKey?: string): void {
        if (spinnerKey) {
            const callIds = this.spinnerCallIds.get(spinnerKey);
            if (callIds) {
                callIds.forEach((callId) => {
                    this.callElements.delete(callId);
                    this.callSpinnerKeys.delete(callId);
                    this.callStatuses.delete(callId);
                });
            }
            this.spinnerCallIds.delete(spinnerKey);
            return;
        }

        this.callElements.clear();
        this.callSpinnerKeys.clear();
        this.spinnerCallIds.clear();
        this.callStatuses.clear();
    }

    /** Applies one subagent log entry to the spinner identified by `spinnerKey`. */
    handleEntry(spinnerKey: string, type: string, payload: SubagentRuntimeLogPayload): void {
        if (type === 'subagent_call_start') {
            const item = this.ensureCallItem(spinnerKey, payload);
            if (item) {
                this.setCallItemStatus(payload.callId, 'running');
            }
            this.updateSummary(spinnerKey);
            return;
        }

        const mappedStatus = type === 'subagent_call_error' ? 'failed' : 'completed';
        this.setCallItemStatus(payload.callId, mappedStatus, payload.message);
        this.updateSummary(spinnerKey);
    }

    private ensureList(spinner: HTMLElement): HTMLElement {
        const existing = spinner.querySelector('.chat-subagent-list');
        if (existing instanceof HTMLElement) {
            return existing;
        }
        const created = document.createElement('div');
        created.className = 'chat-subagent-list';
        spinner.appendChild(created);
        return created;
    }

    private ensureSummary(spinner: HTMLElement): HTMLElement {
        const existing = spinner.querySelector('.chat-subagent-summary');
        if (existing instanceof HTMLElement) {
            return existing;
        }

        const list = this.ensureList(spinner);
        const created = document.createElement('div');
        created.className = 'chat-subagent-summary';
        spinner.insertBefore(created, list);
        return created;
    }

    private updateToggleState(item: HTMLElement): void {
        const toggle = item.querySelector('.chat-subagent-toggle');
        if (!(toggle instanceof HTMLButtonElement)) return;

        const hasChildren = item.classList.contains('has-children');
        if (!hasChildren) {
            toggle.hidden = true;
            toggle.disabled = true;
            toggle.textContent = '';
            toggle.removeAttribute('aria-label');
            toggle.removeAttribute('aria-expanded');
            return;
        }

        const isCollapsed = item.classList.contains('collapsed');
        toggle.hidden = false;
        toggle.disabled = false;
        toggle.textContent = isCollapsed ? '▸' : '▾';
        toggle.setAttribute('aria-label', isCollapsed ? 'Expand nested subagents' : 'Collapse nested subagents');
        toggle.setAttribute('aria-expanded', String(!isCollapsed));
    }

    private markItemHasChildren(callId: string): void {
        const parentItem = this.callElements.get(callId);
        if (!parentItem) return;
        parentItem.classList.add('has-children');
        parentItem.classList.remove('collapsed');
        this.updateToggleState(parentItem);
    }

    private updateSummary(spinnerKey: string): void {
        const spinner = this.getSpinner(spinnerKey);
        if (!spinner) return;

        const callIds = this.spinnerCallIds.get(spinnerKey);
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
            const status = this.callStatuses.get(callId);
            if (status === 'running') running += 1;
            else if (status === 'completed') completed += 1;
            else if (status === 'failed') failed += 1;
        });

        const summary = this.ensureSummary(spinner);
        const parts = [`${running} running`, `${completed} done`];
        if (failed > 0) {
            parts.push(`${failed} failed`);
        }
        summary.textContent = `Subagents: ${parts.join(' · ')}`;
    }

    private ensureCallItem(spinnerKey: string, payload: SubagentRuntimeLogPayload): HTMLElement | null {
        const existing = this.callElements.get(payload.callId);
        if (existing) {
            return existing;
        }

        const spinner = this.getSpinner(spinnerKey);
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
            this.updateToggleState(item);
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
                this.markItemHasChildren(payload.parentCallId);
                return this.callElements.get(payload.parentCallId)?.querySelector('.chat-subagent-children');
            })()
            : null;
        const hostContainer = parentContainer instanceof HTMLElement
            ? parentContainer
            : this.ensureList(spinner);
        hostContainer.appendChild(item);
        this.updateToggleState(item);

        this.callElements.set(payload.callId, item);
        this.callSpinnerKeys.set(payload.callId, spinnerKey);
        const callIdsForSpinner = this.spinnerCallIds.get(spinnerKey) ?? new Set<string>();
        callIdsForSpinner.add(payload.callId);
        this.spinnerCallIds.set(spinnerKey, callIdsForSpinner);
        return item;
    }

    private setCallItemStatus(
        callId: string,
        statusClass: SubagentCallStatus,
        message?: string
    ): void {
        const item = this.callElements.get(callId);
        if (!item) return;
        this.callStatuses.set(callId, statusClass);
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
            statusEl.setAttribute('aria-label', 'Done');
            statusEl.textContent = '✓';
            return;
        }
        statusEl.removeAttribute('aria-label');
        statusEl.textContent = message && message.trim() ? message.trim() : 'Failed';
    }
}
