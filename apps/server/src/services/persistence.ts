import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowRunRecord } from '@agentflow/types';

/** Run ids become file names, so only a conservative character set is accepted. */
export const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidRunId(runId: unknown): runId is string {
  return typeof runId === 'string' && RUN_ID_PATTERN.test(runId);
}

function runFilePath(runsDir: string, runId: string): string {
  if (!isValidRunId(runId)) {
    throw new Error(`Invalid run id "${runId}"`);
  }
  return path.join(runsDir, `run_${runId}.json`);
}

export async function saveRunRecord(runsDir: string, record: WorkflowRunRecord): Promise<void> {
  await fs.mkdir(runsDir, { recursive: true });
  const filePath = runFilePath(runsDir, record.runId);
  // Write to a temporary file first so a crash never leaves a truncated record.
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(record, null, 2), 'utf-8');
  await fs.rename(tempPath, filePath);
}

export async function readRunRecord(runsDir: string, runId: string): Promise<WorkflowRunRecord | null> {
  try {
    const raw = await fs.readFile(runFilePath(runsDir, runId), 'utf-8');
    return JSON.parse(raw) as WorkflowRunRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export interface StoredRunFile {
  record: WorkflowRunRecord;
  modifiedAtMs: number;
}

/** Reads every readable run record; unreadable files are reported and skipped. */
export async function listRunRecords(
  runsDir: string,
  onSkip: (file: string, error: unknown) => void = () => {}
): Promise<StoredRunFile[]> {
  let files: string[];
  try {
    files = (await fs.readdir(runsDir)).filter((f) => f.startsWith('run_') && f.endsWith('.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const results: StoredRunFile[] = [];
  for (const file of files) {
    const filePath = path.join(runsDir, file);
    try {
      const [raw, stats] = await Promise.all([fs.readFile(filePath, 'utf-8'), fs.stat(filePath)]);
      results.push({ record: JSON.parse(raw) as WorkflowRunRecord, modifiedAtMs: stats.mtimeMs });
    } catch (error) {
      onSkip(file, error);
    }
  }
  return results;
}
