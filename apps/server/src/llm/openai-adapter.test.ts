import { describe, expect, it } from 'vitest';
import type { Model, ModelProvider, ModelRequest, ModelResponse } from '@openai/agents';
import { Usage } from '@openai/agents';
import { OpenAIAdapter } from './openai-adapter.js';
import type { AgentRequest } from './provider-adapter.js';

type Reply = { text: string } | { tool: string; input: string };

/** A scripted model: the real Agents SDK runs the loop, only the model call is faked. */
function fakeProvider(script: (request: ModelRequest, modelName: string) => Reply | Promise<Reply>) {
  const requests: Array<{ modelName: string; request: ModelRequest }> = [];
  let callCounter = 0;
  const provider: ModelProvider = {
    getModel(modelName?: string): Model {
      const name = modelName ?? 'default';
      return {
        async getResponse(request: ModelRequest): Promise<ModelResponse> {
          requests.push({ modelName: name, request });
          const reply = await script(request, name);
          const output: ModelResponse['output'] =
            'text' in reply
              ? [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: reply.text }] }]
              : [
                  {
                    type: 'function_call',
                    callId: `call_${++callCounter}`,
                    name: reply.tool,
                    arguments: JSON.stringify({ input: reply.input }),
                    status: 'completed'
                  }
                ];
          return { usage: new Usage(), output };
        },
        async *getStreamedResponse() {
          throw new Error('Streaming is not used by this adapter');
        }
      };
    }
  };
  return { provider, requests };
}

const hasToolOutput = (request: ModelRequest): boolean =>
  Array.isArray(request.input) && request.input.some((item) => item.type === 'function_call_result');

const baseRequest: AgentRequest = {
  agentName: 'Tester',
  systemPrompt: 'Be brief.',
  userContent: 'What is 2 + 2?',
  model: 'test-model',
  webSearch: false,
  subagentTools: []
};

describe('OpenAIAdapter', () => {
  it('sends the prompt, model, effort and web search tool through the Agents SDK', async () => {
    const { provider, requests } = fakeProvider(() => ({ text: '  final answer  ' }));
    const adapter = new OpenAIAdapter({ apiKey: 'test', modelProvider: provider });

    const output = await adapter.run({ ...baseRequest, reasoningEffort: 'low', webSearch: true });

    expect(output).toBe('final answer');
    expect(requests).toHaveLength(1);
    expect(requests[0].modelName).toBe('test-model');
    expect(requests[0].request.systemInstructions).toBe('Be brief.');
    expect(requests[0].request.modelSettings.reasoning?.effort).toBe('low');
    expect(requests[0].request.tools.map((tool) => tool.name)).toEqual(['web_search']);
  });

  it('exposes subagents as function tools and feeds their answers back to the model', async () => {
    const { provider, requests } = fakeProvider((request) =>
      hasToolOutput(request) ? { text: 'parent done' } : { tool: 'subagent_helper_node_2', input: 'look this up' }
    );
    const adapter = new OpenAIAdapter({ apiKey: 'test', modelProvider: provider });
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
    expect(requests[0].request.tools[0]).toMatchObject({
      name: 'subagent_helper_node_2',
      description: 'Delegates work to subagent Helper.'
    });
    expect(JSON.stringify(requests[1].request.input)).toContain('child findings');
  });

  it('rejects web search for Chat Completions providers', async () => {
    const { provider } = fakeProvider(() => ({ text: 'unused' }));
    const adapter = new OpenAIAdapter({ apiKey: 'test', api: 'chat_completions', modelProvider: provider });
    await expect(adapter.run({ ...baseRequest, webSearch: true })).rejects.toThrow(/Web Search is not available/);
  });

  it('stops when the signal aborts', async () => {
    const controller = new AbortController();
    const { provider } = fakeProvider(
      (request) =>
        new Promise<Reply>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(new Error('aborted by signal')));
          controller.abort();
        })
    );
    const adapter = new OpenAIAdapter({ apiKey: 'test', modelProvider: provider });
    await expect(adapter.run({ ...baseRequest, signal: controller.signal })).rejects.toThrow();
  });
});
