"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAILLMService = void 0;
function formatInput(invocation) {
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
function extractText(response) {
    if (Array.isArray(response.output_text) && response.output_text.length > 0) {
        return response.output_text.join('\n').trim();
    }
    if (Array.isArray(response.output)) {
        const chunks = [];
        response.output.forEach((entry) => {
            if (entry.type === 'message' && Array.isArray(entry.content)) {
                entry.content.forEach((chunk) => {
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
class OpenAILLMService {
    constructor(client) {
        this.client = client;
    }
    async respond(invocation) {
        const params = {
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
exports.OpenAILLMService = OpenAILLMService;
