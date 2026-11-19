import { RUN_ID_STORAGE_KEY, WORKFLOW_STORAGE_KEY } from './constants';
import { isValidGraphInput } from './graph/validation';
import type { WorkflowGraphPayload } from './types';

// localStorage can be unavailable (private browsing, quota), so every access
// fails silently and the editor keeps working without persistence.

export function saveStoredWorkflow(graph: WorkflowGraphPayload): void {
    try {
        localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(graph));
    } catch {
        // ignore
    }
}

/** Returns the saved workflow, or null when there is none or it is corrupted. */
export function loadStoredWorkflow(): WorkflowGraphPayload | null {
    try {
        const raw = localStorage.getItem(WORKFLOW_STORAGE_KEY);
        if (!raw) return null;
        const graph = JSON.parse(raw) as unknown;
        if (isValidGraphInput(graph) && graph.nodes.length > 0) {
            return graph;
        }
    } catch {
        // corrupted storage
    }
    return null;
}

export async function fetchDefaultWorkflow(): Promise<WorkflowGraphPayload | null> {
    try {
        const res = await fetch('/api/default-workflow');
        if (!res.ok) return null;
        const graph = await res.json() as unknown;
        return isValidGraphInput(graph) ? graph : null;
    } catch {
        return null;
    }
}

export function saveStoredRunId(runId: string): void {
    try { localStorage.setItem(RUN_ID_STORAGE_KEY, runId); } catch { /* ignore */ }
}

export function clearStoredRunId(): void {
    try { localStorage.removeItem(RUN_ID_STORAGE_KEY); } catch { /* ignore */ }
}

export function getStoredRunId(): string | null {
    try { return localStorage.getItem(RUN_ID_STORAGE_KEY); } catch { return null; }
}
