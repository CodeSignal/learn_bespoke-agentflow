import type { ApprovalInput, WorkflowGraph, WorkflowLogEntry, WorkflowRunResult } from '@agentic/types';

type RequestOptions = {
  signal?: AbortSignal;
};

async function request<T>(url: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal
  });

  if (!res.ok) {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      let payload: { error?: string; details?: string; message?: string } | null = null;
      try {
        payload = (await res.json()) as { error?: string; details?: string; message?: string };
      } catch {
        // Fall through to generic message
      }
      const message = payload?.error || payload?.details || payload?.message;
      throw new Error(message || 'Request failed');
    }

    const text = await res.text();
    if (text) {
      try {
        const payload = JSON.parse(text) as { error?: string; details?: string; message?: string };
        const message = payload.error || payload.details || payload.message;
        throw new Error(message || text.trim());
      } catch {
        throw new Error(text.trim());
      }
    }

    throw new Error('Request failed');
  }

  return res.json() as Promise<T>;
}

export function runWorkflow(graph: WorkflowGraph, options: RequestOptions = {}): Promise<WorkflowRunResult> {
  return request<WorkflowRunResult>('/api/run', { graph }, options);
}

export async function runWorkflowStream(
  graph: WorkflowGraph,
  onLog: (entry: WorkflowLogEntry) => void,
  options: RequestOptions = {}
): Promise<WorkflowRunResult> {
  const res = await fetch('/api/run-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph }),
    signal: options.signal
  });

  if (!res.ok) {
    const text = await res.text();
    try {
      const payload = JSON.parse(text) as { error?: string; details?: string };
      throw new Error(payload.error || payload.details || 'Request failed');
    } catch {
      throw new Error(text.trim() || 'Request failed');
    }
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: WorkflowRunResult | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const parsed = JSON.parse(line.slice(6)) as {
          type: string;
          entry?: WorkflowLogEntry;
          result?: WorkflowRunResult;
          message?: string;
        };
        if (parsed.type === 'log' && parsed.entry) {
          onLog(parsed.entry);
        } else if (parsed.type === 'done' && parsed.result) {
          result = parsed.result;
        } else if (parsed.type === 'error') {
          throw new Error(parsed.message || 'Workflow execution failed');
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!result) throw new Error('Workflow stream ended without a result');
  return result;
}

export function resumeWorkflow(
  runId: string,
  input: ApprovalInput,
  options: RequestOptions = {}
): Promise<WorkflowRunResult> {
  return request<WorkflowRunResult>('/api/resume', { runId, input }, options);
}
