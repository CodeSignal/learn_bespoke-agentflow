import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AnthropicAdapter } from './anthropic-adapter.js';
import type { AgentRequest } from './provider-adapter.js';

type RequestBody = Record<string, unknown> & {
  messages: Array<{ role: string; content: unknown }>;
  tools?: Array<Record<string, unknown>>;
};

type ScriptedResponse = { content: Array<Record<string, unknown>>; stop_reason: string; stop_details?: unknown };

/**
 * The real Anthropic SDK and tool runner, with only the HTTP layer replaced:
 * every request body is recorded and answered from a script.
 */
function fakeClient(script: (body: RequestBody, call: number) => ScriptedResponse) {
  const bodies: RequestBody[] = [];
  const headers: Headers[] = [];
  const client = new Anthropic({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as RequestBody;
      bodies.push(body);
      headers.push(new Headers(init?.headers));
      const reply = script(body, bodies.length);
      return new Response(
        JSON.stringify({
          id: `msg_${bodies.length}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
          ...reply
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
  });
  return { client, bodies, headers };
}

const text = (value: string): ScriptedResponse => ({ content: [{ type: 'text', text: value }], stop_reason: 'end_turn' });

const baseRequest: AgentRequest = {
  agentName: 'Tester',
  systemPrompt: 'Be brief.',
  userContent: 'What is 2 + 2?',
  model: 'claude-opus-5-5',
  webSearch: false,
  subagentTools: []
};

describe('AnthropicAdapter', () => {
  it('sends the prompt, model, effort and output cap to the Messages API', async () => {
    const { client, bodies } = fakeClient(() => text('  four  '));
    const adapter = new AnthropicAdapter({ apiKey: 'unused', client });

    const output = await adapter.run({ ...baseRequest, reasoningEffort: 'high', maxOutputTokens: 4096 });

    expect(output).toBe('four');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 4096,
      system: 'Be brief.',
      output_config: { effort: 'high' },
      messages: [{ role: 'user', content: 'What is 2 + 2?' }]
    });
    // Thinking is left to the model's adaptive default and no sampling parameters are sent.
    expect(bodies[0]).not.toHaveProperty('thinking');
    expect(bodies[0]).not.toHaveProperty('temperature');
    expect(bodies[0]).not.toHaveProperty('thread');
    expect(bodies[0]).not.toHaveProperty('fallbacks');
  });

  it('adds the web search server tool and the refusal fallback when configured', async () => {
    const { client, bodies, headers } = fakeClient(() => text('ok'));
    const adapter = new AnthropicAdapter({ apiKey: 'unused', client });

    await adapter.run({ ...baseRequest, webSearch: true, refusalFallback: true });

    expect(bodies[0].tools).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }]);
    expect(bodies[0].fallbacks).toBe('default');
    expect(headers[0].get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
  });

  it('runs subagent tools and returns their output to the model', async () => {
    const { client, bodies } = fakeClient((_body, call) =>
      call === 1
        ? {
            content: [{ type: 'tool_use', id: 'toolu_1', name: 'subagent_helper_node_2', input: { input: 'look this up' } }],
            stop_reason: 'tool_use'
          }
        : text('parent done')
    );
    const adapter = new AnthropicAdapter({ apiKey: 'unused', client });
    const subagentInputs: string[] = [];

    const output = await adapter.run({
      ...baseRequest,
      subagentTools: [
        {
          name: 'subagent_helper_node_2',
          description: 'Delegates work to subagent Helper.',
          run: async (input) => {
            subagentInputs.push(input);
            return 'child findings';
          }
        }
      ]
    });

    expect(output).toBe('parent done');
    expect(subagentInputs).toEqual(['look this up']);
    expect(bodies[0].tools?.[0]).toMatchObject({
      name: 'subagent_helper_node_2',
      description: 'Delegates work to subagent Helper.',
      input_schema: { type: 'object', required: ['input'] }
    });
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1].messages)).toContain('child findings');
    expect(JSON.stringify(bodies[1].messages)).toContain('toolu_1');
  });

  it('replaces an empty user message, which the API would reject', async () => {
    const { client, bodies } = fakeClient(() => text('ok'));
    await new AnthropicAdapter({ apiKey: 'unused', client }).run({ ...baseRequest, userContent: '  ' });
    expect(bodies[0].messages[0].content).toBe('(no input)');
  });

  it('turns a refusal into an error with the explanation', async () => {
    const { client } = fakeClient(() => ({
      content: [],
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: 'This request was declined.' }
    }));
    await expect(new AnthropicAdapter({ apiKey: 'unused', client }).run(baseRequest)).rejects.toThrow(
      'The model declined this request: This request was declined.'
    );
  });

  it('reports hitting the output limit before any answer', async () => {
    const { client } = fakeClient(() => ({ content: [], stop_reason: 'max_tokens' }));
    await expect(new AnthropicAdapter({ apiKey: 'unused', client }).run(baseRequest)).rejects.toThrow(/output token limit/);
  });

  it('stops when the signal aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const { client, bodies } = fakeClient(() => text('never'));
    await expect(
      new AnthropicAdapter({ apiKey: 'unused', client }).run({ ...baseRequest, signal: controller.signal })
    ).rejects.toThrow();
    expect(bodies).toHaveLength(0);
  });
});
