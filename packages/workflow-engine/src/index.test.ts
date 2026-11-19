import { describe, expect, it } from 'vitest';
import type { WorkflowConnection, WorkflowGraph, WorkflowNode } from '@agentflow/types';
import { WorkflowEngine } from './index.js';
import type { AgentInvocation, AgentRespondOptions, WorkflowLLM } from './index.js';

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type,
  x: 0,
  y: 0,
  data
});

const edge = (source: string, target: string, sourceHandle?: string): WorkflowConnection => ({
  source,
  target,
  sourceHandle
});

const start = (initialInput = 'hello') => node('start', 'start', { initialInput });

type Responder = (invocation: AgentInvocation, options?: AgentRespondOptions) => Promise<string> | string;

function stubLlm(responder: Responder) {
  const calls: AgentInvocation[] = [];
  const llm: WorkflowLLM = {
    respond: async (invocation, options) => {
      calls.push(invocation);
      return responder(invocation, options);
    }
  };
  return { llm, calls };
}

/** Resolves when the signal aborts, otherwise after `ms`. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });
}

const logTypes = (engine: WorkflowEngine, nodeId?: string) =>
  engine
    .getLogs()
    .filter((entry) => nodeId === undefined || entry.nodeId === nodeId)
    .map((entry) => entry.type);

describe('linear execution', () => {
  it('passes the start input to the agent and completes', async () => {
    const { llm, calls } = stubLlm(() => 'answer');
    const engine = new WorkflowEngine(
      { nodes: [start('question'), node('a', 'agent')], connections: [edge('start', 'a')] },
      { llm }
    );

    const result = await engine.run();

    expect(result.status).toBe('completed');
    expect(result.currentNodeId).toBeNull();
    expect(calls[0].userContent).toBe('question');
    expect(result.state.a).toBe('answer');
    expect(logTypes(engine, 'a')).toEqual(['step_start', 'start_prompt', 'llm_response']);
  });

  it('substitutes {{PREVIOUS_OUTPUT}} literally, including $ sequences', async () => {
    const tricky = "cost: $$5 and $& and $' and $1 end";
    const { llm, calls } = stubLlm(() => 'ok');
    const engine = new WorkflowEngine(
      {
        nodes: [start(tricky), node('a', 'agent', { userPrompt: 'IN[{{PREVIOUS_OUTPUT}}] again {{PREVIOUS_OUTPUT}}' })],
        connections: [edge('start', 'a')]
      },
      { llm }
    );

    await engine.run();

    expect(calls[0].userContent).toBe(`IN[${tricky}] again ${tricky}`);
  });

  it('fails when the graph has no start node', async () => {
    const engine = new WorkflowEngine({ nodes: [node('a', 'agent')], connections: [] });
    const result = await engine.run();
    expect(result.status).toBe('failed');
    expect(result.logs.at(-1)?.content).toMatch(/No start node/);
  });

  it('fails with a single llm_error entry when no LLM is configured', async () => {
    const engine = new WorkflowEngine({
      nodes: [start(), node('a', 'agent')],
      connections: [edge('start', 'a')]
    });
    const result = await engine.run();
    expect(result.status).toBe('failed');
    expect(logTypes(engine, 'a')).toEqual(['step_start', 'start_prompt', 'llm_error']);
  });

  it('generates a distinct run id per engine', () => {
    const graph: WorkflowGraph = { nodes: [], connections: [] };
    const ids = new Set(Array.from({ length: 50 }, () => new WorkflowEngine(graph).getRunId()));
    expect(ids.size).toBe(50);
  });
});

describe('condition nodes', () => {
  const graph = (conditions: unknown[], input: string): WorkflowGraph => ({
    nodes: [start(input), node('c', 'if', { conditions }), node('first', 'agent'), node('second', 'agent'), node('other', 'agent')],
    connections: [
      edge('start', 'c'),
      edge('c', 'first', 'condition-0'),
      edge('c', 'second', 'condition-1'),
      edge('c', 'other', 'false')
    ]
  });

  const run = async (conditions: unknown[], input: string) => {
    const { llm } = stubLlm(() => 'x');
    const engine = new WorkflowEngine(graph(conditions, input), { llm });
    const result = await engine.run();
    return Object.keys(result.state).filter((key) => ['first', 'second', 'other'].includes(key));
  };

  it('follows the first matching condition, case-insensitively', async () => {
    const conditions = [
      { operator: 'equal', value: 'yes' },
      { operator: 'contains', value: 'MAYBE' }
    ];
    expect(await run(conditions, 'YES')).toEqual(['first']);
    expect(await run(conditions, 'well, maybe later')).toEqual(['second']);
  });

  it('falls back to the false branch when nothing matches or the value is empty', async () => {
    expect(await run([{ operator: 'contains', value: 'zzz' }], 'abc')).toEqual(['other']);
    expect(await run([{ operator: 'contains', value: '   ' }], 'abc')).toEqual(['other']);
  });

  it('still runs graphs saved with the legacy condition string and true handle', async () => {
    const { llm } = stubLlm(() => 'x');
    const engine = new WorkflowEngine(
      {
        nodes: [start('has needle inside'), node('c', 'if', { condition: 'needle' }), node('yes', 'agent')],
        connections: [edge('start', 'c'), edge('c', 'yes', 'true')]
      },
      { llm }
    );
    const result = await engine.run();
    expect(result.state.yes).toBe('x');
  });
});

describe('loops', () => {
  const loopGraph: WorkflowGraph = {
    nodes: [start('x'), node('a', 'agent'), node('c', 'if', { conditions: [{ operator: 'contains', value: 'done' }] })],
    connections: [edge('start', 'a'), edge('a', 'c'), edge('c', 'a', 'false')]
  };

  it('lets a loop run until its exit condition matches', async () => {
    let count = 0;
    const { llm, calls } = stubLlm(() => (++count === 3 ? 'done' : 'again'));
    const result = await new WorkflowEngine(loopGraph, { llm }).run();
    expect(result.status).toBe('completed');
    expect(calls).toHaveLength(3);
  });

  it('stops a loop that never exits at the step limit', async () => {
    const { llm, calls } = stubLlm(() => 'again');
    const engine = new WorkflowEngine(loopGraph, { llm, maxSteps: 11 });
    const result = await engine.run();

    expect(result.status).toBe('failed');
    // start + 5 x (agent, condition) = 11 steps; the 12th is refused.
    expect(calls).toHaveLength(5);
    expect(result.logs.at(-1)).toMatchObject({ type: 'error' });
    expect(result.logs.at(-1)?.content).toMatch(/stopped after 11 steps/);
  });

  it('uses a default step limit', async () => {
    const { llm, calls } = stubLlm(() => 'again');
    const result = await new WorkflowEngine(loopGraph, { llm }).run();
    expect(result.status).toBe('failed');
    expect(calls.length).toBeLessThanOrEqual(100);
  });
});

describe('parallel branches', () => {
  it('runs every outgoing branch', async () => {
    const { llm, calls } = stubLlm((invocation) => `out:${invocation.systemPrompt}`);
    const result = await new WorkflowEngine(
      {
        nodes: [start(), node('a', 'agent', { systemPrompt: 'A' }), node('b', 'agent', { systemPrompt: 'B' })],
        connections: [edge('start', 'a'), edge('start', 'b')]
      },
      { llm }
    ).run();

    expect(result.status).toBe('completed');
    expect(calls).toHaveLength(2);
    expect(result.state).toMatchObject({ a: 'out:A', b: 'out:B' });
  });

  it('aborts sibling branches when one fails and does not start their successors', async () => {
    let siblingAborted = false;
    const { llm, calls } = stubLlm(async (invocation, options) => {
      if (invocation.systemPrompt === 'bad') {
        await abortableDelay(5);
        throw new Error('boom');
      }
      options?.signal?.addEventListener('abort', () => {
        siblingAborted = true;
      });
      await abortableDelay(5_000, options?.signal);
      return 'late';
    });
    const engine = new WorkflowEngine(
      {
        nodes: [
          start(),
          node('bad', 'agent', { systemPrompt: 'bad' }),
          node('slow', 'agent', { systemPrompt: 'slow' }),
          node('next', 'agent', { systemPrompt: 'next' })
        ],
        connections: [edge('start', 'bad'), edge('start', 'slow'), edge('slow', 'next')]
      },
      { llm }
    );

    const result = await engine.run();

    expect(result.status).toBe('failed');
    expect(siblingAborted).toBe(true);
    expect(calls.map((call) => call.systemPrompt).sort()).toEqual(['bad', 'slow']);
    expect(result.state.slow).toBeUndefined();
    expect(result.logs.filter((entry) => entry.type === 'llm_error')).toHaveLength(1);
    expect(result.logs.filter((entry) => entry.type === 'error')).toHaveLength(0);
  });
});

describe('approval nodes', () => {
  const approvalGraph: WorkflowGraph = {
    nodes: [
      start('draft'),
      node('writer', 'agent', { systemPrompt: 'writer' }),
      node('gate', 'approval'),
      node('publish', 'agent', { systemPrompt: 'publish' }),
      node('rework', 'agent', { systemPrompt: 'rework' })
    ],
    connections: [
      edge('start', 'writer'),
      edge('writer', 'gate'),
      edge('gate', 'publish', 'approve'),
      edge('gate', 'rework', 'reject')
    ]
  };

  it('pauses, then follows the approve branch with the pre-approval output', async () => {
    const { llm, calls } = stubLlm((invocation) => `${invocation.systemPrompt} output`);
    const engine = new WorkflowEngine(approvalGraph, { llm });

    const paused = await engine.run();
    expect(paused).toMatchObject({ status: 'paused', waitingForInput: true, currentNodeId: 'gate' });

    const done = await engine.resume({ decision: 'approve', note: 'ship it' });
    expect(done.status).toBe('completed');
    expect(calls.map((call) => call.systemPrompt)).toEqual(['writer', 'publish']);
    expect(calls[1].userContent).toBe('writer output');
    expect(done.state.gate_approval).toEqual({ decision: 'approve', note: 'ship it' });
  });

  it('follows the reject branch', async () => {
    const { llm, calls } = stubLlm(() => 'x');
    const engine = new WorkflowEngine(approvalGraph, { llm });
    await engine.run();
    await engine.resume({ decision: 'reject' });
    expect(calls.map((call) => call.systemPrompt)).toEqual(['writer', 'rework']);
  });

  it('ignores resume when the run is not paused', async () => {
    const { llm } = stubLlm(() => 'x');
    const engine = new WorkflowEngine(
      { nodes: [start(), node('a', 'agent')], connections: [edge('start', 'a')] },
      { llm }
    );
    await engine.run();
    const result = await engine.resume({ decision: 'approve' });
    expect(result.status).toBe('completed');
  });

  it('queues parallel approvals and asks for them one at a time', async () => {
    const { llm, calls } = stubLlm((invocation) => invocation.systemPrompt);
    const engine = new WorkflowEngine(
      {
        nodes: [
          start(),
          node('g1', 'approval'),
          node('g2', 'approval'),
          node('after1', 'agent', { systemPrompt: 'after1' }),
          node('after2', 'agent', { systemPrompt: 'after2' })
        ],
        connections: [
          edge('start', 'g1'),
          edge('start', 'g2'),
          edge('g1', 'after1', 'approve'),
          edge('g2', 'after2', 'approve')
        ]
      },
      { llm }
    );

    expect((await engine.run()).currentNodeId).toBe('g1');
    const second = await engine.resume({ decision: 'approve' });
    expect(second).toMatchObject({ status: 'paused', currentNodeId: 'g2' });
    const done = await engine.resume({ decision: 'approve' });
    expect(done.status).toBe('completed');
    expect(calls.map((call) => call.systemPrompt)).toEqual(['after1', 'after2']);
  });

  const parallelGate = (connections: WorkflowConnection[]): WorkflowGraph => ({
    nodes: [
      start(),
      node('gate', 'approval'),
      node('side', 'agent', { systemPrompt: 'side' }),
      node('sideNext', 'agent', { systemPrompt: 'sideNext' })
    ],
    connections: [...connections, edge('side', 'sideNext')]
  });

  it('finishes an in-flight sibling branch and defers its successors until the approval is answered', async () => {
    const { llm, calls } = stubLlm(async (invocation) => {
      await abortableDelay(5);
      return invocation.systemPrompt;
    });
    const engine = new WorkflowEngine(parallelGate([edge('start', 'side'), edge('start', 'gate')]), { llm });

    const paused = await engine.run();
    expect(paused.status).toBe('paused');
    expect(calls.map((call) => call.systemPrompt)).toEqual(['side']);

    const done = await engine.resume({ decision: 'approve' });
    expect(done.status).toBe('completed');
    expect(calls.map((call) => call.systemPrompt)).toEqual(['side', 'sideNext']);
  });

  it('does not drop a sibling branch that starts after the approval paused the run', async () => {
    const { llm, calls } = stubLlm((invocation) => invocation.systemPrompt);
    const engine = new WorkflowEngine(parallelGate([edge('start', 'gate'), edge('start', 'side')]), { llm });

    const paused = await engine.run();
    expect(paused.status).toBe('paused');
    expect(calls).toHaveLength(0);

    const done = await engine.resume({ decision: 'approve' });
    expect(done.status).toBe('completed');
    expect(calls.map((call) => call.systemPrompt)).toEqual(['side', 'sideNext']);
  });

  it('resumes a run restored from a persisted snapshot', async () => {
    const { llm } = stubLlm(() => 'x');
    const first = new WorkflowEngine(approvalGraph, { llm });
    const paused = await first.run();

    const snapshot = JSON.parse(JSON.stringify(paused)) as typeof paused;
    const restored = new WorkflowEngine(approvalGraph, {
      llm,
      runId: snapshot.runId,
      initialState: {
        state: snapshot.state,
        currentNodeId: snapshot.currentNodeId,
        status: 'paused',
        waitingForInput: true,
        logs: snapshot.logs
      }
    });

    const done = await restored.resume({ decision: 'approve' });
    expect(done.status).toBe('completed');
    expect(done.runId).toBe(paused.runId);
    expect(done.state.publish).toBe('x');
  });
});

describe('cancel', () => {
  it('stops a running workflow and aborts the in-flight call', async () => {
    let started!: () => void;
    const callStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { llm, calls } = stubLlm(async (_invocation, options) => {
      started();
      await abortableDelay(5_000, options?.signal);
      return 'never';
    });
    const engine = new WorkflowEngine(
      { nodes: [start(), node('a', 'agent'), node('b', 'agent')], connections: [edge('start', 'a'), edge('a', 'b')] },
      { llm }
    );

    const running = engine.run();
    await callStarted;
    expect(engine.cancel()).toBe(true);
    const result = await running;

    expect(result).toMatchObject({ status: 'cancelled', waitingForInput: false, currentNodeId: null });
    expect(calls).toHaveLength(1);
    expect(result.logs.at(-1)).toMatchObject({ nodeId: 'system', type: 'cancelled' });
    expect(result.logs.some((entry) => entry.type === 'llm_error' || entry.type === 'error')).toBe(false);
  });

  it('abandons a paused workflow', async () => {
    const engine = new WorkflowEngine({
      nodes: [start(), node('gate', 'approval')],
      connections: [edge('start', 'gate')]
    });
    await engine.run();

    expect(engine.cancel()).toBe(true);
    expect(engine.getResult()).toMatchObject({ status: 'cancelled', waitingForInput: false });
    expect((await engine.resume({ decision: 'approve' })).status).toBe('cancelled');
  });

  it('does nothing once the run has finished', async () => {
    const engine = new WorkflowEngine({ nodes: [start()], connections: [] });
    await engine.run();
    expect(engine.cancel()).toBe(false);
    expect(engine.getStatus()).toBe('completed');
  });
});

describe('subagents', () => {
  const parent = (tools: Record<string, boolean> = { subagents: true }) =>
    node('parent', 'agent', { agentName: 'Parent', tools });
  const sub = (from: string, to: string) => edge(from, to, 'subagent');

  const runWith = async (nodes: WorkflowNode[], connections: WorkflowConnection[]) => {
    const { llm, calls } = stubLlm(() => 'ok');
    const engine = new WorkflowEngine({ nodes: [start(), ...nodes], connections: [edge('start', 'parent'), ...connections] }, { llm });
    const result = await engine.run();
    return { result, calls, error: result.logs.find((entry) => entry.type === 'error')?.content };
  };

  it('passes nested subagents to the LLM as a tree and does not execute them as steps', async () => {
    const { result, calls } = await runWith(
      [parent(), node('child', 'agent', { agentName: 'Child', tools: { subagents: true } }), node('grandchild', 'agent', { agentName: 'Grandchild' })],
      [sub('parent', 'child'), sub('child', 'grandchild')]
    );

    expect(result.status).toBe('completed');
    expect(calls).toHaveLength(1);
    expect(calls[0].subagents).toMatchObject([
      { nodeId: 'child', agentName: 'Child', subagents: [{ nodeId: 'grandchild', agentName: 'Grandchild' }] }
    ]);
  });

  it('rejects a subagent cycle', async () => {
    const { result, error } = await runWith(
      [parent(), node('child', 'agent', { tools: { subagents: true } })],
      [sub('parent', 'child'), sub('child', 'parent')]
    );
    expect(result.status).toBe('failed');
    expect(error).toMatch(/cannot participate in workflow execution edges|cycle/i);
  });

  it('rejects a subagent with two parents', async () => {
    const { error } = await runWith(
      [parent(), node('other', 'agent', { tools: { subagents: true } }), node('child', 'agent')],
      [sub('parent', 'child'), sub('other', 'child')]
    );
    expect(error).toMatch(/more than one parent/);
  });

  it('rejects a subagent that also has execution edges', async () => {
    const { error } = await runWith(
      [parent(), node('child', 'agent'), node('after', 'agent')],
      [sub('parent', 'child'), edge('child', 'after')]
    );
    expect(error).toMatch(/cannot participate in workflow execution edges/);
  });

  it('rejects subagent links when the Subagents tool is disabled', async () => {
    const { error } = await runWith([parent({ subagents: false }), node('child', 'agent')], [sub('parent', 'child')]);
    expect(error).toMatch(/Subagents tool is disabled/);
  });
});
