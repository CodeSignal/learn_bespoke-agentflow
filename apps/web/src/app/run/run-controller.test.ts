// @vitest-environment jsdom
import type { WorkflowLogEntry, WorkflowRunResult } from '@agentflow/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../services/api';
import { ChatView } from '../chat/chat-view';
import { RUN_ID_STORAGE_KEY, RUN_POLL_INTERVAL_MS } from '../constants';
import type { WorkflowGraphPayload, WorkflowState } from '../types';
import { RunController, isAbortError } from './run-controller';

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    runWorkflowStream: vi.fn(),
    resumeWorkflowStream: vi.fn(),
    cancelWorkflow: vi.fn(),
    fetchRun: vi.fn()
  };
});

const runWorkflowStream = vi.mocked(api.runWorkflowStream);
const resumeWorkflowStream = vi.mocked(api.resumeWorkflowStream);
const cancelWorkflow = vi.mocked(api.cancelWorkflow);
const fetchRun = vi.mocked(api.fetchRun);

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const log = (type: string, nodeId: string, content = ''): WorkflowLogEntry =>
  ({ timestamp: 't', nodeId, type, content });

const baseResult = (overrides: Partial<WorkflowRunResult> = {}): WorkflowRunResult => ({
  runId: 'run-1',
  status: 'completed',
  logs: [],
  state: {},
  waitingForInput: false,
  currentNodeId: null,
  ...overrides
});
const pausedResult = (): WorkflowRunResult =>
  baseResult({ status: 'paused', waitingForInput: true, currentNodeId: 'approval_1' });

function setup() {
  document.body.innerHTML = '<div id="chat"></div>';
  const chatEl = document.getElementById('chat') as HTMLElement;
  const graph: WorkflowGraphPayload = {
    nodes: [
      { id: 'start_1', type: 'start', x: 0, y: 0, data: {} },
      { id: 'agent_1', type: 'agent', x: 0, y: 0, data: { agentName: 'Writer' } },
      { id: 'approval_1', type: 'approval', x: 0, y: 0, data: { prompt: 'Ship it?' } }
    ],
    connections: []
  };
  const states: WorkflowState[] = [];
  // The chat and the controller reference each other, as in the editor.
  const holder: { run?: RunController } = {};
  const chat = new ChatView(chatEl, {
    getRunNodeById: (id) => holder.run?.getRunNodeById(id),
    getPrimaryAgentName: () => holder.run?.getPrimaryAgentName() ?? 'Agent',
    onApprovalDecision: (decision) => void holder.run?.submitApprovalDecision(decision)
  });
  const run = new RunController({
    chat,
    getGraph: () => graph,
    getPromptValue: () => 'Write a poem',
    prepareGraphForRun: () => undefined,
    onStateChange: (state) => states.push(state)
  });
  holder.run = run;
  const text = () => chatEl.textContent ?? '';
  const approveButton = () => chatEl.querySelector<HTMLButtonElement>('.approve-btn');
  return { run, chat, chatEl, graph, states, text, approveButton };
}

/** Starts a run whose stream stays open until the returned deferred settles. */
async function startRun(run: RunController) {
  const stream = deferred<WorkflowRunResult>();
  let signal: AbortSignal | undefined;
  runWorkflowStream.mockImplementation((_graph, _onLog, options) => {
    signal = options?.signal;
    options?.onStart?.('run-1');
    signal?.addEventListener('abort', () => {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      stream.reject(error);
    });
    return stream.promise;
  });
  const finished = run.run();
  await Promise.resolve();
  return { stream, finished, getSignal: () => signal };
}

async function runUntilPaused(run: RunController) {
  runWorkflowStream.mockImplementation(async (_graph, _onLog, options) => {
    options?.onStart?.('run-1');
    return pausedResult();
  });
  await run.run();
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isAbortError', () => {
  it('matches by error name only', () => {
    const abort = new Error('whatever');
    abort.name = 'AbortError';
    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(new Error('The request was aborted by the server'))).toBe(false);
    expect(isAbortError('aborted')).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe('RunController run', () => {
  it('runs to completion and returns to idle', async () => {
    const { run, graph, states, text } = setup();
    runWorkflowStream.mockImplementation(async (sentGraph, onLog, options) => {
      options?.onStart?.('run-1');
      expect(localStorage.getItem(RUN_ID_STORAGE_KEY)).toBe('run-1');
      expect(run.getState()).toBe('running');
      expect(sentGraph.nodes[0].data?.initialInput).toBe('Write a poem');
      onLog(log('step_start', 'agent_1'));
      expect(text()).toContain('Writer is working');
      onLog(log('llm_response', 'agent_1', 'Roses are red'));
      return baseResult();
    });

    await run.run();

    expect(run.getState()).toBe('idle');
    expect(states).toEqual(['running', 'idle']);
    expect(text()).toContain('Write a poem');
    expect(text()).toContain('Roses are red');
    expect(text()).toContain('Completed');
    expect(text()).not.toContain('is working');
    expect(localStorage.getItem(RUN_ID_STORAGE_KEY)).toBeNull();
    expect(graph.nodes[0].data?.initialInput).toBe('Write a poem');
  });

  it('does not start a second run while one is active', async () => {
    const { run } = setup();
    const { stream, finished } = await startRun(run);
    await run.run();
    expect(runWorkflowStream).toHaveBeenCalledTimes(1);
    stream.resolve(baseResult());
    await finished;
  });

  it('reports a failed request and returns to idle', async () => {
    const { run, text } = setup();
    runWorkflowStream.mockRejectedValue(new Error('OPENAI_API_KEY is required'));
    await run.run();
    expect(run.getState()).toBe('idle');
    expect(text()).toContain('Error: OPENAI_API_KEY is required');
    expect(text()).toContain('Failed');
  });

  it('does not swallow a server error that merely mentions "aborted"', async () => {
    const { run, text } = setup();
    runWorkflowStream.mockRejectedValue(new Error('Upstream request aborted'));
    await run.run();
    expect(run.getState()).toBe('idle');
    expect(text()).toContain('Upstream request aborted');
  });

  it('shows a failed status for a failed run and a cancelled status for a cancelled one', async () => {
    const first = setup();
    runWorkflowStream.mockResolvedValue(baseResult({ status: 'failed' }));
    await first.run.run();
    expect(first.text()).toContain('Failed');

    const second = setup();
    runWorkflowStream.mockResolvedValue(baseResult({ status: 'cancelled' }));
    await second.run.run();
    expect(second.text()).toContain('Cancelled');
    expect(second.text()).not.toContain('Failed');
    expect(second.run.getState()).toBe('idle');
  });
});

describe('RunController pause and resume', () => {
  it('pauses on an approval node and keeps the run id for recovery', async () => {
    const { run, text, approveButton } = setup();
    await runUntilPaused(run);

    expect(run.getState()).toBe('paused');
    expect(text()).toContain('Ship it?');
    expect(approveButton()).not.toBeNull();
    expect(localStorage.getItem(RUN_ID_STORAGE_KEY)).toBe('run-1');
  });

  it('resumes with the decision and completes', async () => {
    const { run, text, approveButton } = setup();
    await runUntilPaused(run);
    resumeWorkflowStream.mockImplementation(async (runId, input, onLog) => {
      expect(runId).toBe('run-1');
      expect(input).toEqual({ decision: 'approve', note: '' });
      expect(run.getState()).toBe('running');
      onLog(log('llm_response', 'agent_1', 'Shipped'));
      return baseResult();
    });

    approveButton()?.click();
    await vi.waitFor(() => expect(run.getState()).toBe('idle'));

    expect(text()).toContain('Approved');
    expect(text()).toContain('Shipped');
    expect(text()).toContain('Completed');
    expect(approveButton()).toBeNull();
  });

  it('puts the approval card back when the resume request fails and the run is still waiting', async () => {
    const { run, text, chatEl, approveButton } = setup();
    await runUntilPaused(run);
    resumeWorkflowStream.mockRejectedValueOnce(new Error('Network down'));
    fetchRun.mockResolvedValueOnce(pausedResult());

    await run.submitApprovalDecision('approve');

    expect(run.getState()).toBe('paused');
    expect(text()).toContain('Error: Network down');
    expect(text()).toContain('The decision was not sent');
    expect(chatEl.querySelector('.approval-result')).toBeNull();
    expect(approveButton()).not.toBeNull();
    expect(approveButton()?.disabled).toBe(false);
    expect(text()).not.toContain('is working');

    // Retrying works.
    resumeWorkflowStream.mockResolvedValueOnce(baseResult());
    approveButton()?.click();
    await vi.waitFor(() => expect(run.getState()).toBe('idle'));
    expect(resumeWorkflowStream).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Completed');
  });

  it('stays retryable when the server cannot be reached at all', async () => {
    const { run, approveButton } = setup();
    await runUntilPaused(run);
    resumeWorkflowStream.mockRejectedValueOnce(new Error('Failed to fetch'));
    fetchRun.mockRejectedValueOnce(new Error('Failed to fetch'));

    await run.submitApprovalDecision('reject');

    expect(run.getState()).toBe('paused');
    expect(approveButton()).not.toBeNull();
  });

  it('ends the run when the server no longer has it', async () => {
    const { run, text, approveButton } = setup();
    await runUntilPaused(run);
    resumeWorkflowStream.mockRejectedValueOnce(new api.ApiError('Run ID not found', 404));
    fetchRun.mockResolvedValueOnce(null);

    await run.submitApprovalDecision('approve');

    expect(run.getState()).toBe('idle');
    expect(text()).toContain('Failed');
    expect(approveButton()).toBeNull();
    expect(localStorage.getItem(RUN_ID_STORAGE_KEY)).toBeNull();
  });

  it('shows the real outcome when the decision did arrive before the connection dropped', async () => {
    const { run, text } = setup();
    await runUntilPaused(run);
    resumeWorkflowStream.mockRejectedValueOnce(new Error('Connection reset'));
    fetchRun.mockResolvedValueOnce(baseResult({
      logs: [log('input_received', 'approval_1', 'User approved this step.'), log('llm_response', 'agent_1', 'Done anyway')]
    }));

    await run.submitApprovalDecision('approve');

    expect(run.getState()).toBe('idle');
    expect(text()).toContain('Done anyway');
    expect(text()).toContain('Completed');
  });

  it('ignores a decision when nothing is paused', async () => {
    const { run } = setup();
    await run.submitApprovalDecision('approve');
    expect(resumeWorkflowStream).not.toHaveBeenCalled();
  });
});

describe('RunController cancel', () => {
  it('tells the server, then aborts the stream and returns to idle', async () => {
    const { run, text } = setup();
    const { finished, getSignal } = await startRun(run);
    cancelWorkflow.mockImplementation(async (runId) => {
      expect(runId).toBe('run-1');
      // The stream must still be open while the server is asked to cancel.
      expect(getSignal()?.aborted).toBe(false);
      expect(run.isCancelling()).toBe(true);
      return baseResult({ status: 'cancelled' });
    });

    await run.cancel();
    await finished;

    expect(cancelWorkflow).toHaveBeenCalledTimes(1);
    expect(getSignal()?.aborted).toBe(true);
    expect(run.getState()).toBe('idle');
    expect(run.isCancelling()).toBe(false);
    expect(text()).toContain('Cancelled');
    expect(text()).not.toContain('Failed');
    expect(localStorage.getItem(RUN_ID_STORAGE_KEY)).toBeNull();
  });

  it('shows Cancelled once when the stream reports the cancellation first', async () => {
    const { run, chatEl } = setup();
    const { stream, finished } = await startRun(run);
    cancelWorkflow.mockImplementation(async () => {
      stream.resolve(baseResult({ status: 'cancelled' }));
      await finished;
      return baseResult({ status: 'cancelled' });
    });

    await run.cancel();

    expect(run.getState()).toBe('idle');
    expect(chatEl.querySelectorAll('.chat-message.status')).toHaveLength(1);
  });

  it('cancels a paused run', async () => {
    const { run, text, approveButton } = setup();
    await runUntilPaused(run);
    cancelWorkflow.mockResolvedValue(baseResult({ status: 'cancelled' }));

    await run.cancel();

    expect(cancelWorkflow).toHaveBeenCalledWith('run-1');
    expect(run.getState()).toBe('idle');
    expect(approveButton()).toBeNull();
    expect(text()).toContain('Cancelled');
    expect(localStorage.getItem(RUN_ID_STORAGE_KEY)).toBeNull();
  });

  it('treats a run the server no longer has as cancelled', async () => {
    const { run } = setup();
    await runUntilPaused(run);
    cancelWorkflow.mockResolvedValue(null);
    await run.cancel();
    expect(run.getState()).toBe('idle');
  });

  it('keeps the run and allows a retry when the cancel request fails', async () => {
    const { run, text, approveButton } = setup();
    await runUntilPaused(run);
    cancelWorkflow.mockRejectedValueOnce(new Error('Server error'));

    await run.cancel();

    expect(run.getState()).toBe('paused');
    expect(run.isCancelling()).toBe(false);
    expect(text()).toContain('Could not cancel the workflow: Server error');
    expect(approveButton()).not.toBeNull();

    cancelWorkflow.mockResolvedValueOnce(baseResult({ status: 'cancelled' }));
    await run.cancel();
    expect(run.getState()).toBe('idle');
  });

  it('does nothing when idle', async () => {
    const { run } = setup();
    await run.cancel();
    expect(cancelWorkflow).not.toHaveBeenCalled();
  });
});

describe('RunController recovery', () => {
  it('does nothing without a stored run id', async () => {
    const { run } = setup();
    await run.recover();
    expect(fetchRun).not.toHaveBeenCalled();
    expect(run.getState()).toBe('idle');
  });

  it('forgets a run the server no longer has', async () => {
    const { run } = setup();
    localStorage.setItem(RUN_ID_STORAGE_KEY, 'run-1');
    fetchRun.mockResolvedValue(null);
    await run.recover();
    expect(localStorage.getItem(RUN_ID_STORAGE_KEY)).toBeNull();
    expect(run.getState()).toBe('idle');
  });

  it('keeps the run id after a transient error', async () => {
    const { run } = setup();
    localStorage.setItem(RUN_ID_STORAGE_KEY, 'run-1');
    fetchRun.mockRejectedValue(new Error('503'));
    await run.recover();
    expect(localStorage.getItem(RUN_ID_STORAGE_KEY)).toBe('run-1');
  });

  it('restores a paused run with its approval card', async () => {
    const { run, text, approveButton } = setup();
    localStorage.setItem(RUN_ID_STORAGE_KEY, 'run-1');
    fetchRun.mockResolvedValue({
      ...pausedResult(),
      logs: [log('start_prompt', 'agent_1', 'Write a poem'), log('llm_response', 'agent_1', 'Draft')]
    });

    await run.recover();

    expect(run.getState()).toBe('paused');
    expect(text()).toContain('Draft');
    expect(approveButton()).not.toBeNull();
  });

  it('follows a running run by polling, adding only the new messages', async () => {
    vi.useFakeTimers();
    const { run, chatEl, text } = setup();
    localStorage.setItem(RUN_ID_STORAGE_KEY, 'run-1');
    const firstLogs = [log('start_prompt', 'agent_1', 'Write a poem'), log('step_start', 'agent_1')];
    fetchRun.mockResolvedValueOnce(baseResult({ status: 'running', logs: firstLogs }));

    await run.recover();
    expect(run.getState()).toBe('running');
    expect(text()).toContain('Writer is working');
    const promptMessage = chatEl.querySelector('.chat-message.user');

    // Nothing new: the conversation is left alone.
    fetchRun.mockResolvedValueOnce(baseResult({ status: 'running', logs: firstLogs }));
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);
    expect(chatEl.querySelector('.chat-message.user')).toBe(promptMessage);

    fetchRun.mockResolvedValueOnce(baseResult({
      status: 'completed',
      logs: [...firstLogs, log('llm_response', 'agent_1', 'Roses are red')]
    }));
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);

    expect(run.getState()).toBe('idle');
    // The existing message element was kept (not re-rendered), and the reply was appended.
    expect(chatEl.querySelector('.chat-message.user')).toBe(promptMessage);
    expect(chatEl.querySelectorAll('.chat-message.agent')).toHaveLength(1);
    expect(text()).toContain('Roses are red');
    expect(text()).toContain('Completed');
    expect(localStorage.getItem(RUN_ID_STORAGE_KEY)).toBeNull();
  });

  it('can cancel a recovered running run, which stops the polling', async () => {
    vi.useFakeTimers();
    const { run } = setup();
    localStorage.setItem(RUN_ID_STORAGE_KEY, 'run-1');
    fetchRun.mockResolvedValueOnce(baseResult({ status: 'running', logs: [] }));
    await run.recover();
    cancelWorkflow.mockResolvedValue(baseResult({ status: 'cancelled' }));

    await run.cancel();
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS * 3);

    expect(cancelWorkflow).toHaveBeenCalledWith('run-1');
    expect(run.getState()).toBe('idle');
    expect(fetchRun).toHaveBeenCalledTimes(1);
  });
});
