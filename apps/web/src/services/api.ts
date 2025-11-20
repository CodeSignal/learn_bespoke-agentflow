import type { ApprovalInput, WorkflowGraph, WorkflowRunResult } from '@agentic/types';

async function request<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Request failed');
  }

  return res.json() as Promise<T>;
}

export function runWorkflow(graph: WorkflowGraph): Promise<WorkflowRunResult> {
  return request<WorkflowRunResult>('/api/run', { graph });
}

export function resumeWorkflow(runId: string, input: ApprovalInput): Promise<WorkflowRunResult> {
  return request<WorkflowRunResult>('/api/resume', { runId, input });
}

