import { randomUUID } from 'node:crypto';
import type { WorkflowGraph } from '@agentflow/types';
import type {
  AgentInvocation,
  AgentRespondOptions,
  AgentRuntimeEvent,
  AgentSubagentInvocation,
  AgentToolsConfig,
  WorkflowLLM
} from '@agentflow/workflow-engine';
import { AnthropicAdapter } from './anthropic-adapter.js';
import type { ConfigSnapshot, ResolvedModel } from './app-config.js';
import { ConfigError } from './app-config.js';
import { OpenAIAdapter } from './openai-adapter.js';
import type { ProviderAdapter, SubagentTool } from './provider-adapter.js';

const MAX_SUBAGENT_PROMPT_CHARS_IN_DESCRIPTION = 280;
const MAX_NESTED_SUBAGENT_NAMES_IN_DESCRIPTION = 4;
/** Tool names are limited to 64 characters by both providers. */
const MAX_TOOL_NAME_LENGTH = 64;
const ROOT_NODE_ID = '__root__';

type AgentSpec = Pick<
  AgentInvocation,
  'systemPrompt' | 'model' | 'reasoningEffort' | 'tools' | 'subagents'
> & { agentName: string };

interface RunContext {
  snapshot: ConfigSnapshot;
  rootNodeId: string;
  depth: number;
  parentCallId?: string;
  signal?: AbortSignal;
  onRuntimeEvent?: (event: AgentRuntimeEvent) => void;
}

export type AdapterFactory = (resolved: ResolvedModel) => ProviderAdapter;

export interface RunPreflightFailure {
  status: 400 | 503;
  error: string;
}

export function toToolName(agentName: string, nodeId: string): string {
  const nameSlug =
    agentName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'agent';
  const nodeSlug = nodeId.replace(/[^a-zA-Z0-9_]+/g, '_').toLowerCase();
  const prefix = `subagent_${nameSlug}`.slice(0, Math.max(1, MAX_TOOL_NAME_LENGTH - nodeSlug.length - 1));
  return `${prefix}_${nodeSlug}`.slice(-MAX_TOOL_NAME_LENGTH);
}

function formatToolKeyLabel(toolKey: string): string {
  if (toolKey === 'web_search') return 'Web Search';
  if (toolKey === 'subagents') return 'Subagents';
  return toolKey
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getEnabledToolLabels(tools: AgentToolsConfig | undefined): string[] {
  if (!tools) return [];
  return Object.entries(tools)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([toolKey]) => formatToolKeyLabel(toolKey));
}

function summarizeSystemPrompt(systemPrompt: string): string {
  const normalized = systemPrompt.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'No system prompt provided.';
  if (normalized.length <= MAX_SUBAGENT_PROMPT_CHARS_IN_DESCRIPTION) return normalized;
  return `${normalized.slice(0, MAX_SUBAGENT_PROMPT_CHARS_IN_DESCRIPTION).trimEnd()}…`;
}

function subagentName(subagent: AgentSubagentInvocation): string {
  return (subagent.agentName || 'Agent').trim() || 'Agent';
}

function summarizeNestedSubagents(subagents: AgentSubagentInvocation[] | undefined): string {
  const names = (subagents ?? []).map(subagentName);
  if (names.length === 0) return 'None';
  if (names.length <= MAX_NESTED_SUBAGENT_NAMES_IN_DESCRIPTION) return names.join(', ');
  const visible = names.slice(0, MAX_NESTED_SUBAGENT_NAMES_IN_DESCRIPTION).join(', ');
  return `${visible}, +${names.length - MAX_NESTED_SUBAGENT_NAMES_IN_DESCRIPTION} more`;
}

function buildSubagentToolDescription(subagent: AgentSubagentInvocation): string {
  const toolLabels = getEnabledToolLabels(subagent.tools);
  return (
    `Delegates work to subagent ${subagentName(subagent)}. ` +
    `System prompt: ${summarizeSystemPrompt(subagent.systemPrompt)} ` +
    `Available tools: ${toolLabels.length > 0 ? toolLabels.join(', ') : 'None'}. ` +
    `Nested subagents: ${summarizeNestedSubagents(subagent.subagents)}.`
  );
}

function defaultAdapterFactory({ provider, apiKey }: ResolvedModel): ProviderAdapter {
  if (provider.type === 'anthropic') {
    return new AnthropicAdapter({ apiKey, baseUrl: provider.baseUrl });
  }
  return new OpenAIAdapter({ apiKey, baseUrl: provider.baseUrl, api: provider.api });
}

/**
 * The engine's LLM: sends each agent to the provider that lists its model in
 * `.config/config.json`. Subagents are plain function tools that call back
 * into this router, so a parent and its subagents may use different providers.
 */
export class ProviderRouterLLM implements WorkflowLLM {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(
    private readonly getSnapshot: () => ConfigSnapshot,
    private readonly createAdapter: AdapterFactory = defaultAdapterFactory
  ) {}

  async respond(invocation: AgentInvocation, options?: AgentRespondOptions): Promise<string> {
    return this.runAgent(
      { ...invocation, agentName: 'Workflow Agent' },
      invocation.userContent,
      {
        snapshot: this.getSnapshot(),
        rootNodeId: options?.parentNodeId || ROOT_NODE_ID,
        depth: 0,
        signal: options?.signal,
        onRuntimeEvent: options?.onRuntimeEvent
      }
    );
  }

  /**
   * Checks before a run starts that every agent node names a configured model
   * whose provider has an API key. Returns null when the graph can run.
   */
  preflight(graph: WorkflowGraph): RunPreflightFailure | null {
    const agentNodes = graph.nodes.filter((node) => node.type === 'agent');
    if (agentNodes.length === 0) return null;

    let snapshot: ConfigSnapshot;
    try {
      snapshot = this.getSnapshot();
    } catch (error) {
      if (error instanceof ConfigError) return { status: 503, error: error.message };
      throw error;
    }

    for (const node of agentNodes) {
      const model = typeof node.data?.model === 'string' ? node.data.model : undefined;
      const lookup = snapshot.lookup(model);
      if (!lookup.ok) {
        return { status: lookup.reason === 'missing_key' ? 503 : 400, error: lookup.message };
      }
    }
    return null;
  }

  private adapterFor(resolved: ResolvedModel): ProviderAdapter {
    const { provider, apiKey } = resolved;
    // Keyed by everything a client is built from, so an edited config or a
    // rotated key gets a fresh client.
    const cacheKey = JSON.stringify([provider.id, provider.type, provider.baseUrl, provider.api, apiKey]);
    let adapter = this.adapters.get(cacheKey);
    if (!adapter) {
      adapter = this.createAdapter(resolved);
      this.adapters.set(cacheKey, adapter);
    }
    return adapter;
  }

  private async runAgent(spec: AgentSpec, userContent: string, context: RunContext): Promise<string> {
    const lookup = context.snapshot.lookup(spec.model);
    if (!lookup.ok) throw new Error(lookup.message);
    const { model } = lookup.resolved;

    const requestedEffort = spec.reasoningEffort;
    const reasoningEffort =
      requestedEffort && model.reasoningEfforts.includes(requestedEffort)
        ? requestedEffort
        : model.defaultReasoningEffort;

    return this.adapterFor(lookup.resolved).run({
      agentName: spec.agentName,
      systemPrompt: spec.systemPrompt,
      userContent,
      model: model.id,
      reasoningEffort,
      webSearch: Boolean(spec.tools?.web_search),
      subagentTools: (spec.subagents ?? []).map((subagent) => this.toSubagentTool(subagent, context)),
      maxOutputTokens: model.maxOutputTokens,
      refusalFallback: model.refusalFallback,
      signal: context.signal
    });
  }

  private toSubagentTool(subagent: AgentSubagentInvocation, parent: RunContext): SubagentTool {
    const name = subagentName(subagent);
    return {
      name: toToolName(name, subagent.nodeId),
      description: buildSubagentToolDescription(subagent),
      run: async (input: string) => {
        const event: AgentRuntimeEvent = {
          type: 'subagent_call_start',
          parentNodeId: parent.rootNodeId,
          subagentNodeId: subagent.nodeId,
          subagentName: name,
          callId: randomUUID(),
          parentCallId: parent.parentCallId,
          depth: parent.depth + 1
        };
        parent.onRuntimeEvent?.(event);
        try {
          const output = await this.runAgent({ ...subagent, agentName: name }, input, {
            ...parent,
            depth: event.depth,
            parentCallId: event.callId
          });
          parent.onRuntimeEvent?.({ ...event, type: 'subagent_call_end' });
          return output;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          parent.onRuntimeEvent?.({ ...event, type: 'subagent_call_error', message });
          throw error;
        }
      }
    };
  }
}
