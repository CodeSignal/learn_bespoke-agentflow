import fs from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import type { WorkflowGraph, WorkflowLogEntry, WorkflowRunRecord, WorkflowRunResult } from '@agentflow/types';
import type { WorkflowLLM } from '@agentflow/workflow-engine';
import { WorkflowEngine, validateWorkflowGraph } from '@agentflow/workflow-engine';
import type { RunStore } from '../store/run-store.js';
import { isValidRunId, readRunRecord, saveRunRecord } from '../services/persistence.js';
import { logger } from '../logger.js';

const DEFAULT_SSE_HEARTBEAT_MS = 15_000;

export interface WorkflowRouterOptions {
  llm?: WorkflowLLM;
  store: RunStore;
  runsDir: string;
  projectRoot: string;
  maxSteps?: number;
  /** Interval between SSE comment lines that keep idle proxies from closing the stream. */
  sseHeartbeatMs?: number;
}

type StreamEvent =
  | { type: 'start'; runId: string }
  | { type: 'log'; entry: WorkflowLogEntry }
  | { type: 'done'; result: WorkflowRunResult }
  | { type: 'error'; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isResumeInput(input: unknown): input is string | Record<string, unknown> | undefined {
  return (
    input === undefined ||
    typeof input === 'string' ||
    (typeof input === 'object' && input !== null && !Array.isArray(input))
  );
}

export function createWorkflowRouter(options: WorkflowRouterOptions): Router {
  const { llm, store, runsDir, projectRoot, maxSteps } = options;
  const heartbeatMs = options.sseHeartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS;
  const router = createRouter();

  const withWorkflow = (engine: WorkflowEngine, result: WorkflowRunResult): WorkflowRunResult => ({
    ...result,
    workflow: engine.getGraph()
  });

  const persist = async (engine: WorkflowEngine, result: WorkflowRunResult): Promise<void> => {
    const record: WorkflowRunRecord = {
      runId: result.runId,
      workflow: engine.getGraph(),
      logs: result.logs,
      status: result.status,
      state: result.state,
      currentNodeId: result.currentNodeId,
      waitingForInput: result.waitingForInput
    };
    try {
      await saveRunRecord(runsDir, record);
    } catch (error) {
      logger.error('Failed to persist run result', error);
    }
  };

  /**
   * Runs one engine step (`run` or `resume`) under the per-run lock, persists
   * the outcome and drops finished runs from memory.
   */
  const execute = async (
    engine: WorkflowEngine,
    step: () => Promise<WorkflowRunResult>,
    onLog?: (entry: WorkflowLogEntry) => void
  ): Promise<WorkflowRunResult> => {
    const runId = engine.getRunId();
    engine.setOnLog(onLog);
    try {
      const result = await step();
      await persist(engine, result);
      if (result.status !== 'paused') {
        store.remove(runId);
      }
      return withWorkflow(engine, result);
    } finally {
      engine.setOnLog(undefined);
      store.unlock(runId);
    }
  };

  /** Validates a run request. Sends the error response and returns null when invalid. */
  const parseRunRequest = (req: Request, res: Response): WorkflowGraph | null => {
    const validation = validateWorkflowGraph((req.body as { graph?: unknown } | undefined)?.graph);
    if (!validation.ok) {
      res.status(400).json({ error: 'Invalid workflow graph payload', details: validation.errors });
      return null;
    }
    const hasAgentNode = validation.graph.nodes.some((node) => node.type === 'agent');
    if (hasAgentNode && !llm) {
      res.status(503).json({ error: 'OPENAI_API_KEY is required to run workflows with Agent nodes.' });
      return null;
    }
    return validation.graph;
  };

  const startEngine = (graph: WorkflowGraph): WorkflowEngine => {
    const engine = new WorkflowEngine(graph, { llm, maxSteps });
    store.add(engine);
    store.tryLock(engine.getRunId());
    return engine;
  };

  /** Finds a paused run and takes its lock. Sends the error response and returns null on failure. */
  const acquireResumableRun = (req: Request, res: Response): { engine: WorkflowEngine; input: string | Record<string, unknown> | undefined } | null => {
    const { runId, input } = (req.body ?? {}) as { runId?: unknown; input?: unknown };
    if (!isValidRunId(runId)) {
      res.status(400).json({ error: 'runId is required' });
      return null;
    }
    if (!isResumeInput(input)) {
      res.status(400).json({ error: 'input must be a string or an object' });
      return null;
    }
    const engine = store.get(runId);
    if (!engine) {
      res.status(404).json({ error: 'Run ID not found' });
      return null;
    }
    if (!store.tryLock(runId)) {
      res.status(409).json({ error: 'Run is already executing. Wait for it to pause before resuming.' });
      return null;
    }
    return { engine, input };
  };

  const openEventStream = (res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let open = true;
    const heartbeat = setInterval(() => {
      if (open) res.write(': ping\n\n');
    }, heartbeatMs);
    heartbeat.unref();
    // A closed stream does not cancel the run: the client can reload and pick
    // it up again through GET /run/:runId. Cancelling is explicit (POST /cancel).
    res.on('close', () => {
      open = false;
      clearInterval(heartbeat);
    });

    return {
      send: (event: StreamEvent) => {
        if (open) res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
      end: () => {
        clearInterval(heartbeat);
        if (open) res.end();
      }
    };
  };

  const streamExecution = async (
    res: Response,
    engine: WorkflowEngine,
    step: () => Promise<WorkflowRunResult>
  ): Promise<void> => {
    const stream = openEventStream(res);
    try {
      stream.send({ type: 'start', runId: engine.getRunId() });
      const result = await execute(engine, step, (entry) => stream.send({ type: 'log', entry }));
      stream.send({ type: 'done', result });
    } catch (error) {
      const message = errorMessage(error);
      logger.error('Workflow stream failed', message);
      stream.send({ type: 'error', message });
    } finally {
      stream.end();
    }
  };

  const respondWithExecution = async (
    res: Response,
    engine: WorkflowEngine,
    step: () => Promise<WorkflowRunResult>
  ): Promise<void> => {
    try {
      res.json(await execute(engine, step));
    } catch (error) {
      const message = errorMessage(error);
      logger.error('Workflow execution failed', message);
      res.status(500).json({ error: 'Failed to execute workflow', details: message });
    }
  };

  router.post('/run', async (req: Request, res: Response) => {
    const graph = parseRunRequest(req, res);
    if (!graph) return;
    const engine = startEngine(graph);
    await respondWithExecution(res, engine, () => engine.run());
  });

  router.post('/run-stream', async (req: Request, res: Response) => {
    const graph = parseRunRequest(req, res);
    if (!graph) return;
    const engine = startEngine(graph);
    await streamExecution(res, engine, () => engine.run());
  });

  router.post('/resume', async (req: Request, res: Response) => {
    const run = acquireResumableRun(req, res);
    if (!run) return;
    await respondWithExecution(res, run.engine, () => run.engine.resume(run.input));
  });

  router.post('/resume-stream', async (req: Request, res: Response) => {
    const run = acquireResumableRun(req, res);
    if (!run) return;
    await streamExecution(res, run.engine, () => run.engine.resume(run.input));
  });

  router.post('/cancel', async (req: Request, res: Response) => {
    const { runId } = (req.body ?? {}) as { runId?: unknown };
    if (!isValidRunId(runId)) {
      res.status(400).json({ error: 'runId is required' });
      return;
    }
    const engine = store.get(runId);
    if (!engine || !engine.cancel()) {
      res.status(404).json({ error: 'Run is not active' });
      return;
    }

    const result = engine.getResult();
    // A run that is executing is persisted and removed by the request that
    // drives it, once its in-flight calls have unwound. A paused run has no
    // such request, so it is finalised here.
    if (!store.isBusy(runId)) {
      await persist(engine, result);
      store.remove(runId);
    }
    res.json(withWorkflow(engine, result));
  });

  router.get('/run/:runId', async (req: Request, res: Response) => {
    const { runId } = req.params;
    if (!isValidRunId(runId)) {
      res.status(400).json({ error: 'Invalid runId' });
      return;
    }

    // In-memory first: covers runs that are still executing or paused.
    const engine = store.get(runId);
    if (engine) {
      res.json(withWorkflow(engine, engine.getResult()));
      return;
    }

    try {
      const record = await readRunRecord(runsDir, runId);
      if (!record) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      const result: WorkflowRunResult = {
        runId: record.runId,
        status: record.status,
        logs: record.logs,
        state: record.state ?? {},
        waitingForInput: record.waitingForInput ?? false,
        currentNodeId: record.currentNodeId ?? null,
        workflow: record.workflow
      };
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to read run record', details: errorMessage(error) });
    }
  });

  const readProjectJson = async (fileName: string): Promise<unknown | undefined> => {
    try {
      return JSON.parse(await fs.readFile(path.join(projectRoot, '.config', fileName), 'utf-8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  };

  router.get('/default-workflow', async (_req: Request, res: Response) => {
    try {
      const graph = await readProjectJson('default-workflow.json');
      if (graph === undefined) {
        res.status(404).json({ error: 'No default workflow found' });
        return;
      }
      const validation = validateWorkflowGraph(graph);
      if (!validation.ok) {
        res.status(400).json({
          error: 'default-workflow.json is not a valid workflow graph',
          details: validation.errors
        });
        return;
      }
      res.json(validation.graph);
    } catch (error) {
      const message = errorMessage(error);
      logger.error('Failed to read default workflow', message);
      res.status(500).json({ error: 'Failed to read default workflow', details: message });
    }
  });

  router.get('/config', async (_req: Request, res: Response) => {
    try {
      const appConfig = await readProjectJson('config.json');
      if (appConfig === undefined) {
        res.status(404).json({ error: 'No config found' });
        return;
      }
      res.json(appConfig);
    } catch (error) {
      const message = errorMessage(error);
      logger.error('Failed to read config', message);
      res.status(500).json({ error: 'Failed to read config', details: message });
    }
  });

  return router;
}
