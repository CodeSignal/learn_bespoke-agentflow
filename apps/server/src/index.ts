import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import type { WorkflowRunRecord } from '@agentic/types';
import WorkflowEngine, { type WorkflowLLM } from '@agentic/workflow-engine';
import { config } from './config';
import { logger } from './logger';
import { createWorkflowRouter } from './routes/workflows';
import { OpenAILLMService } from './services/openai-llm';
import { addWorkflow } from './store/active-workflows';

const isProduction = process.env.NODE_ENV === 'production';
const webRoot = path.resolve(__dirname, '../../web');
const webDist = path.join(webRoot, 'dist');

/**
 * On startup, scan the runs directory for persisted paused runs and re-hydrate
 * each one back into the active-workflows Map so that `POST /api/resume` works
 * even after a server restart.
 */
function restorePausedRuns(runsDir: string, llm?: WorkflowLLM): void {
  let files: string[];
  try {
    files = fs.readdirSync(runsDir).filter((f) => f.startsWith('run_') && f.endsWith('.json'));
  } catch {
    return; // runsDir missing on very first boot (created lazily by config.ts)
  }

  for (const file of files) {
    try {
      const record = JSON.parse(
        fs.readFileSync(path.join(runsDir, file), 'utf-8')
      ) as WorkflowRunRecord;

      if (
        record.status === 'paused' &&
        record.waitingForInput === true &&
        record.state !== undefined &&
        record.currentNodeId != null
      ) {
        const engine = new WorkflowEngine(record.workflow, {
          runId: record.runId,
          llm,
          initialState: {
            state: record.state,
            currentNodeId: record.currentNodeId,
            status: 'paused',
            waitingForInput: true,
            logs: record.logs
          }
        });
        addWorkflow(engine);
        logger.info('Restored paused run %s from disk', record.runId);
      }
    } catch (err) {
      logger.warn('Skipped unreadable run file %s: %s', file, String(err));
    }
  }
}

async function bootstrap() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  let llmService: OpenAILLMService | undefined;
  if (config.openAiApiKey) {
    logger.info('OPENAI_API_KEY detected, enabling live OpenAI responses');
    const client = new OpenAI({ apiKey: config.openAiApiKey });
    llmService = new OpenAILLMService(client);
  } else {
    logger.warn('OPENAI_API_KEY missing. Agent workflows will be rejected.');
  }

  restorePausedRuns(config.runsDir, llmService);

  app.use('/api', createWorkflowRouter(llmService));

  if (isProduction) {
    if (fs.existsSync(webDist)) {
      app.use(express.static(webDist));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(webDist, 'index.html'));
      });
    } else {
      logger.warn('Built web assets missing. Run `npm run build:web` before starting in production.');
    }
  } else {
    const fsPromises = fs.promises;
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: webRoot,
      configFile: path.join(webRoot, 'vite.config.ts'),
      server: { middlewareMode: true },
      appType: 'custom'
    });
    app.use(vite.middlewares);
    app.use('*', async (req: Request, res: Response, next) => {
      const isHtmlRequest =
        req.method === 'GET' &&
        !req.originalUrl.startsWith('/api') &&
        !req.originalUrl.includes('.') &&
        req.headers.accept?.includes('text/html');

      if (!isHtmlRequest) {
        next();
        return;
      }

      try {
        const url = req.originalUrl;
        const templatePath = path.join(webRoot, 'index.html');
        let template = await fsPromises.readFile(templatePath, 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        next(error);
      }
    });
    logger.info('Vite dev middleware attached. UI available at http://localhost:%d', config.port);
  }

  app.listen(config.port, () => {
    logger.info(`Server listening on http://localhost:${config.port}`);
  });
}

bootstrap().catch((error) => {
  logger.error('Failed to start server', error);
  process.exitCode = 1;
});
