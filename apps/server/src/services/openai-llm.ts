import type OpenAI from 'openai';
import type { AgentInvocation, WorkflowLLM } from '@agentic/workflow-engine';

function formatInput(invocation: AgentInvocation) {
  return [
    {
      role: 'system',
      content: [
        {
          type: 'input_text',
          text: invocation.systemPrompt
        }
      ]
    },
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: invocation.userContent
        }
      ]
    }
  ];
}

function extractText(response: any): string {
  if (Array.isArray(response.output_text) && response.output_text.length > 0) {
    return response.output_text.join('\n').trim();
  }

  if (Array.isArray(response.output)) {
    const chunks: string[] = [];
    response.output.forEach((entry: any) => {
      if (entry.type === 'message' && Array.isArray(entry.content)) {
        entry.content.forEach((chunk: any) => {
          if (chunk.type === 'output_text' && chunk.text) {
            chunks.push(chunk.text);
          }
        });
      }
    });
    if (chunks.length > 0) {
      return chunks.join('\n').trim();
    }
  }

  return 'Model returned no text output.';
}

export class OpenAILLMService implements WorkflowLLM {
  constructor(private readonly client: OpenAI) {}

  async respond(invocation: AgentInvocation): Promise<string> {
    const params: Record<string, unknown> = {
      model: invocation.model,
      input: formatInput(invocation)
    };

    if (invocation.reasoningEffort) {
      params.reasoning = { effort: invocation.reasoningEffort };
    }

    if (invocation.tools?.web_search) {
      params.tools = [{ type: 'web_search' }];
      params.tool_choice = 'auto';
    }

    const response = await this.client.responses.create(params);
    return extractText(response);
  }
}

