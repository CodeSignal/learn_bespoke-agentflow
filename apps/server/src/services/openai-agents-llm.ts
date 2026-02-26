import type {
  AgentInvocation,
  AgentRespondOptions,
  AgentRuntimeEvent,
  AgentSubagentInvocation,
  AgentToolsConfig,
  WorkflowLLM
} from '@agentic/workflow-engine';

type ToolCallDetails = {
  toolCall?: {
    callId?: unknown;
    id?: unknown;
  };
};

type AgentsSdkTool = {
  name?: unknown;
};

type AgentsSdkAgent = {
  asTool: (options: {
    toolName?: string;
    toolDescription?: string;
    runOptions?: { maxTurns?: number };
  }) => AgentsSdkTool;
};

type AgentsSdkRunner = {
  on(
    event: 'agent_start',
    listener: (context: unknown, agent: AgentsSdkAgent) => void
  ): void;
  on(
    event: 'agent_end',
    listener: (context: unknown, agent: AgentsSdkAgent, output: string) => void
  ): void;
  on(
    event: 'agent_tool_start',
    listener: (
      context: unknown,
      agent: AgentsSdkAgent,
      tool: AgentsSdkTool,
      details: ToolCallDetails
    ) => void
  ): void;
  on(
    event: 'agent_tool_end',
    listener: (
      context: unknown,
      agent: AgentsSdkAgent,
      tool: AgentsSdkTool,
      result: string,
      details: ToolCallDetails
    ) => void
  ): void;
  run: (
    agent: AgentsSdkAgent,
    input: string,
    options?: { maxTurns?: number }
  ) => Promise<{ finalOutput?: unknown }>;
};

type AgentsSdkModule = {
  Agent: new (config: Record<string, unknown>) => AgentsSdkAgent;
  Runner: new () => AgentsSdkRunner;
  webSearchTool: () => AgentsSdkTool;
};

type AgentNodeMeta = {
  nodeId: string;
  agentName: string;
};

type AgentContextState = {
  nodeId: string;
  depth: number;
  activeCallId?: string;
};

type PendingChildCall = {
  callId: string;
  depth: number;
};

type AgentBuildRegistry = {
  toolRegistry: Map<string, AgentNodeMeta>;
  agentRegistry: WeakMap<object, AgentNodeMeta>;
};

let sdkModulePromise: Promise<AgentsSdkModule> | null = null;
const MAX_AGENT_TURNS = 20;
const MAX_SUBAGENT_PROMPT_CHARS_IN_DESCRIPTION = 280;

async function loadAgentsSdk(): Promise<AgentsSdkModule> {
  if (!sdkModulePromise) {
    sdkModulePromise = (new Function('moduleName', 'return import(moduleName);') as (
      moduleName: string
    ) => Promise<AgentsSdkModule>)('@openai/agents').catch((error: unknown) => {
      sdkModulePromise = null;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `OpenAI Agents SDK is required but '@openai/agents' is unavailable: ${message}`
      );
    });
  }
  return sdkModulePromise;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function toToolName(agentName: string, nodeId: string): string {
  const nameSlug = agentName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const fallbackName = nameSlug || 'agent';
  const nodeSlug = nodeId.replace(/[^a-zA-Z0-9_]+/g, '_');
  return `subagent_${fallbackName}_${nodeSlug}`.toLowerCase();
}

function getAgentName(invocation: AgentInvocation | AgentSubagentInvocation): string {
  if (
    'agentName' in invocation &&
    typeof invocation.agentName === 'string' &&
    invocation.agentName.trim()
  ) {
    return invocation.agentName.trim();
  }
  return 'Workflow Agent';
}

function getToolName(tool: AgentsSdkTool): string | null {
  return typeof tool.name === 'string' && tool.name.trim() ? tool.name : null;
}

function getToolCallId(details: ToolCallDetails): string | null {
  const callId = details.toolCall?.callId;
  if (typeof callId === 'string' && callId.trim()) {
    return callId;
  }
  const id = details.toolCall?.id;
  if (typeof id === 'string' && id.trim()) {
    return id;
  }
  return null;
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
  if (!normalized) {
    return 'No system prompt provided.';
  }
  if (normalized.length <= MAX_SUBAGENT_PROMPT_CHARS_IN_DESCRIPTION) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_SUBAGENT_PROMPT_CHARS_IN_DESCRIPTION).trimEnd()}…`;
}

function buildSubagentToolDescription(
  subagentName: string,
  subagent: AgentSubagentInvocation
): string {
  const toolLabels = getEnabledToolLabels(subagent.tools);
  const toolSummary = toolLabels.length > 0 ? toolLabels.join(', ') : 'None';
  const promptSummary = summarizeSystemPrompt(subagent.systemPrompt);
  return `Delegates work to subagent ${subagentName}. System prompt: ${promptSummary} Available tools: ${toolSummary}.`;
}

function buildSdkAgent(
  invocation: AgentInvocation | AgentSubagentInvocation,
  sdk: AgentsSdkModule,
  nodeId: string,
  registry: AgentBuildRegistry,
  ancestry: Set<string> = new Set<string>()
): AgentsSdkAgent {
  if (ancestry.has(nodeId)) {
    throw new Error(`Subagent cycle detected while building SDK agent tree at "${nodeId}".`);
  }

  const nextAncestry = new Set(ancestry);
  nextAncestry.add(nodeId);
  const tools = buildAgentTools(invocation, sdk, registry, nextAncestry);
  const agentName = getAgentName(invocation);

  const agentConfig: Record<string, unknown> = {
    name: agentName,
    instructions: invocation.systemPrompt,
    model: invocation.model
  };

  if (tools.length > 0) {
    agentConfig.tools = tools;
  }

  if (invocation.reasoningEffort) {
    agentConfig.modelSettings = {
      reasoning: {
        effort: invocation.reasoningEffort
      }
    };
  }

  const agent = new sdk.Agent(agentConfig);
  registry.agentRegistry.set(agent as object, { nodeId, agentName });
  return agent;
}

function buildAgentTools(
  invocation: AgentInvocation | AgentSubagentInvocation,
  sdk: AgentsSdkModule,
  registry: AgentBuildRegistry,
  ancestry: Set<string>
): AgentsSdkTool[] {
  const tools: AgentsSdkTool[] = [];

  if (invocation.tools?.web_search) {
    tools.push(sdk.webSearchTool());
  }

  const subagents = invocation.subagents ?? [];
  for (const subagent of subagents) {
    const childAgent = buildSdkAgent(subagent, sdk, subagent.nodeId, registry, ancestry);
    const childAgentName = (subagent.agentName || 'Agent').trim() || 'Agent';
    const toolName = toToolName(childAgentName, subagent.nodeId);
    registry.toolRegistry.set(toolName, {
      nodeId: subagent.nodeId,
      agentName: childAgentName
    });

    tools.push(
      childAgent.asTool({
        toolName,
        toolDescription: buildSubagentToolDescription(childAgentName, subagent),
        runOptions: { maxTurns: MAX_AGENT_TURNS }
      })
    );
  }

  return tools;
}

function toTextOutput(finalOutput: unknown): string {
  if (typeof finalOutput === 'string') {
    return finalOutput.trim();
  }
  if (finalOutput === undefined || finalOutput === null) {
    return 'Model returned no text output.';
  }
  return JSON.stringify(finalOutput);
}

function emitRuntimeEvent(
  options: AgentRespondOptions | undefined,
  event: AgentRuntimeEvent
): void {
  options?.onRuntimeEvent?.(event);
}

export class OpenAIAgentsLLMService implements WorkflowLLM {
  async respond(
    invocation: AgentInvocation,
    options?: AgentRespondOptions
  ): Promise<string> {
    const sdk = await loadAgentsSdk();
    const rootNodeId = options?.parentNodeId || '__root__';

    const registry: AgentBuildRegistry = {
      toolRegistry: new Map<string, AgentNodeMeta>(),
      agentRegistry: new WeakMap<object, AgentNodeMeta>()
    };

    const agent = buildSdkAgent(invocation, sdk, rootNodeId, registry);
    const runner = new sdk.Runner();

    const pendingChildCallsByNodeId = new Map<string, PendingChildCall[]>();
    const contextStateByContext = new WeakMap<object, AgentContextState>();
    const activeSubagentCalls = new Map<string, AgentRuntimeEvent>();
    const generatedCallIdsByToolName = new Map<string, string[]>();
    let syntheticCallCounter = 0;

    const getSyntheticCallId = (toolName: string): string => {
      syntheticCallCounter += 1;
      return `${toolName}_${syntheticCallCounter}`;
    };

    runner.on('agent_start', (context, activeAgent) => {
      if (!isObject(context)) return;
      const agentMeta = registry.agentRegistry.get(activeAgent as object);
      if (!agentMeta) return;

      const pendingQueue = pendingChildCallsByNodeId.get(agentMeta.nodeId);
      const pendingCall = pendingQueue?.shift();
      if (pendingQueue && pendingQueue.length === 0) {
        pendingChildCallsByNodeId.delete(agentMeta.nodeId);
      }

      contextStateByContext.set(context, {
        nodeId: agentMeta.nodeId,
        depth: pendingCall?.depth ?? 0,
        activeCallId: pendingCall?.callId
      });
    });

    runner.on('agent_end', (context) => {
      if (!isObject(context)) return;
      contextStateByContext.delete(context);
    });

    runner.on('agent_tool_start', (context, _activeAgent, tool, details) => {
      const toolName = getToolName(tool);
      if (!toolName) return;

      const subagentMeta = registry.toolRegistry.get(toolName);
      if (!subagentMeta) return;

      const contextState = isObject(context) ? contextStateByContext.get(context) : undefined;
      const explicitCallId = getToolCallId(details);
      const callId = explicitCallId ?? getSyntheticCallId(toolName);
      if (!explicitCallId) {
        const generatedCallIds = generatedCallIdsByToolName.get(toolName) ?? [];
        generatedCallIds.push(callId);
        generatedCallIdsByToolName.set(toolName, generatedCallIds);
      }
      const depth = (contextState?.depth ?? 0) + 1;
      const event: AgentRuntimeEvent = {
        type: 'subagent_call_start',
        parentNodeId: rootNodeId,
        subagentNodeId: subagentMeta.nodeId,
        subagentName: subagentMeta.agentName,
        callId,
        parentCallId: contextState?.activeCallId,
        depth
      };

      activeSubagentCalls.set(callId, event);
      emitRuntimeEvent(options, event);

      const pendingQueue = pendingChildCallsByNodeId.get(subagentMeta.nodeId) ?? [];
      pendingQueue.push({ callId, depth });
      pendingChildCallsByNodeId.set(subagentMeta.nodeId, pendingQueue);
    });

    runner.on('agent_tool_end', (_context, _activeAgent, tool, _result, details) => {
      const toolName = getToolName(tool);
      if (!toolName) return;

      const subagentMeta = registry.toolRegistry.get(toolName);
      if (!subagentMeta) return;

      const explicitCallId = getToolCallId(details);
      let callId = explicitCallId;

      if (!callId) {
        const generatedCallIds = generatedCallIdsByToolName.get(toolName);
        if (generatedCallIds && generatedCallIds.length > 0) {
          const nextGeneratedCallId = generatedCallIds.shift();
          if (generatedCallIds.length === 0) {
            generatedCallIdsByToolName.delete(toolName);
          }
          if (nextGeneratedCallId) {
            callId = nextGeneratedCallId;
          }
        }
      }

      if (!callId) {
        const activeCallForTool = Array.from(activeSubagentCalls.values()).find(
          (activeCall) => activeCall.subagentNodeId === subagentMeta.nodeId
        );
        callId = activeCallForTool?.callId ?? getSyntheticCallId(toolName);
      }

      const startEvent = activeSubagentCalls.get(callId);
      const event: AgentRuntimeEvent = {
        type: 'subagent_call_end',
        parentNodeId: rootNodeId,
        subagentNodeId: startEvent?.subagentNodeId ?? subagentMeta.nodeId,
        subagentName: startEvent?.subagentName ?? subagentMeta.agentName,
        callId,
        parentCallId: startEvent?.parentCallId,
        depth: startEvent?.depth ?? 1
      };

      emitRuntimeEvent(options, event);
      activeSubagentCalls.delete(callId);
    });

    try {
      const result = await runner.run(agent, invocation.userContent, {
        maxTurns: MAX_AGENT_TURNS
      });
      return toTextOutput(result.finalOutput);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      activeSubagentCalls.forEach((activeCall) => {
        emitRuntimeEvent(options, {
          ...activeCall,
          type: 'subagent_call_error',
          message
        });
      });
      activeSubagentCalls.clear();
      throw error instanceof Error ? error : new Error(message);
    }
  }
}
