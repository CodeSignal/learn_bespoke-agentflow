import type { WorkflowEngine } from '@agentflow/workflow-engine';

/** In-memory registry of runs that are executing or paused. */
export class RunStore {
  private readonly engines = new Map<string, WorkflowEngine>();

  /** Runs with an in-flight `run()` or `resume()` call. */
  private readonly busy = new Set<string>();

  add(engine: WorkflowEngine): void {
    this.engines.set(engine.getRunId(), engine);
  }

  get(runId: string): WorkflowEngine | undefined {
    return this.engines.get(runId);
  }

  remove(runId: string): void {
    this.engines.delete(runId);
    this.busy.delete(runId);
  }

  /** Returns false if another request is already executing this run. */
  tryLock(runId: string): boolean {
    if (this.busy.has(runId)) return false;
    this.busy.add(runId);
    return true;
  }

  unlock(runId: string): void {
    this.busy.delete(runId);
  }

  isBusy(runId: string): boolean {
    return this.busy.has(runId);
  }

  get size(): number {
    return this.engines.size;
  }
}
