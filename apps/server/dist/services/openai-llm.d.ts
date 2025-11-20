import OpenAI from 'openai';
import { AgentInvocation, WorkflowLLM } from '@agentic/workflow-engine';
export declare class OpenAILLMService implements WorkflowLLM {
    private readonly client;
    constructor(client: OpenAI);
    respond(invocation: AgentInvocation): Promise<string>;
}
