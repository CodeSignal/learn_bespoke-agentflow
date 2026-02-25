import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import type { WorkflowGraph, WorkflowRunRecord, WorkflowRunResult } from '@agentic/types';
import type { WorkflowLLM } from '@agentic/workflow-engine';
import WorkflowEngine from '@agentic/workflow-engine';
import { addWorkflow, getWorkflow, removeWorkflow } from '../store/active-workflows';
import { saveRunRecord } from '../services/persistence';
import { config } from '../config';
import { logger } from '../logger';

function validateGraph(graph: WorkflowGraph | undefined): graph is WorkflowGraph {
  return Boolean(graph && Array.isArray(graph.nodes) && Array.isArray(graph.connections));
}

async function persistResult(engine: WorkflowEngine, result: WorkflowRunResult) {
  try {
    // Backward compatibility: fall back to reading the private graph field if the engine
    // instance doesn't yet expose getGraph (e.g., cached build).
    const engineAny = engine as WorkflowEngine & { getGraph?: () => WorkflowGraph };
    const workflow =
      typeof engineAny.getGraph === 'function'
        ? engineAny.getGraph()
        : (Reflect.get(engine, 'graph') as WorkflowGraph | undefined);

    if (!workflow) {
      throw new Error('Workflow graph not available on engine instance');
    }

    const record: WorkflowRunRecord = {
      runId: result.runId,
      workflow,
      logs: result.logs,
      status: result.status
    };

    await saveRunRecord(config.runsDir, record);
  } catch (error) {
    logger.error('Failed to persist run result', error);
  }
}

export function createWorkflowRouter(llm?: WorkflowLLM): Router {
  const router = createRouter();

  router.post('/run', async (req: Request, res: Response) => {
    const { graph } = req.body as { graph?: WorkflowGraph };

    if (!validateGraph(graph)) {
      res.status(400).json({ error: 'Invalid workflow graph payload' });
      return;
    }

    const hasAgentNode = graph.nodes.some((node) => node.type === 'agent');
    if (hasAgentNode && !llm) {
      res.status(503).json({
        error: 'OPENAI_API_KEY is required to run workflows with Agent nodes.'
      });
      return;
    }

    try {
      const runId = Date.now().toString();
      const engine = new WorkflowEngine(graph, { runId, llm });
      addWorkflow(engine);

      const result = await engine.run();
      await persistResult(engine, result);

      if (result.status !== 'paused') {
        removeWorkflow(runId);
      }

      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to execute workflow', message);
      res.status(500).json({ error: 'Failed to execute workflow', details: message });
    }
  });

  router.post('/run-stream', async (req: Request, res: Response) => {
    const { graph } = req.body as { graph?: WorkflowGraph };

    if (!validateGraph(graph)) {
      res.status(400).json({ error: 'Invalid workflow graph payload' });
      return;
    }

    const hasAgentNode = graph.nodes.some((node) => node.type === 'agent');
    if (hasAgentNode && !llm) {
      res.status(503).json({
        error: 'OPENAI_API_KEY is required to run workflows with Agent nodes.'
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let clientDisconnected = false;
    res.on('close', () => { clientDisconnected = true; });

    const sendEvent = (data: object) => {
      if (clientDisconnected) return;
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const runId = Date.now().toString();
      const engine = new WorkflowEngine(graph, {
        runId,
        llm,
        onLog: (entry) => sendEvent({ type: 'log', entry })
      });
      addWorkflow(engine);
      sendEvent({ type: 'start', runId });

      const result = await engine.run();
      await persistResult(engine, result);

      if (result.status !== 'paused') {
        removeWorkflow(runId);
      }

      sendEvent({ type: 'done', result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to execute workflow stream', message);
      sendEvent({ type: 'error', message });
    } finally {
      res.end();
    }
  });

  router.post('/resume', async (req: Request, res: Response) => {
    const { runId, input } = req.body as { runId?: string; input?: unknown };
    if (!runId) {
      res.status(400).json({ error: 'runId is required' });
      return;
    }

    const engine = getWorkflow(runId);
    if (!engine) {
      res.status(404).json({ error: 'Run ID not found' });
      return;
    }

    try {
      const result = await engine.resume(input as Record<string, unknown>);
      await persistResult(engine, result);

      if (result.status !== 'paused') {
        removeWorkflow(runId);
      }

      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to resume workflow', message);
      res.status(500).json({ error: 'Failed to resume workflow', details: message });
    }
  });

  router.get('/default-workflow', (_req: Request, res: Response) => {
    const filePath = path.join(config.projectRoot, '.config', 'default-workflow.json');
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'No default workflow found' });
      return;
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const graph = JSON.parse(raw) as WorkflowGraph;
      if (!validateGraph(graph)) {
        res.status(400).json({ error: 'default-workflow.json is not a valid workflow graph' });
        return;
      }
      res.json(graph);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to read default workflow', message);
      res.status(500).json({ error: 'Failed to read default workflow', details: message });
    }
  });

  router.get('/run/:runId', (req: Request, res: Response) => {
    const { runId } = req.params;

    // Check in-memory first — catches engines that are still running or paused
    const engine = getWorkflow(runId);
    if (engine) {
      res.json(engine.getResult());
      return;
    }

    // Fall back to the persisted run record on disk
    const filePath = path.join(config.runsDir, `run_${runId}.json`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    try {
      const record = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as WorkflowRunRecord;
      // Return as WorkflowRunResult shape — completed/failed runs are no longer waiting
      const result: WorkflowRunResult = {
        runId: record.runId,
        status: record.status,
        logs: record.logs,
        state: {},
        waitingForInput: false,
        currentNodeId: null,
      };
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: 'Failed to read run record', details: message });
    }
  });

  router.get('/config', (_req: Request, res: Response) => {
    const filePath = path.join(config.projectRoot, '.config', 'config.json');
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'No config found' });
      return;
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      res.json(JSON.parse(raw));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to read config', message);
      res.status(500).json({ error: 'Failed to read config', details: message });
    }
  });

  return router;
}
