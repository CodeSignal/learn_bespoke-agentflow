import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import { WorkflowGraph } from '@agentic/types';
import WorkflowEngine, { WorkflowLLM } from '@agentic/workflow-engine';
import { addWorkflow, getWorkflow, removeWorkflow } from '../store/active-workflows';
import { saveRunLog } from '../services/persistence';
import { config } from '../config';
import { logger } from '../logger';

function validateGraph(graph: WorkflowGraph | undefined): graph is WorkflowGraph {
  return Boolean(graph && Array.isArray(graph.nodes) && Array.isArray(graph.connections));
}

async function persistResult(engine: WorkflowEngine) {
  try {
    await saveRunLog(config.runsDir, engine.getResult());
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

    try {
      const runId = Date.now().toString();
      const engine = new WorkflowEngine(graph, { runId, llm });
      addWorkflow(engine);

      const result = await engine.run();
      await persistResult(engine);

      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to execute workflow', message);
      res.status(500).json({ error: 'Failed to execute workflow', details: message });
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
      await persistResult(engine);

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

  return router;
}

