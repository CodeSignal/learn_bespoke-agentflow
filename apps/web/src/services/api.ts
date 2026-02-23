import type { ApprovalInput, WorkflowGraph, WorkflowRunResult } from '@agentic/types';

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

export function resumeWorkflow(
  runId: string,
  input: ApprovalInput,
  options: RequestOptions = {}
): Promise<WorkflowRunResult> {
  return request<WorkflowRunResult>('/api/resume', { runId, input }, options);
}
