import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowRunRecord } from '@agentic/types';

export async function saveRunRecord(runsDir: string, record: WorkflowRunRecord): Promise<void> {
  await fs.mkdir(runsDir, { recursive: true });
  const filePath = path.join(runsDir, `run_${record.runId}.json`);
  await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8');
}
