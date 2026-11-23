import type { WorkflowLogEntry, WorkflowRunResult } from '@agentflow/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, cancelWorkflow, readWorkflowStream, runWorkflowStream } from './api';
import { SseParser } from './sse';

const result: WorkflowRunResult = {
  runId: 'run-1',
  status: 'completed',
  logs: [],
  state: {},
  waitingForInput: false,
  currentNodeId: null
};
const logEntry = (content: string): WorkflowLogEntry => ({
  timestamp: '2026-01-01T00:00:00.000Z',
  nodeId: 'node_1',
  type: 'llm_response',
  content
});
const event = (data: unknown, newline = '\n') => `data: ${JSON.stringify(data)}${newline}${newline}`;

function streamOf(chunks: string[]): { body: ReadableStream<Uint8Array>; cancelled: () => boolean } {
  const encoder = new TextEncoder();
  let wasCancelled = false;
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index += 1;
      } else {
        controller.close();
      }
    },
    cancel() {
      wasCancelled = true;
    }
  });
  return { body, cancelled: () => wasCancelled };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SseParser', () => {
  const collect = (chunks: string[], flush = true): string[] => {
    const seen: string[] = [];
    const parser = new SseParser((data) => seen.push(data));
    chunks.forEach((chunk) => parser.push(chunk));
    if (flush) parser.flush();
    return seen;
  };

  it('emits one event per blank-line-terminated block', () => {
    expect(collect(['data: one\n\ndata: two\n\n'])).toEqual(['one', 'two']);
  });

  it('joins events split across chunks at any position', () => {
    const text = 'data: {"a":1}\n\ndata: {"b":2}\n\n';
    for (let cut = 1; cut < text.length; cut += 1) {
      expect(collect([text.slice(0, cut), text.slice(cut)])).toEqual(['{"a":1}', '{"b":2}']);
    }
  });

  it('accepts CRLF line endings, even when split between CR and LF', () => {
    expect(collect(['data: one\r\n\r\ndata: two\r', '\n\r\n'])).toEqual(['one', 'two']);
  });

  it('ignores comments, heartbeats and other fields', () => {
    expect(collect([': keep-alive\n\nevent: log\nid: 4\ndata: one\n\n:\n\n'])).toEqual(['one']);
  });

  it('joins multi-line data and accepts a missing space after the colon', () => {
    expect(collect(['data: a\ndata:b\n\n'])).toEqual(['a\nb']);
  });

  it('delivers a trailing event only on flush', () => {
    expect(collect(['data: one\n\ndata: tail'], false)).toEqual(['one']);
    expect(collect(['data: one\n\ndata: tail'])).toEqual(['one', 'tail']);
  });
});

describe('readWorkflowStream', () => {
  it('reports start, logs and the final result', async () => {
    const onStart = vi.fn();
    const logs: WorkflowLogEntry[] = [];
    const { body } = streamOf([
      event({ type: 'start', runId: 'run-1' }),
      ': heartbeat\n\n',
      event({ type: 'log', entry: logEntry('hello') }),
      event({ type: 'done', result })
    ]);

    await expect(readWorkflowStream(body, (entry) => logs.push(entry), { onStart })).resolves.toEqual(result);
    expect(onStart).toHaveBeenCalledWith('run-1');
    expect(logs).toEqual([logEntry('hello')]);
  });

  it('handles events split across chunks and CRLF', async () => {
    const text = event({ type: 'log', entry: logEntry(`multi-byte: ${String.fromCharCode(0xe9, 0x4e2d)}`) }, '\r\n') + event({ type: 'done', result }, '\r\n');
    const middle = Math.floor(text.length / 3);
    const logs: WorkflowLogEntry[] = [];
    const { body } = streamOf([text.slice(0, middle), text.slice(middle, middle * 2), text.slice(middle * 2)]);

    await expect(readWorkflowStream(body, (entry) => logs.push(entry))).resolves.toEqual(result);
    expect(logs).toHaveLength(1);
  });

  it('skips a malformed event instead of failing the run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logs: WorkflowLogEntry[] = [];
    const { body } = streamOf([
      'data: {not json\n\n',
      'data: 42\n\n',
      event({ type: 'log', entry: logEntry('still here') }),
      event({ type: 'done', result })
    ]);

    await expect(readWorkflowStream(body, (entry) => logs.push(entry))).resolves.toEqual(result);
    expect(logs).toEqual([logEntry('still here')]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('accepts a final event that is not followed by a blank line', async () => {
    const { body } = streamOf([`data: ${JSON.stringify({ type: 'done', result })}`]);
    await expect(readWorkflowStream(body, () => undefined)).resolves.toEqual(result);
  });

  it('rejects on an error event, stops reading and cancels the stream', async () => {
    const logs: WorkflowLogEntry[] = [];
    const { body, cancelled } = streamOf([
      event({ type: 'error', message: 'boom' }) + event({ type: 'log', entry: logEntry('ignored') }),
      event({ type: 'done', result })
    ]);

    await expect(readWorkflowStream(body, (entry) => logs.push(entry))).rejects.toThrow('boom');
    expect(logs).toEqual([]);
    expect(cancelled()).toBe(true);
  });

  it('rejects when the stream ends without a result', async () => {
    const { body } = streamOf([event({ type: 'start', runId: 'run-1' })]);
    await expect(readWorkflowStream(body, () => undefined)).rejects.toThrow('Workflow stream ended without a result');
  });

  it('rejects when there is no body', async () => {
    await expect(readWorkflowStream(null, () => undefined)).rejects.toThrow('no response body');
  });
});

describe('API calls', () => {
  it('turns a failed stream request into an ApiError with the server message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'No key' }), { status: 503 })));
    const error = await runWorkflowStream({ nodes: [], connections: [] }, () => undefined).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('No key');
    expect((error as ApiError).status).toBe(503);
  });

  it('posts the run id to the cancel endpoint', async () => {
    const cancelled = { ...result, status: 'cancelled' as const };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(cancelled), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(cancelWorkflow('run-1')).resolves.toEqual(cancelled);
    expect(fetchMock).toHaveBeenCalledWith('/api/cancel', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ runId: 'run-1' })
    }));
  });

  it('treats a 404 from cancel as "already gone" and other failures as errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Run ID not found' }), { status: 404 })));
    await expect(cancelWorkflow('run-1')).resolves.toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await expect(cancelWorkflow('run-1')).rejects.toThrow('nope');
  });
});
