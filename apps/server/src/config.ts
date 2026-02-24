import fs from 'node:fs';
import path from 'node:path';

const FALLBACK_ROOT = path.resolve(__dirname, '..', '..', '..');
const PROJECT_ROOT = process.env.PROJECT_ROOT || FALLBACK_ROOT;
const RUNS_DIR = path.resolve(PROJECT_ROOT, 'data', 'runs');

fs.mkdirSync(RUNS_DIR, { recursive: true });

export const config = {
  port: Number(process.env.PORT ?? 3000),
  runsDir: RUNS_DIR,
  projectRoot: PROJECT_ROOT,
  openAiApiKey: process.env.OPENAI_API_KEY ?? ''
};
