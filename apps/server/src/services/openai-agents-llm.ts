import type {
  AgentInvocation,
  AgentSubagentInvocation,
  WorkflowLLM
} from '@agentic/workflow-engine';

type AgentsSdkModule = {
  Agent: new (config: Record<string, unknown>) => AgentsSdkAgent;
  run: (
    agent: AgentsSdkAgent,
    input: string,
    options?: { maxTurns?: number }
  ) => Promise<{ finalOutput?: unknown }>;
  webSearchTool: () => AgentsSdkTool;
};

type AgentsSdkTool = unknown;
type AgentsSdkAgent = {
  asTool: (options: {
    toolName?: string;
    toolDescription?: string;
    runOptions?: { maxTurns?: number };
  }) => AgentsSdkTool;
};

let sdkModulePromise: Promise<AgentsSdkModule> | null = null;
const MAX_AGENT_TURNS = 20;

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
  if ('agentName' in invocation && typeof invocation.agentName === 'string' && invocation.agentName.trim()) {
    return invocation.agentName.trim();
  }
  return 'Workflow Agent';
}

function buildSdkAgent(
  invocation: AgentInvocation | AgentSubagentInvocation,
  sdk: AgentsSdkModule,
  nodeId: string,
  ancestry: Set<string> = new Set<string>()
): AgentsSdkAgent {
  if (ancestry.has(nodeId)) {
    throw new Error(`Subagent cycle detected while building SDK agent tree at "${nodeId}".`);
  }

  const nextAncestry = new Set(ancestry);
  nextAncestry.add(nodeId);
  const tools = buildAgentTools(invocation, sdk, nextAncestry);
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

  return new sdk.Agent(agentConfig);
}

function buildAgentTools(
  invocation: AgentInvocation | AgentSubagentInvocation,
  sdk: AgentsSdkModule,
  ancestry: Set<string>
): AgentsSdkTool[] {
  const tools: AgentsSdkTool[] = [];

  if (invocation.tools?.web_search) {
    tools.push(sdk.webSearchTool());
  }

  const subagents = invocation.subagents ?? [];
  for (const subagent of subagents) {
    const childAgent = buildSdkAgent(subagent, sdk, subagent.nodeId, ancestry);
    tools.push(
      childAgent.asTool({
        toolName: toToolName(subagent.agentName || 'agent', subagent.nodeId),
        toolDescription: `Delegates work to subagent ${subagent.agentName || 'Agent'}.`,
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

export class OpenAIAgentsLLMService implements WorkflowLLM {
  async respond(invocation: AgentInvocation): Promise<string> {
    const sdk = await loadAgentsSdk();
    const agent = buildSdkAgent(invocation, sdk, '__root__');
    const result = await sdk.run(agent, invocation.userContent, { maxTurns: MAX_AGENT_TURNS });
    return toTextOutput(result.finalOutput);
  }
}
