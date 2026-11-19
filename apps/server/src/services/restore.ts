import type { WorkflowLLM } from '@agentflow/workflow-engine';
import { WorkflowEngine } from '@agentflow/workflow-engine';
import { logger } from '../logger.js';
import type { RunStore } from '../store/run-store.js';
import { isValidRunId, listRunRecords } from './persistence.js';

export interface RestoreOptions {
  runsDir: string;
  store: RunStore;
  llm?: WorkflowLLM;
  maxSteps?: number;
  /** Paused runs whose record is older than this stay on disk but are not restored. */
  pausedRunTtlMs: number;
  now?: () => number;
}

/**
 * Re-hydrates persisted paused runs into memory so they can be resumed after a
 * server restart. Returns the number of restored runs.
 */
export async function restorePausedRuns(options: RestoreOptions): Promise<number> {
  const now = options.now ?? Date.now;
  let stored;
  try {
    stored = await listRunRecords(options.runsDir, (file, error) => {
      logger.warn('Skipped unreadable run file %s: %s', file, String(error));
    });
  } catch (error) {
    logger.warn('Failed to scan runs directory %s: %s', options.runsDir, String(error));
    return 0;
  }

  let restored = 0;
  for (const { record, modifiedAtMs } of stored) {
    const isResumable =
      isValidRunId(record.runId) &&
      record.status === 'paused' &&
      record.waitingForInput === true &&
      record.state !== undefined &&
      record.currentNodeId != null;
    if (!isResumable) continue;

    if (now() - modifiedAtMs > options.pausedRunTtlMs) {
      logger.info('Paused run %s expired and was not restored', record.runId);
      continue;
    }

    const engine = new WorkflowEngine(record.workflow, {
      runId: record.runId,
      llm: options.llm,
      maxSteps: options.maxSteps,
      initialState: {
        state: record.state ?? {},
        currentNodeId: record.currentNodeId ?? null,
        status: 'paused',
        waitingForInput: true,
        logs: record.logs
      }
    });
    options.store.add(engine);
    restored += 1;
    logger.info('Restored paused run %s from disk', record.runId);
  }
  return restored;
}
