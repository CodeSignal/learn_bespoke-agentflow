import type { AgentInvocation, WorkflowLLM } from '@agentic/workflow-engine';

type AgentsSdkModule = {
  Agent: new (config: Record<string, unknown>) => unknown;
  run: (
    agent: unknown,
    input: string,
    options?: { maxTurns?: number }
  ) => Promise<{ finalOutput?: unknown }>;
  webSearchTool: () => unknown;
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

function buildAgentTools(invocation: AgentInvocation, sdk: AgentsSdkModule): unknown[] {
  const tools: unknown[] = [];

  if (invocation.tools?.web_search) {
    tools.push(sdk.webSearchTool());
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
    const tools = buildAgentTools(invocation, sdk);
    const agentConfig: Record<string, unknown> = {
      name: 'Workflow Agent',
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
    const result = await sdk.run(agent, invocation.userContent, { maxTurns: MAX_AGENT_TURNS });
    return toTextOutput(result.finalOutput);
  }
}
