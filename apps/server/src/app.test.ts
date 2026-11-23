import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowGraph, WorkflowRunRecord, WorkflowRunResult } from '@agentflow/types';
import type { AgentInvocation, AgentRespondOptions, WorkflowLLM } from '@agentflow/workflow-engine';
import { createApp } from './app.js';
import { restorePausedRuns } from './services/restore.js';
import { RunStore } from './store/run-store.js';

type StreamEvent = { type: string; runId?: string; result?: WorkflowRunResult; message?: string };

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, x: 0, y: 0, data });

const agentGraph: WorkflowGraph = {
  nodes: [node('start', 'start', { initialInput: 'hi' }), node('a', 'agent')],
  connections: [{ source: 'start', target: 'a' }]
};

const approvalGraph: WorkflowGraph = {
  nodes: [node('start', 'start', { initialInput: 'hi' }), node('gate', 'approval'), node('a', 'agent')],
  connections: [
    { source: 'start', target: 'gate' },
    { source: 'gate', target: 'a', sourceHandle: 'approve' }
  ]
};

let tempDir: string;
let server: Server | undefined;
let baseUrl: string;
let store: RunStore;

async function startServer(llm?: WorkflowLLM): Promise<void> {
  store = new RunStore();
  const { app } = createApp({ llm, runsDir: path.join(tempDir, 'runs'), projectRoot: tempDir, store, sseHeartbeatMs: 10 });
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}

const post = (route: string, body: unknown) =>
  fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

const postJson = async <T = WorkflowRunResult>(route: string, body: unknown): Promise<T> =>
  (await post(route, body)).json() as Promise<T>;

const readRecord = async (runId: string): Promise<WorkflowRunRecord> =>
  JSON.parse(await fs.readFile(path.join(tempDir, 'runs', `run_${runId}.json`), 'utf-8')) as WorkflowRunRecord;

/** Reads SSE events from a response, yielding each parsed `data:` payload. */
async function* readEvents(response: Response): AsyncGenerator<StreamEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      if (block.startsWith('data: ')) yield JSON.parse(block.slice(6)) as StreamEvent;
    }
  }
}

const echoLlm: WorkflowLLM = { respond: async (invocation: AgentInvocation) => `echo:${invocation.userContent}` };

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentflow-server-'));
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.closeAllConnections();
    server.close(() => resolve());
  });
  server = undefined;
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('run endpoints', () => {
  it('rejects malformed graphs with details', async () => {
    await startServer(echoLlm);
    const response = await post('/run', { graph: { nodes: [{ id: 'a' }], connections: [] } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid workflow graph payload',
      details: ['nodes[0].type must be a non-empty string.']
    });
  });

  it('requires an LLM for agent workflows', async () => {
    await startServer();
    expect((await post('/run', { graph: agentGraph })).status).toBe(503);
    expect((await post('/run-stream', { graph: agentGraph })).status).toBe(503);
  });

  it('does not send CORS headers', async () => {
    await startServer(echoLlm);
    const preflight = await fetch(`${baseUrl}/run`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' }
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('runs a workflow, persists it and serves it back by id', async () => {
    await startServer(echoLlm);
    const result = await postJson('/run', { graph: agentGraph });

    expect(result.status).toBe('completed');
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.state.a).toBe('echo:hi');
    expect(result.workflow).toEqual(agentGraph);
    expect(store.size).toBe(0);
    expect((await readRecord(result.runId)).status).toBe('completed');

    const fetched = (await (await fetch(`${baseUrl}/run/${result.runId}`)).json()) as WorkflowRunResult;
    expect(fetched).toMatchObject({ runId: result.runId, status: 'completed', waitingForInput: false });
  });

  it('gives concurrent runs different ids', async () => {
    await startServer(echoLlm);
    const results = await Promise.all(Array.from({ length: 5 }, () => postJson('/run', { graph: agentGraph })));
    expect(new Set(results.map((result) => result.runId)).size).toBe(5);
  });

  it('streams start, log and done events', async () => {
    await startServer(echoLlm);
    const events: StreamEvent[] = [];
    for await (const event of readEvents(await post('/run-stream', { graph: agentGraph }))) events.push(event);

    expect(events[0].type).toBe('start');
    expect(events.at(-1)).toMatchObject({ type: 'done', result: { status: 'completed', runId: events[0].runId } });
    expect(events.filter((event) => event.type === 'log').length).toBeGreaterThan(2);
  });

  it('sends heartbeat comments while a call is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await startServer({
      respond: async () => {
        await gate;
        return 'done';
      }
    });
    const response = await post('/run-stream', { graph: agentGraph });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes(': ping')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    release();
    await reader.cancel();
    expect(text).toContain(': ping\n\n');
  });

  it('rejects run ids that are not safe file names', async () => {
    await startServer(echoLlm);
    expect((await fetch(`${baseUrl}/run/..%2F..%2Fpackage`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/run/unknown-run`)).status).toBe(404);
  });
});

describe('pause, resume and cancel', () => {
  it('pauses on approval and completes after resume', async () => {
    await startServer(echoLlm);
    const paused = await postJson('/run', { graph: approvalGraph });
    expect(paused).toMatchObject({ status: 'paused', waitingForInput: true, currentNodeId: 'gate' });
    expect(store.size).toBe(1);

    const resumed = await postJson('/resume', { runId: paused.runId, input: { decision: 'approve' } });
    expect(resumed.status).toBe('completed');
    expect(store.size).toBe(0);
    expect((await readRecord(paused.runId)).status).toBe('completed');
  });

  it('validates resume requests', async () => {
    await startServer(echoLlm);
    expect((await post('/resume', {})).status).toBe(400);
    expect((await post('/resume', { runId: 'missing' })).status).toBe(404);
    expect((await post('/resume-stream', { runId: 'missing' })).status).toBe(404);
    const paused = await postJson('/run', { graph: approvalGraph });
    expect((await post('/resume', { runId: paused.runId, input: 42 })).status).toBe(400);
  });

  it('refuses a second resume while the first is executing', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await startServer({
      respond: async () => {
        await gate;
        return 'done';
      }
    });
    const paused = await postJson('/run', { graph: approvalGraph });
    const body = { runId: paused.runId, input: { decision: 'approve' } };

    const first = post('/resume', body);
    await expect.poll(() => store.isBusy(paused.runId)).toBe(true);
    expect((await post('/resume-stream', body)).status).toBe(409);
    release();
    expect(((await (await first).json()) as WorkflowRunResult).status).toBe('completed');
  });

  it('cancels a paused run', async () => {
    await startServer(echoLlm);
    const paused = await postJson('/run', { graph: approvalGraph });

    const cancelled = await postJson('/cancel', { runId: paused.runId });
    expect(cancelled).toMatchObject({ status: 'cancelled', waitingForInput: false, currentNodeId: null });
    expect(store.size).toBe(0);
    expect((await readRecord(paused.runId)).status).toBe('cancelled');
    expect((await post('/resume', { runId: paused.runId, input: { decision: 'approve' } })).status).toBe(404);
    expect((await post('/cancel', { runId: paused.runId })).status).toBe(404);
  });

  it('cancels a running stream and aborts the model call', async () => {
    let aborted = false;
    await startServer({
      respond: (_invocation: AgentInvocation, options?: AgentRespondOptions) =>
        new Promise<string>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        })
    });

    const events = readEvents(await post('/run-stream', { graph: agentGraph }));
    const first = (await events.next()).value as StreamEvent;
    expect(first.type).toBe('start');
    await expect.poll(() => store.get(first.runId!)?.getLogs().some((entry) => entry.type === 'start_prompt')).toBe(true);

    const cancelled = await postJson('/cancel', { runId: first.runId });
    expect(cancelled.status).toBe('cancelled');

    let last: StreamEvent | undefined;
    for await (const event of events) last = event;
    expect(last).toMatchObject({ type: 'done', result: { status: 'cancelled' } });
    expect(aborted).toBe(true);
    expect(store.size).toBe(0);
    expect((await readRecord(first.runId!)).status).toBe('cancelled');
  });

  it('keeps a run going when the stream client disconnects', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await startServer({
      respond: async () => {
        await gate;
        return 'finished anyway';
      }
    });
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/run-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: agentGraph }),
      signal: controller.signal
    });
    const first = (await readEvents(response).next()).value as StreamEvent;
    controller.abort();

    expect(((await (await fetch(`${baseUrl}/run/${first.runId}`)).json()) as WorkflowRunResult).status).toBe('running');
    release();
    await expect.poll(() => store.size).toBe(0);
    expect((await readRecord(first.runId!)).state?.a).toBe('finished anyway');
  });
});

describe('paused run restore', () => {
  const pausedRecord = (runId: string): WorkflowRunRecord => ({
    runId,
    workflow: approvalGraph,
    logs: [],
    status: 'paused',
    state: { start: 'hi', previous_output: 'hi', pre_approval_output: 'hi' },
    currentNodeId: 'gate',
    waitingForInput: true
  });

  const writeRecord = async (record: WorkflowRunRecord) => {
    const runsDir = path.join(tempDir, 'runs');
    await fs.mkdir(runsDir, { recursive: true });
    await fs.writeFile(path.join(runsDir, `run_${record.runId}.json`), JSON.stringify(record));
  };

  it('restores resumable runs and skips finished, expired and unreadable ones', async () => {
    const runsDir = path.join(tempDir, 'runs');
    await writeRecord(pausedRecord('fresh'));
    await writeRecord({ ...pausedRecord('finished'), status: 'completed', waitingForInput: false });
    await fs.writeFile(path.join(runsDir, 'run_broken.json'), '{not json');
    const restoreStore = new RunStore();

    const restored = await restorePausedRuns({ runsDir, store: restoreStore, llm: echoLlm, pausedRunTtlMs: 60_000 });
    expect(restored).toBe(1);
    expect(restoreStore.get('fresh')?.getStatus()).toBe('paused');

    const later = new RunStore();
    const expired = await restorePausedRuns({
      runsDir,
      store: later,
      pausedRunTtlMs: 60_000,
      now: () => Date.now() + 120_000
    });
    expect(expired).toBe(0);
  });

  it('resumes a restored run through the API', async () => {
    await writeRecord(pausedRecord('1772129193363'));
    await startServer(echoLlm);
    await restorePausedRuns({ runsDir: path.join(tempDir, 'runs'), store, llm: echoLlm, pausedRunTtlMs: 60_000 });

    const resumed = await postJson('/resume', { runId: '1772129193363', input: { decision: 'approve' } });
    expect(resumed.status).toBe('completed');
    expect(resumed.state.a).toBe('echo:hi');
  });
});

describe('provider configuration', () => {
  it('uses the preflight check, public config and default model it is given', async () => {
    store = new RunStore();
    const seenModels: string[] = [];
    const { app } = createApp({
      llm: {
        respond: async (invocation: AgentInvocation) => {
          seenModels.push(invocation.model);
          return 'ok';
        }
      },
      runsDir: path.join(tempDir, 'runs'),
      projectRoot: tempDir,
      store,
      preflight: (graph) =>
        graph.nodes.some((node) => node.data?.model === 'claude-x')
          ? { status: 503, error: 'ANTHROPIC_API_KEY is required to run Agent nodes that use Anthropic models.' }
          : null,
      getPublicConfig: () => ({ defaultModel: 'model-from-config', providers: [] }),
      getDefaultModel: () => 'model-from-config'
    });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

    expect(await (await fetch(`${baseUrl}/config`)).json()).toEqual({ defaultModel: 'model-from-config', providers: [] });

    const blocked = await post('/run-stream', {
      graph: { nodes: [node('start', 'start'), node('a', 'agent', { model: 'claude-x' })], connections: [] }
    });
    expect(blocked.status).toBe(503);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/ANTHROPIC_API_KEY is required/);

    await postJson('/run', { graph: agentGraph });
    expect(seenModels).toEqual(['model-from-config']);
  });
});

describe('project files', () => {
  it('returns 404 when config files are absent and serves them when present', async () => {
    await startServer();
    expect((await fetch(`${baseUrl}/config`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/default-workflow`)).status).toBe(404);

    await fs.mkdir(path.join(tempDir, '.config'));
    await fs.writeFile(path.join(tempDir, '.config', 'config.json'), JSON.stringify({ providers: [] }));
    await fs.writeFile(path.join(tempDir, '.config', 'default-workflow.json'), JSON.stringify({ nodes: 'nope' }));
    expect(await (await fetch(`${baseUrl}/config`)).json()).toEqual({ providers: [] });
    expect((await fetch(`${baseUrl}/default-workflow`)).status).toBe(400);
  });
});
