import express, { type Express } from 'express';
import type { WorkflowLLM } from '@agentflow/workflow-engine';
import { createWorkflowRouter } from './routes/workflows.js';
import type { WorkflowRouterOptions } from './routes/workflows.js';
import { RunStore } from './store/run-store.js';

export interface CreateAppOptions {
  llm?: WorkflowLLM;
  runsDir: string;
  projectRoot: string;
  maxSteps?: number;
  store?: RunStore;
  sseHeartbeatMs?: number;
  preflight?: WorkflowRouterOptions['preflight'];
  getPublicConfig?: WorkflowRouterOptions['getPublicConfig'];
  getDefaultModel?: WorkflowRouterOptions['getDefaultModel'];
}

/**
 * Builds the API application. The web UI is served from the same origin, so no
 * CORS headers are sent: other sites cannot start runs against a local server.
 */
export function createApp(options: CreateAppOptions): { app: Express; store: RunStore } {
  const store = options.store ?? new RunStore();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(
    '/api',
    createWorkflowRouter({
      llm: options.llm,
      store,
      runsDir: options.runsDir,
      projectRoot: options.projectRoot,
      maxSteps: options.maxSteps,
      sseHeartbeatMs: options.sseHeartbeatMs,
      preflight: options.preflight,
      getPublicConfig: options.getPublicConfig,
      getDefaultModel: options.getDefaultModel
    })
  );
  return { app, store };
}
