import path from 'node:path';
import { DEFAULT_MAX_STEPS } from '@agentic/workflow-engine';

const FALLBACK_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const PROJECT_ROOT = process.env.PROJECT_ROOT || FALLBACK_ROOT;
const DEFAULT_PAUSED_RUN_TTL_HOURS = 24;

function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  runsDir: path.resolve(PROJECT_ROOT, 'data', 'runs'),
  projectRoot: PROJECT_ROOT,
  openAiApiKey: process.env.OPENAI_API_KEY ?? '',
  /** Node executions allowed per run or resume before a loop is stopped. */
  maxSteps: Math.floor(positiveNumber(process.env.WORKFLOW_MAX_STEPS, DEFAULT_MAX_STEPS)),
  /** Paused runs older than this are not restored into memory on startup. */
  pausedRunTtlMs:
    positiveNumber(process.env.PAUSED_RUN_TTL_HOURS, DEFAULT_PAUSED_RUN_TTL_HOURS) * 60 * 60 * 1000
};

export type AppConfig = typeof config;
