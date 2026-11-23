import type { ApprovalInput, WorkflowGraph, WorkflowLogEntry, WorkflowRunResult } from '@agentflow/types';
import { SseParser } from './sse';

type RequestOptions = {
  signal?: AbortSignal;
  onStart?: (runId: string) => void;
};

type StreamEvent = {
  type?: string;
  entry?: WorkflowLogEntry;
  result?: WorkflowRunResult;
  message?: string;
  runId?: string;
};

/** A non-2xx API response. `status` lets callers tell "not found" from a real failure. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let text = '';
  try {
    text = await res.text();
  } catch { /* body unavailable */ }
  let parsed: { error?: string; details?: string; message?: string } | undefined;
  try {
    parsed = JSON.parse(text) as { error?: string; details?: string; message?: string };
  } catch { /* not JSON */ }
  const message = parsed?.error || parsed?.details || parsed?.message || text.trim() || 'Request failed';
  return new ApiError(message, res.status);
}

function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
}

/**
 * Reads a run/resume SSE stream to its end and returns the final result.
 * A line that is not valid JSON is skipped (and logged) instead of failing the
 * run; an `error` event stops reading and rejects.
 */
export async function readWorkflowStream(
  body: ReadableStream<Uint8Array> | null,
  onLog: (entry: WorkflowLogEntry) => void,
  options: RequestOptions = {}
): Promise<WorkflowRunResult> {
  if (!body) throw new Error('Workflow stream has no response body');

  const reader = body.getReader();
  const decoder = new TextDecoder();
  // Held in an object because both fields are assigned from the parser callback.
  const state: { result: WorkflowRunResult | null; error: Error | null } = { result: null, error: null };

  const parser = new SseParser((data) => {
    if (state.error) return;
    let event: StreamEvent;
    try {
      event = JSON.parse(data) as StreamEvent;
    } catch {
      console.warn('Skipped malformed workflow stream event', data);
      return;
    }
    if (!event || typeof event !== 'object') return;
    if (event.type === 'start' && event.runId) {
      options.onStart?.(event.runId);
    } else if (event.type === 'log' && event.entry) {
      onLog(event.entry);
    } else if (event.type === 'done' && event.result) {
      state.result = event.result;
    } else if (event.type === 'error') {
      state.error = new Error(event.message || 'Workflow execution failed');
    }
  });

  try {
    while (!state.error) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    if (!state.error) {
      parser.push(decoder.decode());
      parser.flush();
    }
  } finally {
    if (state.error) {
      // Stop the server from sending events nobody will read.
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }

  if (state.error) throw state.error;
  if (!state.result) throw new Error('Workflow stream ended without a result');
  return state.result;
}

async function requestWorkflowStream(
  url: string,
  body: unknown,
  onLog: (entry: WorkflowLogEntry) => void,
  options: RequestOptions = {}
): Promise<WorkflowRunResult> {
  const res = await postJson(url, body, options.signal);
  if (!res.ok) throw await toApiError(res);
  return readWorkflowStream(res.body, onLog, options);
}

export function runWorkflowStream(
  graph: WorkflowGraph,
  onLog: (entry: WorkflowLogEntry) => void,
  options: RequestOptions = {}
): Promise<WorkflowRunResult> {
  return requestWorkflowStream('/api/run-stream', { graph }, onLog, options);
}

export function resumeWorkflowStream(
  runId: string,
  input: ApprovalInput,
  onLog: (entry: WorkflowLogEntry) => void,
  options: RequestOptions = {}
): Promise<WorkflowRunResult> {
  return requestWorkflowStream('/api/resume-stream', { runId, input }, onLog, options);
}

/**
 * Asks the server to stop a running or paused run. Closing the stream does not
 * stop a run, so this is the only way to cancel one.
 * Resolves to null when the server no longer has the run (unknown or already finished).
 */
export async function cancelWorkflow(runId: string): Promise<WorkflowRunResult | null> {
  const res = await postJson('/api/cancel', { runId });
  if (res.status === 404) return null;
  if (!res.ok) throw await toApiError(res);
  return res.json() as Promise<WorkflowRunResult>;
}

export type ProviderModel = {
  id: string;
  name: string;
  reasoningEfforts: string[];
  defaultReasoningEffort?: string;
};

export type Provider = {
  id: string;
  name: string;
  enabled: boolean;
  /** False when the server has no API key for this provider. Absent on older servers. */
  available?: boolean;
  models: ProviderModel[];
};

export type AppConfig = {
  defaultModel?: string;
  /** Maps model ids from older saved workflows to current ones. */
  modelAliases?: Record<string, string>;
  providers?: Provider[];
};

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch('/api/config');
  if (!res.ok) return {};
  return res.json() as Promise<AppConfig>;
}

export async function fetchRun(runId: string): Promise<WorkflowRunResult | null> {
  const res = await fetch(`/api/run/${encodeURIComponent(runId)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch run ${runId}: HTTP ${res.status}`);
  }
  return res.json() as Promise<WorkflowRunResult>;
}
