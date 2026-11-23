import { describe, expect, it } from 'vitest';
import type { AgentRuntimeEvent } from '@agentflow/workflow-engine';
import { ConfigSnapshot, parseAppConfig } from './app-config.js';
import type { AgentRequest, ProviderAdapter } from './provider-adapter.js';
import { ProviderRouterLLM, toToolName } from './router.js';

const config = parseAppConfig({
  defaultModel: 'gpt-a',
  modelAliases: { 'gpt-old': 'gpt-a' },
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      models: [{ id: 'gpt-a', reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' }]
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      type: 'anthropic',
      models: [{ id: 'claude-a', reasoningEfforts: ['medium', 'max'], defaultReasoningEffort: 'medium', refusalFallback: true }]
    }
  ]
});

const allKeys = { OPENAI_API_KEY: 'openai-key', ANTHROPIC_API_KEY: 'anthropic-key' };

/** Fake adapters that record what each provider was asked to run. */
function setup(
  env: NodeJS.ProcessEnv,
  behaviour: (providerId: string, request: AgentRequest) => Promise<string> | string = (id) => `${id} answer`
) {
  const requests: Array<{ providerId: string; request: AgentRequest }> = [];
  let adaptersCreated = 0;
  const router = new ProviderRouterLLM(
    () => new ConfigSnapshot(config, env),
    ({ provider }): ProviderAdapter => {
      adaptersCreated += 1;
      return {
        run: async (request) => {
          requests.push({ providerId: provider.id, request });
          return behaviour(provider.id, request);
        }
      };
    }
  );
  return { router, requests, adapterCount: () => adaptersCreated };
}

const invocation = (model: string, extra: Record<string, unknown> = {}) => ({
  systemPrompt: 'system',
  userContent: 'hello',
  model,
  ...extra
});

describe('ProviderRouterLLM', () => {
  it('sends each model to the provider that lists it', async () => {
    const { router, requests, adapterCount } = setup(allKeys);

    expect(await router.respond(invocation('gpt-a'))).toBe('openai answer');
    expect(await router.respond(invocation('claude-a'))).toBe('anthropic answer');
    expect(await router.respond(invocation('gpt-old'))).toBe('openai answer');

    expect(requests.map((entry) => [entry.providerId, entry.request.model])).toEqual([
      ['openai', 'gpt-a'],
      ['anthropic', 'claude-a'],
      ['openai', 'gpt-a']
    ]);
    expect(requests[1].request.refusalFallback).toBe(true);
    expect(adapterCount()).toBe(2);
  });

  it('keeps a supported effort and replaces an unsupported one with the model default', async () => {
    const { router, requests } = setup(allKeys);
    await router.respond(invocation('gpt-a', { reasoningEffort: 'high' }));
    await router.respond(invocation('claude-a', { reasoningEffort: 'low' }));
    await router.respond(invocation('gpt-a'));
    expect(requests.map((entry) => entry.request.reasoningEffort)).toEqual(['high', 'medium', 'low']);
  });

  it('passes the web search flag and abort signal through', async () => {
    const { router, requests } = setup(allKeys);
    const controller = new AbortController();
    await router.respond(invocation('gpt-a', { tools: { web_search: true } }), { signal: controller.signal });
    expect(requests[0].request.webSearch).toBe(true);
    expect(requests[0].request.signal).toBe(controller.signal);
  });

  it('fails with a clear message for an unknown model or a missing key', async () => {
    const { router } = setup({ OPENAI_API_KEY: 'k' });
    await expect(router.respond(invocation('gpt-99'))).rejects.toThrow(/"gpt-99" is not listed/);
    await expect(router.respond(invocation('claude-a'))).rejects.toThrow(/ANTHROPIC_API_KEY is required/);
  });

  it('runs subagents on their own provider and reports the calls', async () => {
    const events: AgentRuntimeEvent[] = [];
    const { router, requests } = setup(allKeys, async (providerId, request) => {
      if (request.subagentTools.length === 0) return `${providerId}:${request.userContent}`;
      const outputs = [];
      for (const subagent of request.subagentTools) outputs.push(await subagent.run(`task for ${subagent.name}`));
      return `${providerId}[${outputs.join(' | ')}]`;
    });

    const output = await router.respond(
      invocation('gpt-a', {
        tools: { subagents: true },
        subagents: [
          {
            nodeId: 'node_2',
            agentName: 'Researcher',
            systemPrompt: 'research',
            model: 'claude-a',
            tools: { subagents: true },
            subagents: [{ nodeId: 'node_3', agentName: 'Checker', systemPrompt: 'check', model: 'gpt-a' }]
          }
        ]
      }),
      { parentNodeId: 'node_1', onRuntimeEvent: (event) => events.push(event) }
    );

    expect(output).toBe('openai[anthropic[openai:task for subagent_checker_node_3]]');
    expect(requests.map((entry) => [entry.providerId, entry.request.agentName])).toEqual([
      ['openai', 'Workflow Agent'],
      ['anthropic', 'Researcher'],
      ['openai', 'Checker']
    ]);
    expect(requests[0].request.subagentTools[0].description).toContain('Delegates work to subagent Researcher');

    expect(events.map((event) => [event.type, event.subagentNodeId, event.depth])).toEqual([
      ['subagent_call_start', 'node_2', 1],
      ['subagent_call_start', 'node_3', 2],
      ['subagent_call_end', 'node_3', 2],
      ['subagent_call_end', 'node_2', 1]
    ]);
    expect(events.every((event) => event.parentNodeId === 'node_1')).toBe(true);
    expect(events[1].parentCallId).toBe(events[0].callId);
    expect(events[2].callId).toBe(events[1].callId);
  });

  it('reports a failed subagent call and lets the error reach the parent', async () => {
    const events: AgentRuntimeEvent[] = [];
    const { router } = setup(allKeys, async (_providerId, request) => {
      if (request.subagentTools.length === 0) throw new Error('child exploded');
      return request.subagentTools[0].run('go');
    });

    await expect(
      router.respond(
        invocation('gpt-a', { subagents: [{ nodeId: 'n2', agentName: 'Child', systemPrompt: 's', model: 'gpt-a' }] }),
        { onRuntimeEvent: (event) => events.push(event) }
      )
    ).rejects.toThrow('child exploded');
    expect(events.map((event) => event.type)).toEqual(['subagent_call_start', 'subagent_call_error']);
    expect(events[1].message).toBe('child exploded');
  });

  describe('preflight', () => {
    const graph = (...models: Array<string | undefined>) => ({
      nodes: [
        { id: 's', type: 'start', x: 0, y: 0 },
        ...models.map((model, index) => ({ id: `a${index}`, type: 'agent', x: 0, y: 0, data: { model } }))
      ],
      connections: []
    });

    it('accepts graphs whose models all have keys, and graphs without agents', () => {
      expect(setup(allKeys).router.preflight(graph('gpt-a', 'claude-a', undefined, 'gpt-old'))).toBeNull();
      expect(setup({}).router.preflight(graph())).toBeNull();
    });

    it('returns 503 for a missing key and 400 for an unknown model', () => {
      const { router } = setup({ OPENAI_API_KEY: 'k' });
      expect(router.preflight(graph('gpt-a', 'claude-a'))).toEqual({
        status: 503,
        error: 'ANTHROPIC_API_KEY is required to run Agent nodes that use Anthropic models.'
      });
      expect(router.preflight(graph('gpt-99'))).toMatchObject({ status: 400 });
    });
  });
});

describe('toToolName', () => {
  it('builds provider-safe names of at most 64 characters', () => {
    expect(toToolName('Research Helper!', 'node_2')).toBe('subagent_research_helper_node_2');
    expect(toToolName('', 'node_7')).toBe('subagent_agent_node_7');
    const long = toToolName('A'.repeat(200), 'node_12');
    expect(long).toHaveLength(64);
    expect(long.endsWith('_node_12')).toBe(true);
    expect(long).toMatch(/^[a-z0-9_]+$/);
  });
});
