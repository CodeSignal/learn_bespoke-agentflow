import { Agent, OpenAIProvider, Runner, tool, webSearchTool } from '@openai/agents';
import type { ModelProvider, ModelSettings, Tool } from '@openai/agents';
import { z } from 'zod';
import type { OpenAiApi } from './app-config.js';
import { MAX_AGENT_TURNS, SUBAGENT_INPUT_DESCRIPTION } from './provider-adapter.js';
import type { AgentRequest, ProviderAdapter } from './provider-adapter.js';

type ReasoningEffort = NonNullable<NonNullable<ModelSettings['reasoning']>['effort']>;

export interface OpenAIAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  api?: OpenAiApi;
  /** Replaces the SDK's OpenAI provider, for tests. */
  modelProvider?: ModelProvider;
}

function toTextOutput(finalOutput: unknown): string {
  if (typeof finalOutput === 'string') return finalOutput.trim();
  if (finalOutput === undefined || finalOutput === null) return 'Model returned no text output.';
  return JSON.stringify(finalOutput);
}

/**
 * OpenAI and OpenAI-compatible services, through the OpenAI Agents SDK.
 * Each adapter has its own client, so several providers of this type can be
 * configured side by side with different keys and base URLs.
 */
export class OpenAIAdapter implements ProviderAdapter {
  private readonly runner: Runner;

  private readonly api: OpenAiApi;

  constructor(options: OpenAIAdapterOptions) {
    this.api = options.api ?? 'responses';
    const modelProvider =
      options.modelProvider ??
      new OpenAIProvider({
        apiKey: options.apiKey,
        baseURL: options.baseUrl,
        useResponses: this.api === 'responses'
      });
    // Trace export goes to OpenAI with the process-wide key, which is wrong
    // for proxies and compatible services, so it stays off.
    this.runner = new Runner({ modelProvider, tracingDisabled: true });
  }

  async run(request: AgentRequest): Promise<string> {
    const tools: Tool[] = [];

    if (request.webSearch) {
      if (this.api !== 'responses') {
        throw new Error(
          `Web Search is not available for "${request.model}": its provider uses the Chat Completions API.`
        );
      }
      tools.push(webSearchTool());
    }

    for (const subagent of request.subagentTools) {
      tools.push(
        tool({
          name: subagent.name,
          description: subagent.description,
          parameters: z.object({ input: z.string().describe(SUBAGENT_INPUT_DESCRIPTION) }),
          execute: ({ input }) => subagent.run(input)
        })
      );
    }

    const agent = new Agent({
      name: request.agentName,
      instructions: request.systemPrompt,
      model: request.model,
      tools,
      modelSettings: request.reasoningEffort
        ? { reasoning: { effort: request.reasoningEffort as ReasoningEffort } }
        : undefined
    });

    const result = await this.runner.run(agent, request.userContent, {
      maxTurns: MAX_AGENT_TURNS,
      signal: request.signal
    });
    return toTextOutput(result.finalOutput);
  }
}
