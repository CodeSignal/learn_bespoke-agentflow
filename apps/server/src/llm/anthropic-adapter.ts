import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { MAX_AGENT_TURNS, SUBAGENT_INPUT_DESCRIPTION } from './provider-adapter.js';
import type { AgentRequest, ProviderAdapter } from './provider-adapter.js';

type ToolRunnerParams = Parameters<Anthropic['beta']['messages']['toolRunner']>[0];
type RunnerTool = ToolRunnerParams['tools'][number];
type Effort = NonNullable<NonNullable<ToolRunnerParams['output_config']>['effort']>;

/** Non-streaming requests stay under the SDK's HTTP timeout at this size. */
const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;
const WEB_SEARCH_MAX_USES = 5;
const REFUSAL_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** The Messages API rejects an empty user message. */
const EMPTY_INPUT_PLACEHOLDER = '(no input)';

export interface AnthropicAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  /** Replaces the SDK client, for tests. */
  client?: Anthropic;
}

/** Claude models, through the Anthropic SDK's tool runner. */
export class AnthropicAdapter implements ProviderAdapter {
  private readonly client: Anthropic;

  constructor(options: AnthropicAdapterOptions) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, baseURL: options.baseUrl });
  }

  async run(request: AgentRequest): Promise<string> {
    const tools: RunnerTool[] = request.subagentTools.map((subagent) =>
      betaTool({
        name: subagent.name,
        description: subagent.description,
        inputSchema: {
          type: 'object',
          properties: { input: { type: 'string', description: SUBAGENT_INPUT_DESCRIPTION } },
          required: ['input'],
          additionalProperties: false
        },
        run: ({ input }) => subagent.run(input)
      })
    );

    if (request.webSearch) {
      // A server tool: Anthropic runs the search, so there is no `run` function.
      tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: WEB_SEARCH_MAX_USES });
    }

    const params: ToolRunnerParams = {
      model: request.model,
      max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.userContent.trim() ? request.userContent : EMPTY_INPUT_PLACEHOLDER }],
      tools,
      max_iterations: MAX_AGENT_TURNS,
      // Send the whole conversation each turn instead of relying on a
      // server-held thread, which proxies and some platforms do not support.
      thread: false,
      stream: false
    };

    // Thinking is adaptive by default on current Claude models; effort is the
    // one depth control they all accept.
    if (request.reasoningEffort) {
      params.output_config = { effort: request.reasoningEffort as Effort };
    }

    if (request.refusalFallback) {
      params.betas = [REFUSAL_FALLBACK_BETA];
      params.fallbacks = 'default';
    }

    const message = await this.client.beta.messages.toolRunner(params, { signal: request.signal }).runUntilDone();

    if (message.stop_reason === 'refusal') {
      const explanation = message.stop_details?.explanation;
      throw new Error(explanation ? `The model declined this request: ${explanation}` : 'The model declined this request.');
    }

    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();

    if (!text) {
      if (message.stop_reason === 'max_tokens') {
        throw new Error('The model reached its output token limit before writing an answer.');
      }
      return 'Model returned no text output.';
    }
    return text;
  }
}
