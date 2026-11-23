import type { WorkflowGraph, WorkflowLogEntry, WorkflowRunResult } from '@agentflow/types';
import {
    ApiError,
    cancelWorkflow,
    fetchRun,
    resumeWorkflowStream,
    runWorkflowStream
} from '../../services/api';
import type { ChatView } from '../chat/chat-view';
import { RUN_POLL_INTERVAL_MS } from '../constants';
import { clearStoredRunId, getStoredRunId, saveStoredRunId } from '../persistence';
import type { ApprovalDecision, EditorNode, WorkflowGraphPayload, WorkflowState } from '../types';

export type RunControllerDeps = {
    chat: ChatView;
    /** The canvas graph as it is now. */
    getGraph: () => WorkflowGraphPayload;
    getPromptValue: () => string;
    /** Called just before a run starts so the canvas can upgrade/normalise itself. */
    prepareGraphForRun: () => void;
    onStateChange: (state: WorkflowState) => void;
};

export function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function cloneGraphPayload(graph: WorkflowGraphPayload): WorkflowGraphPayload {
    return JSON.parse(JSON.stringify(graph)) as WorkflowGraphPayload;
}

function extractWaitingNodeId(logs: WorkflowLogEntry[] = []): string | null {
    if (!Array.isArray(logs)) return null;
    for (let i = logs.length - 1; i >= 0; i -= 1) {
        if (logs[i].type === 'wait_input') {
            return logs[i].nodeId;
        }
    }
    return null;
}

/**
 * Runs workflows on the server and tracks the run through its states:
 * idle -> running -> (paused -> running)* -> idle.
 *
 * It owns starting, resuming (approval decisions), cancelling, and recovering
 * a run after a page reload. A run keeps going on the server when the page
 * goes away; only `cancel()` stops it.
 */
export class RunController {
    private state: WorkflowState = 'idle';

    private currentRunId: string | null = null;

    /** Snapshot of the graph the active run was started with. */
    private activeRunGraph: WorkflowGraphPayload | null = null;

    private activeRunController: AbortController | null = null;

    private pollTimer: ReturnType<typeof setTimeout> | null = null;

    private cancelling = false;

    constructor(private readonly deps: RunControllerDeps) {}

    getState(): WorkflowState {
        return this.state;
    }

    isCancelling(): boolean {
        return this.cancelling;
    }

    private setState(state: WorkflowState): void {
        this.state = state;
        this.deps.onStateChange(state);
    }

    // --- Graph of the active run ---

    private setActiveRunGraph(graph: WorkflowGraphPayload | null): void {
        this.activeRunGraph = graph ? cloneGraphPayload(graph) : null;
    }

    private syncActiveRunGraphFromResult(result: WorkflowRunResult): void {
        const workflow: WorkflowGraph | undefined = result.workflow;
        if (!workflow || !Array.isArray(workflow.nodes) || !Array.isArray(workflow.connections)) return;
        this.setActiveRunGraph({
            nodes: workflow.nodes as EditorNode[],
            connections: workflow.connections
        });
    }

    getRunNodes(): EditorNode[] {
        return this.activeRunGraph?.nodes ?? this.deps.getGraph().nodes;
    }

    getRunNodeById(nodeId: string | null | undefined): EditorNode | undefined {
        if (!nodeId) return undefined;
        return this.getRunNodes().find((node) => node.id === nodeId);
    }

    getPrimaryAgentName(): string {
        const agentNode = this.getRunNodes().find((n) => n.type === 'agent');
        const name = (agentNode?.data?.agentName || '').trim();
        return name || 'Agent';
    }

    // --- Stored run id / polling ---

    private clearRunId(): void {
        clearStoredRunId();
        if (this.pollTimer !== null) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /** Ends the run locally and returns to idle. */
    private finishRun(): void {
        this.clearRunId();
        this.currentRunId = null;
        this.setActiveRunGraph(null);
        this.setState('idle');
    }

    /** Forgets any run (after the canvas is cleared). */
    reset(): void {
        this.activeRunController?.abort();
        this.activeRunController = null;
        this.cancelling = false;
        this.finishRun();
    }

    // --- Run ---

    async run(): Promise<void> {
        // Don't start new workflow if already running or paused
        if (this.state !== 'idle') return;

        this.deps.prepareGraphForRun();
        const liveGraph = this.deps.getGraph();
        const startNode = liveGraph.nodes.find((n) => n.type === 'start');
        if (!startNode) return;

        this.setState('running');

        const prompt = this.deps.getPromptValue();
        this.deps.chat.startSession(prompt);

        // Update Start Node with initial input
        if (!startNode.data) startNode.data = {};
        startNode.data.initialInput = prompt;

        const graph = cloneGraphPayload(liveGraph);
        this.setActiveRunGraph(graph);
        const controller = new AbortController();
        this.activeRunController = controller;

        try {
            const result = await runWorkflowStream(
                graph,
                (entry) => this.deps.chat.onLogEntry(entry),
                {
                    signal: controller.signal,
                    onStart: (id) => {
                        this.currentRunId = id;
                        saveStoredRunId(id);
                    }
                }
            );
            this.handleRunResult(result, true);
        } catch (e) {
            if (isAbortError(e)) return;
            this.deps.chat.appendChatMessage(getErrorMessage(e), 'error');
            this.deps.chat.appendStatusMessage('Failed', 'failed');
            this.deps.chat.hideAgentSpinner();
            this.finishRun();
        } finally {
            if (this.activeRunController === controller) {
                this.activeRunController = null;
            }
        }
    }

    handleRunResult(result: WorkflowRunResult, fromStream = false): void {
        const { chat } = this.deps;
        this.syncActiveRunGraphFromResult(result);
        if (!fromStream && result.logs) {
            chat.renderChatFromLogs(result.logs);
        }
        const hasLlmError = Array.isArray(result.logs)
            ? result.logs.some((entry) => (entry?.type || '').includes('llm_error'))
            : false;

        if (result.status === 'paused' && result.waitingForInput) {
            chat.hideAgentSpinner();
            this.currentRunId = result.runId;
            saveStoredRunId(result.runId);
            const pausedNodeId = result.currentNodeId || extractWaitingNodeId(result.logs);
            chat.showApprovalMessage(pausedNodeId);
            this.setState('paused');
            return;
        }

        chat.clearApprovalMessage();
        chat.hideAgentSpinner();
        if (result.status === 'completed') {
            if (hasLlmError) {
                chat.appendStatusMessage('Failed', 'failed');
            } else {
                chat.appendStatusMessage('Completed', 'completed');
            }
        } else if (result.status === 'failed') {
            chat.appendStatusMessage('Failed', 'failed');
        } else if (result.status === 'cancelled') {
            chat.appendStatusMessage('Cancelled');
        }
        this.finishRun();
    }

    // --- Cancel ---

    /**
     * Stops the active run, running or paused. The server is told first (closing
     * the stream alone would leave the run going); the local stream is then
     * dropped. If the request fails the run is left as it is so Cancel can be retried.
     */
    async cancel(): Promise<void> {
        if (this.state === 'idle' || this.cancelling) return;
        const { chat } = this.deps;
        const runId = this.currentRunId ?? getStoredRunId();

        this.cancelling = true;
        this.deps.onStateChange(this.state);
        try {
            if (runId) {
                await cancelWorkflow(runId);
            }
        } catch (e) {
            this.cancelling = false;
            chat.appendChatMessage(`Could not cancel the workflow: ${getErrorMessage(e)}`, 'error');
            this.deps.onStateChange(this.state);
            return;
        }
        this.cancelling = false;

        // The stream may already have delivered the cancelled result while we waited.
        if (this.getState() === 'idle') {
            this.deps.onStateChange('idle');
            return;
        }

        if (this.activeRunController) {
            this.activeRunController.abort();
            this.activeRunController = null;
        }
        chat.hideAgentSpinner();
        chat.clearApprovalMessage();
        chat.discardSubmittedApproval();
        chat.appendStatusMessage('Cancelled');
        this.finishRun();
    }

    // --- Recovery after reload ---

    async recover(): Promise<void> {
        const runId = getStoredRunId();
        if (!runId) return;
        const { chat } = this.deps;

        let result: WorkflowRunResult | null;
        try {
            result = await fetchRun(runId);
        } catch {
            // Transient error (network blip, server 5xx) — don't clear the stored
            // runId so recovery can be reattempted on the next page load.
            return;
        }
        if (!result) {
            // 404 — run genuinely gone
            this.clearRunId();
            this.setActiveRunGraph(null);
            return;
        }

        this.syncActiveRunGraphFromResult(result);

        if (result.status === 'running') {
            // Engine still executing on server — show partial chat and poll for updates
            this.currentRunId = runId;
            chat.renderChatFromLogs(result.logs);
            if (!chat.hasSpinners()) {
                chat.showAgentSpinner();
            }
            this.setState('running');
            this.pollForRun(runId, result.logs.length);
        } else if (result.status === 'paused' && !result.waitingForInput) {
            // Engine was lost (corrupt record) — the run can't be resumed;
            // show what ran and return to idle.
            chat.renderChatFromLogs(result.logs);
            chat.appendStatusMessage('Previous paused run was lost (server restarted).', 'failed');
            this.finishRun();
        } else {
            // completed, failed, cancelled, or paused-with-waitingForInput
            // (fromStream=false → handleRunResult renders the chat from the logs)
            this.handleRunResult(result);
        }
    }

    private pollForRun(runId: string, knownLogCount: number): void {
        this.pollTimer = setTimeout(async () => {
            this.pollTimer = null;
            let result: WorkflowRunResult | null;
            try {
                result = await fetchRun(runId);
            } catch {
                // Transient error — keep the runId and retry on next poll cycle.
                if (getStoredRunId() === runId) this.pollForRun(runId, knownLogCount);
                return;
            }
            // Guard: bail out if this run was cancelled or replaced while the
            // request was in-flight (clearRunId() can't cancel an already-fired timer).
            if (getStoredRunId() !== runId) return;
            if (!result) {
                // 404 — run is genuinely gone from server and disk
                this.deps.chat.hideAgentSpinner();
                this.finishRun();
                return;
            }
            this.syncActiveRunGraphFromResult(result);
            const logs = Array.isArray(result.logs) ? result.logs : [];
            // Apply only the entries that arrived since the last poll, so the
            // conversation is not rebuilt (and the scroll position not lost).
            logs.slice(knownLogCount).forEach((entry) => this.deps.chat.onLogEntry(entry));
            if (result.status === 'running') {
                this.pollForRun(runId, logs.length); // keep polling
            } else {
                this.handleRunResult(result, true);
            }
        }, RUN_POLL_INTERVAL_MS);
    }

    // --- Resume (approval decision) ---

    async submitApprovalDecision(decision: ApprovalDecision): Promise<void> {
        const runId = this.currentRunId;
        if (!runId || this.state !== 'paused') return;
        const { chat } = this.deps;
        const pausedNodeId = chat.getPendingApprovalNodeId();
        chat.setApprovalButtonsDisabled(true);
        const note = '';
        chat.replaceApprovalWithResult(decision, note);
        this.setState('running');
        chat.showAgentSpinner();
        const controller = new AbortController();
        this.activeRunController = controller;

        try {
            const result = await resumeWorkflowStream(
                runId,
                { decision, note },
                (entry) => {
                    // The first event proves the server accepted the decision.
                    chat.confirmSubmittedApproval();
                    chat.onLogEntry(entry);
                },
                { signal: controller.signal }
            );
            chat.confirmSubmittedApproval();
            this.handleRunResult(result, true);
        } catch (e) {
            if (isAbortError(e)) return;
            chat.hideAgentSpinner();
            chat.appendChatMessage(getErrorMessage(e), 'error');
            await this.recoverFromFailedResume(runId, pausedNodeId, e);
        } finally {
            if (this.activeRunController === controller) {
                this.activeRunController = null;
            }
        }
    }

    /**
     * After a resume request failed, find out where the run really is. If it is
     * still waiting for the decision, put the approval card back so the user can
     * retry; otherwise show the state the server reports.
     */
    private async recoverFromFailedResume(runId: string, pausedNodeId: string | null, error: unknown): Promise<void> {
        const { chat } = this.deps;
        let latest: WorkflowRunResult | null | undefined;
        try {
            latest = await fetchRun(runId);
        } catch {
            latest = undefined; // server unreachable: assume the run is still paused
        }
        // Cancel may have ended the run while we were asking.
        if (this.currentRunId !== runId) return;

        const runIsGone = latest === null || (error instanceof ApiError && error.status === 404 && latest === undefined);
        if (runIsGone) {
            chat.confirmSubmittedApproval();
            chat.appendStatusMessage('Failed', 'failed');
            this.finishRun();
            return;
        }

        if (latest && !(latest.status === 'paused' && latest.waitingForInput)) {
            if (latest.status === 'running') {
                // The decision did reach the server; follow the run by polling.
                chat.confirmSubmittedApproval();
                chat.showAgentSpinner();
                saveStoredRunId(runId);
                this.pollForRun(runId, Array.isArray(latest.logs) ? latest.logs.length : 0);
                return;
            }
            chat.confirmSubmittedApproval();
            this.handleRunResult(latest);
            return;
        }

        chat.discardSubmittedApproval();
        chat.appendStatusMessage('The decision was not sent. Choose again to retry, or cancel the run.', 'failed');
        chat.showApprovalMessage(latest?.currentNodeId ?? pausedNodeId);
        this.setState('paused');
    }
}
