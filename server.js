const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { OpenAI } = require('openai');
require('dotenv').config();

// Initialize OpenAI Client
// Note: User must provide OPENAI_API_KEY in .env
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy-key', // Fallback for initialization, will fail on request if missing
});

// --- WORKFLOW ENGINE ---

class WorkflowEngine {
  constructor(graph, runId) {
    this.graph = this.normalizeGraph(graph);
    this.runId = runId;
    this.state = {}; // Shared state across the workflow
    this.logs = []; // Execution trace
    this.status = 'pending'; // pending, running, paused, completed, failed
    this.currentNodeId = null;
    this.waitingForInput = false;
  }

  normalizeGraph(graph = {}) {
    const nodes = Array.isArray(graph.nodes)
      ? graph.nodes.map(node => {
          if (node?.type === 'input') {
            return { ...node, type: 'approval' };
          }
          return node;
        })
      : [];
    return {
      nodes,
      connections: Array.isArray(graph.connections) ? graph.connections : []
    };
  }

  log(nodeId, type, content) {
    const entry = {
      timestamp: new Date().toISOString(),
      nodeId,
      type,
      content
    };
    this.logs.push(entry);
    return entry;
  }

  describeNode(node) {
    if (!node) return 'node';
    if (node.type === 'agent') {
      const name = node.data?.agentName || 'Agent';
      return `${name} agent node`;
    }
    const labels = {
      start: 'start node',
      approval: 'user approval node',
      if: 'condition node',
      end: 'end node'
    };
    return labels[node.type] || `${node.type} node`;
  }

  async run() {
    this.status = 'running';
    // Find Start Node
    const startNode = this.graph.nodes.find(n => n.type === 'start');
    if (!startNode) {
      this.log('system', 'error', 'No Start node found');
      this.status = 'failed';
      return this.getResult();
    }

    this.currentNodeId = startNode.id;
    await this.processNode(startNode);
    
    return this.getResult();
  }

  async processNode(node) {
    if (!node) return;
    this.currentNodeId = node.id;
    this.log(node.id, 'step_start', this.describeNode(node));

    try {
      let output = null;

      // --- NODE LOGIC ---
      switch (node.type) {
        case 'start':
          output = node.data?.initialInput || '';
          break;

        case 'agent':
          output = await this.executeAgentNode(node);
          break;

        case 'tool': // e.g. standalone search if not embedded in agent
          // For this implementation, we assume tools are attached to agents, 
          // but this node could strictly be a "Search" action.
          // Let's implement a direct Web Search node just in case.
          output = await this.executeSearchNode(node);
          break;

        case 'if':
          const nextNodeId = await this.evaluateIfNode(node);
          // Branching logic is handled here, so we return early
          const nextNode = this.graph.nodes.find(n => n.id === nextNodeId);
          if (nextNode) await this.processNode(nextNode);
          return; 

        case 'approval':
          // Store the current output before approval so we can restore it after approval
          // Approval decisions are workflow-only and should never reach the LLM
          this.state.pre_approval_output = this.state.last_output;
          this.status = 'paused';
          this.waitingForInput = true;
          this.log(node.id, 'wait_input', 'Waiting for user approval');
          return; 

        case 'input':
          this.status = 'paused';
          this.waitingForInput = true;
          this.log(node.id, 'wait_input', 'Waiting for user input');
          // Execution stops here until resume() is called
          return; 

        case 'end':
          this.status = 'completed';
          return;
          
        default:
          this.log(node.id, 'warn', `Unknown node type: ${node.type}`);
          break;
      }

      // Store output in state (simplified: last_output)
      this.state.last_output = output;
      this.state[node.id] = output;

      // Move to next node (default linear flow)
      const connection = this.graph.connections.find(c => c.source === node.id);
      if (connection) {
        const nextNode = this.graph.nodes.find(n => n.id === connection.target);
        await this.processNode(nextNode);
      } else {
        if (node.type !== 'end') {
            this.status = 'completed'; // implicit end
        }
      }

    } catch (error) {
      console.error(error);
      this.log(node.id, 'error', error.message);
      this.status = 'failed';
    }
  }

  async executeAgentNode(node) {
    const previousOutput = this.state.last_output;
    let priorText = '';
    // Safeguard: Never send approval decisions to LLM
    // Check if this looks like an approval decision object and filter it out
    if (previousOutput && typeof previousOutput === 'object' && 
        ('decision' in previousOutput || 'note' in previousOutput)) {
      // This is approval data - should never happen, but filter it out
      // Look for the last actual node output in state (from start or previous agent)
      let safeOutput = null;
      // Check all state keys to find the last non-approval output
      const stateKeys = Object.keys(this.state).filter(k => 
        !k.includes('_approval') && k !== 'last_output' && k !== 'pre_approval_output'
      );
      // Get outputs from nodes (they're stored by node ID)
      for (const key of stateKeys.reverse()) {
        const value = this.state[key];
        if (value && typeof value === 'string' && !value.includes('approved') && !value.includes('rejected')) {
          safeOutput = value;
          break;
        }
      }
      priorText = safeOutput || '';
    } else if (typeof previousOutput === 'string') {
      priorText = previousOutput;
    } else if (previousOutput !== undefined && previousOutput !== null) {
      priorText = JSON.stringify(previousOutput);
    }

    const userContent = node.data.userPrompt && node.data.userPrompt.trim().length > 0
      ? node.data.userPrompt
      : priorText;

    const messages = [
      { role: 'system', content: node.data.systemPrompt || 'You are a helpful assistant.' },
      { role: 'user', content: userContent || '' }
    ];
    this.log(node.id, 'start_prompt', messages[1].content);

    const tools = [];
    const selectedTools = node.data.tools || {};
    if (selectedTools.web_search) {
      tools.push({ type: 'web_search' });
    }

    const responseInput = [
        {
            role: 'system',
            content: [
                {
                    type: 'input_text',
                    text: node.data.systemPrompt || 'You are a helpful assistant.'
                }
            ]
        },
        {
            role: 'user',
            content: [
                {
                    type: 'input_text',
                    text: userContent || ''
                }
            ]
        }
    ];

    const params = {
        model: node.data.model || 'gpt-5',
        input: responseInput
    };

    if (node.data.reasoningEffort) {
        params.reasoning = { effort: node.data.reasoningEffort };
    }

    if (tools.length > 0) {
        params.tools = tools;
        params.tool_choice = 'auto';
    }

    // Responses API handles built-in tools like web_search
    let responseText = '';
    
    try {
        if (!process.env.OPENAI_API_KEY) throw new Error("No API Key");
        const response = await openai.responses.create(params);
        
        if (Array.isArray(response.output_text) && response.output_text.length > 0) {
            responseText = response.output_text.join('\n').trim();
        } else if (Array.isArray(response.output) && response.output.length > 0) {
            const chunks = [];
            response.output.forEach(item => {
                if (item.type === 'message' && Array.isArray(item.content)) {
                    item.content.forEach(part => {
                        if (part.type === 'output_text' && part.text) {
                            chunks.push(part.text);
                        }
                    });
                }
            });
            responseText = chunks.join('\n').trim();
        }

        if (!responseText) {
            responseText = 'The model did not return any text output.';
        }
    } catch (e) {
        const errorMsg = e?.message || 'Unknown error';
        this.log(node.id, 'llm_error', `API call failed: ${errorMsg}`);
        responseText = `OpenAI error: ${errorMsg}`;
    }

    this.log(node.id, 'llm_response', responseText);
    return responseText;
  }

  async executeSearchNode(node) {
      // Simulating a distinct tool node
      return `Search results for: ${this.state.last_output}`;
  }

  async evaluateIfNode(node) {
      // Simple logic: contains string, or AI evaluation
      // For this MVP: Simple "Contains" check on last output
      const condition = node.data.condition || '';
      const input = JSON.stringify(this.state.last_output || '');
      
      const isTrue = input.toLowerCase().includes(condition.toLowerCase());
      this.log(node.id, 'logic_check', `Condition "${condition}" in "${input.substring(0,20)}..."? ${isTrue}`);

      // Find connections from "true" or "false" ports
      // We assume connections have a 'handle' property matching 'true' or 'false'
      const trueConn = this.graph.connections.find(c => c.source === node.id && c.sourceHandle === 'true');
      const falseConn = this.graph.connections.find(c => c.source === node.id && c.sourceHandle === 'false');

      if (isTrue && trueConn) return trueConn.target;
      if (!isTrue && falseConn) return falseConn.target;
      return null;
  }

  async resume(inputData) {
      if (this.status !== 'paused') return;
      
      const currentNode = this.graph.nodes.find(n => n.id === this.currentNodeId);
      this.waitingForInput = false;
      this.status = 'running';

      let connection = null;

      if (currentNode?.type === 'approval') {
          const { decision, note } = this.normalizeApprovalInput(inputData);
          const logMessage = this.buildApprovalLog(decision, note);
          this.log(this.currentNodeId, 'input_received', logMessage);
          // Store approval decision separately for logging only
          // Approval decisions are workflow-only and should never reach the LLM
          this.state[`${this.currentNodeId}_approval`] = { decision, note };
          // Restore the output from before approval - ensure it's a string, not an object
          // This ensures agents only see the previous node's output (start or agent), never approval data
          const restoredOutput = this.state.pre_approval_output;
          if (restoredOutput !== undefined && restoredOutput !== null) {
              // Ensure we restore as string if it was a string, otherwise convert
              this.state.last_output = typeof restoredOutput === 'string' 
                  ? restoredOutput 
                  : (typeof restoredOutput === 'object' ? JSON.stringify(restoredOutput) : String(restoredOutput));
          }
          // If pre_approval_output wasn't set, keep last_output as-is (shouldn't happen, but safe fallback)
          delete this.state.pre_approval_output;
          connection = this.graph.connections.find(c => c.source === this.currentNodeId && c.sourceHandle === decision);
      } else {
          this.log(this.currentNodeId, 'input_received', inputData);
          this.state.last_output = inputData;
          connection = this.graph.connections.find(c => c.source === this.currentNodeId);
      }
      
      if (connection) {
          const nextNode = this.graph.nodes.find(n => n.id === connection.target);
          if (nextNode) {
              await this.processNode(nextNode);
          } else {
              this.status = 'completed';
          }
      } else {
          this.status = 'completed';
      }
      
      return this.getResult();
  }

  normalizeApprovalInput(inputData) {
      if (typeof inputData === 'object' && inputData !== null) {
          const decision = inputData.decision === 'reject' ? 'reject' : 'approve';
          const note = inputData.note ? String(inputData.note) : '';
          return { decision, note };
      }
      if (typeof inputData === 'string') {
          const normalized = inputData.toLowerCase().includes('reject') ? 'reject' : 'approve';
          return { decision: normalized, note: '' };
      }
      return { decision: 'approve', note: '' };
  }

  buildApprovalLog(decision, note) {
      let text = decision === 'approve' ? 'User approved this step.' : 'User rejected this step.';
      const trimmed = (note || '').trim();
      if (trimmed) {
          text += ` Feedback: ${trimmed}`;
      }
      return text;
  }

  getResult() {
      return {
          runId: this.runId,
          status: this.status,
          logs: this.logs,
          state: this.state,
          waitingForInput: this.waitingForInput,
          currentNodeId: this.currentNodeId
      };
  }
}


// --- SERVER SETUP ---

// Track active workflows: { runId: WorkflowEngine }
const activeWorkflows = {};

// Try to load WebSocket module, fallback if not available
let WebSocket = null;
let isWebSocketAvailable = false;
try {
  WebSocket = require('ws');
  isWebSocketAvailable = true;
  console.log('WebSocket support enabled');
} catch (error) {
  console.log('WebSocket support disabled (ws package not installed)');
}

const PORT = 3000;
const wsClients = new Set();

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return mimeTypes[ext] || 'text/plain';
}

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
      return;
    }
    const mimeType = getMimeType(filePath);
    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(data);
  });
}

function saveRunLog(runId, data) {
    const logPath = path.join(__dirname, 'runs', `run_${runId}.json`);
    fs.writeFile(logPath, JSON.stringify(data, null, 2), err => {
        if (err) console.error("Failed to save run log:", err);
    });
}

function handlePostRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);
  let body = '';

  req.on('data', chunk => { body += chunk.toString(); });

  req.on('end', async () => {
    try {
      const data = JSON.parse(body);

      // --- API ENDPOINTS ---

      if (parsedUrl.pathname === '/api/run') {
          // Start a new workflow
          const runId = Date.now().toString();
          const engine = new WorkflowEngine(data.graph, runId);
          activeWorkflows[runId] = engine;
          
          const result = await engine.run();
          saveRunLog(runId, result);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
      }

      if (parsedUrl.pathname === '/api/resume') {
          // Resume a paused workflow (input)
          const { runId, input } = data;
          const engine = activeWorkflows[runId];
          
          if (!engine) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Run ID not found or expired' }));
              return;
          }
          
          const result = await engine.resume(input);
          saveRunLog(runId, result);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
      }

      // Default message handler from template
      if (parsedUrl.pathname === '/message') {
         // ... existing message logic ...
         res.writeHead(200, { 'Content-Type': 'application/json' });
         res.end(JSON.stringify({ success: true }));
         return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');

    } catch (error) {
      console.error(error);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server Error', details: error.message }));
    }
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

  if (req.method === 'POST') {
    handlePostRequest(req, res);
    return;
  }

  if (pathname === '/') pathname = '/index.html';

  // Route to client folder
  const filePath = path.join(__dirname, 'client', pathname.substring(1));
  const clientDir = path.join(__dirname, 'client');
  
  if (!filePath.startsWith(clientDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
      return;
    }
    serveFile(filePath, res);
  });
});

if (isWebSocketAvailable) {
  const wss = new WebSocket.Server({ server });
  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.on('close', () => wsClients.delete(ws));
  });
}

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('Workflow Engine Ready');
});
