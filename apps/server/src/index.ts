import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { WorkflowLLM } from '@agentic/workflow-engine';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { OpenAIAgentsLLMService } from './services/openai-agents-llm.js';
import { restorePausedRuns } from './services/restore.js';

const isProduction = process.env.NODE_ENV === 'production';
const webRoot = path.resolve(import.meta.dirname, '../../web');
const webDist = path.join(webRoot, 'dist');

async function bootstrap() {
  let llmService: WorkflowLLM | undefined;
  if (config.openAiApiKey) {
    logger.info('OPENAI_API_KEY detected, enabling live OpenAI Agents SDK backend');
    llmService = new OpenAIAgentsLLMService();
  } else {
    logger.warn('OPENAI_API_KEY missing. Agent workflows will be rejected.');
  }

  await fs.promises.mkdir(config.runsDir, { recursive: true });

  const { app, store } = createApp({
    llm: llmService,
    runsDir: config.runsDir,
    projectRoot: config.projectRoot,
    maxSteps: config.maxSteps
  });

  await restorePausedRuns({
    runsDir: config.runsDir,
    store,
    llm: llmService,
    maxSteps: config.maxSteps,
    pausedRunTtlMs: config.pausedRunTtlMs
  });

  if (isProduction) {
    if (fs.existsSync(webDist)) {
      app.use(express.static(webDist));
      app.get('/{*path}', (_req: Request, res: Response) => {
        res.sendFile(path.join(webDist, 'index.html'));
      });
    } else {
      logger.warn('Built web assets missing. Run `npm run build:web` before starting in production.');
    }
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: webRoot,
      configFile: path.join(webRoot, 'vite.config.ts'),
      server: { middlewareMode: true },
      appType: 'custom'
    });
    app.use(vite.middlewares);
    app.use(async (req: Request, res: Response, next: NextFunction) => {
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
        const templatePath = path.join(webRoot, 'index.html');
        const template = await fs.promises.readFile(templatePath, 'utf-8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
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
