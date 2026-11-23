/** A subagent exposed to a parent agent as a callable tool. */
export interface SubagentTool {
  name: string;
  description: string;
  /** Runs the subagent on the task text the parent model wrote and returns its answer. */
  run: (input: string) => Promise<string>;
}

/** One agent run, already resolved to a provider and model. */
export interface AgentRequest {
  agentName: string;
  systemPrompt: string;
  userContent: string;
  model: string;
  reasoningEffort?: string;
  webSearch: boolean;
  subagentTools: SubagentTool[];
  maxOutputTokens?: number;
  refusalFallback?: boolean;
  signal?: AbortSignal;
}

/** Runs an agent loop (model calls plus tool calls) against one provider. */
export interface ProviderAdapter {
  run: (request: AgentRequest) => Promise<string>;
}

/** Upper bound on model turns in one agent run, so a tool loop cannot run forever. */
export const MAX_AGENT_TURNS = 20;

export const SUBAGENT_INPUT_DESCRIPTION = 'The task for the subagent, with all the context it needs.';
