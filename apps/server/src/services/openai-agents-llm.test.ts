import { describe, expect, it } from 'vitest';
import type { Model, ModelProvider, ModelRequest, ModelResponse } from '@openai/agents';
import { Usage } from '@openai/agents';
import type { AgentRuntimeEvent } from '@agentflow/workflow-engine';
import { OpenAIAgentsLLMService } from './openai-agents-llm.js';

type Reply = { text: string } | { tool: string; input: string };

/** A scripted model: the real SDK runs the agent loop, only the model call is faked. */
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
          throw new Error('Streaming is not used by this service');
        }
      };
    }
  };
  return { provider, requests };
}

const hasToolOutput = (request: ModelRequest): boolean =>
  Array.isArray(request.input) && request.input.some((item) => item.type === 'function_call_result');

const service = (provider: ModelProvider) => new OpenAIAgentsLLMService({ modelProvider: provider, tracingDisabled: true });

describe('OpenAIAgentsLLMService', () => {
  it('sends the prompt, model, reasoning effort and web search tool to the SDK', async () => {
    const { provider, requests } = fakeProvider(() => ({ text: '  final answer  ' }));

    const output = await service(provider).respond({
      systemPrompt: 'Be brief.',
      userContent: 'What is 2 + 2?',
      model: 'test-model',
      reasoningEffort: 'low',
      tools: { web_search: true }
    });

    expect(output).toBe('final answer');
    expect(requests).toHaveLength(1);
    expect(requests[0].modelName).toBe('test-model');
    expect(requests[0].request.systemInstructions).toBe('Be brief.');
    expect(requests[0].request.modelSettings.reasoning?.effort).toBe('low');
    expect(requests[0].request.tools.map((tool) => tool.name)).toEqual(['web_search']);
  });

  it('exposes subagents as tools and reports their calls', async () => {
    const { provider, requests } = fakeProvider((request) => {
      if (request.systemInstructions === 'parent') {
        return hasToolOutput(request)
          ? { text: 'parent done' }
          : { tool: 'subagent_researcher_node_2', input: 'look this up' };
      }
      return { text: 'child findings' };
    });
    const events: AgentRuntimeEvent[] = [];

    const output = await service(provider).respond(
      {
        systemPrompt: 'parent',
        userContent: 'go',
        model: 'parent-model',
        tools: { subagents: true },
        subagents: [{ nodeId: 'node_2', agentName: 'Researcher', systemPrompt: 'child', model: 'child-model' }]
      },
      { parentNodeId: 'node_1', onRuntimeEvent: (event) => events.push(event) }
    );

    expect(output).toBe('parent done');
    expect(requests.map((entry) => entry.modelName)).toEqual(['parent-model', 'child-model', 'parent-model']);
    expect(requests[0].request.tools[0]).toMatchObject({ name: 'subagent_researcher_node_2' });
    expect(events.map((event) => event.type)).toEqual(['subagent_call_start', 'subagent_call_end']);
    expect(events[0]).toMatchObject({
      parentNodeId: 'node_1',
      subagentNodeId: 'node_2',
      subagentName: 'Researcher',
      depth: 1
    });
    expect(events[1].callId).toBe(events[0].callId);
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

    await expect(
      service(provider).respond(
        { systemPrompt: 's', userContent: 'u', model: 'm' },
        { signal: controller.signal }
      )
    ).rejects.toThrow();
  });
});
