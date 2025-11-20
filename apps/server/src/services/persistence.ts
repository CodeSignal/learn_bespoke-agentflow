import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkflowRunResult } from '@agentic/types';

export async function saveRunLog(runsDir: string, result: WorkflowRunResult): Promise<void> {
  const filePath = path.join(runsDir, `run_${result.runId}.json`);
  await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf-8');
}

