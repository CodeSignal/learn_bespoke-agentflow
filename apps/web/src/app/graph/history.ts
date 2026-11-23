import { HISTORY_LIMIT } from '../constants';
import type { WorkflowGraphPayload } from '../types';

/** View-only fields: changing them is not an edit, so they never create an undo step. */
const VIEW_ONLY_KEYS = new Set(['collapsed', 'initialInput']);

function cloneGraph(graph: WorkflowGraphPayload): WorkflowGraphPayload {
    return JSON.parse(JSON.stringify(graph)) as WorkflowGraphPayload;
}

function fingerprint(graph: WorkflowGraphPayload): string {
    return JSON.stringify(graph, (key, value: unknown) => (VIEW_ONLY_KEYS.has(key) ? undefined : value));
}

type Snapshot = {
    graph: WorkflowGraphPayload;
    key: string;
};

/**
 * Bounded undo/redo history of graph snapshots.
 *
 * Callers `observe()` the graph after edits. Rapid edits (typing) are coalesced
 * by the caller observing on a debounce; `undo()`/`redo()` first observe the
 * live graph so an edit that has not been observed yet is never lost.
 */
export class GraphHistory {
    private past: Snapshot[] = [];

    private present: Snapshot;

    private future: Snapshot[] = [];

    constructor(initial: WorkflowGraphPayload, private readonly limit: number = HISTORY_LIMIT) {
        this.present = { graph: cloneGraph(initial), key: fingerprint(initial) };
    }

    /** Forget everything and start from `graph` (after loading or clearing). */
    reset(graph: WorkflowGraphPayload): void {
        this.past = [];
        this.future = [];
        this.present = { graph: cloneGraph(graph), key: fingerprint(graph) };
    }

    /** Records `graph` as a new step when it differs from the current one. */
    observe(graph: WorkflowGraphPayload): boolean {
        const key = fingerprint(graph);
        if (key === this.present.key) return false;
        this.past.push(this.present);
        if (this.past.length > this.limit) {
            this.past.splice(0, this.past.length - this.limit);
        }
        this.present = { graph: cloneGraph(graph), key };
        this.future = [];
        return true;
    }

    canUndo(): boolean {
        return this.past.length > 0;
    }

    canRedo(): boolean {
        return this.future.length > 0;
    }

    /** Returns the graph to restore, or null when there is nothing to undo. */
    undo(current: WorkflowGraphPayload): WorkflowGraphPayload | null {
        this.observe(current);
        const previous = this.past.pop();
        if (!previous) return null;
        this.future.push(this.present);
        this.present = previous;
        return cloneGraph(previous.graph);
    }

    /** Returns the graph to restore, or null when there is nothing to redo. */
    redo(current: WorkflowGraphPayload): WorkflowGraphPayload | null {
        if (this.observe(current)) return null;
        const next = this.future.pop();
        if (!next) return null;
        this.past.push(this.present);
        this.present = next;
        return cloneGraph(next.graph);
    }
}
