import type {
  ApprovalInput,
  WorkflowConnection,
  WorkflowGraph,
  WorkflowLogEntry,
  WorkflowNode,
  WorkflowRunResult,
  WorkflowStatus
} from '@agentic/types';

/**
 * Configuration for tools available to agents during execution.
 * Agents can enable multiple tools simultaneously by setting their respective boolean flags.
 * Each tool enabled is passed to the LLM as an available function to call.
 */
export type AgentToolsConfig = {
  /** Enable web search capability for the agent */
  web_search?: boolean;
  // Future tools can be added here, e.g.: calculator?: boolean; email?: boolean;
};

export interface AgentInvocation {
  systemPrompt: string;
  userContent: string;
  model: string;
  reasoningEffort?: string;
  tools?: AgentToolsConfig;
}

export interface WorkflowLLM {
  respond: (input: AgentInvocation) => Promise<string>;
}

export interface WorkflowEngineInitOptions {
  runId?: string;
  llm?: WorkflowLLM;
  timestampFn?: () => string;
  onLog?: (entry: WorkflowLogEntry) => void;
  /**
   * Restore a previously paused engine to its exact saved state.
   * When provided, the constructor applies this snapshot over the default
   * field initialisers — `resume()` can then be called directly without `run()`.
   */
  initialState?: {
    state: Record<string, unknown>;
    currentNodeId: string | null;
    status: WorkflowStatus;
    waitingForInput: boolean;
    logs: WorkflowLogEntry[];
  };
}

const DEFAULT_REASONING = 'low';
const IF_CONDITION_HANDLE_PREFIX = 'condition-';

type IfConditionOperator = 'equal' | 'contains';

interface IfCondition {
  operator: IfConditionOperator;
  value: string;
}

class MissingLLM implements WorkflowLLM {
  async respond(): Promise<string> {
    throw new Error('No LLM service configured. Set OPENAI_API_KEY in the environment.');
  }
}

export class WorkflowEngine {
  private readonly runId: string;

  private readonly timestampFn: () => string;

  private readonly onLog?: (entry: WorkflowLogEntry) => void;

  private graph: WorkflowGraph;

  private llm: WorkflowLLM;

  private logs: WorkflowLogEntry[] = [];

  private state: Record<string, unknown> = {};

  private status: WorkflowStatus = 'pending';

  private currentNodeId: string | null = null;

  private waitingForInput = false;

  constructor(graph: WorkflowGraph, options: WorkflowEngineInitOptions = {}) {
    this.graph = this.normalizeGraph(graph);
    this.runId = options.runId ?? Date.now().toString();
    this.llm = options.llm ?? new MissingLLM();
    this.timestampFn = options.timestampFn ?? (() => new Date().toISOString());
    this.onLog = options.onLog;

    if (options.initialState) {
      this.state = { ...options.initialState.state };
      this.logs = [...options.initialState.logs];
      this.status = options.initialState.status;
      this.currentNodeId = options.initialState.currentNodeId;
      this.waitingForInput = options.initialState.waitingForInput;
    }
  }

  getRunId(): string {
    return this.runId;
  }

  getLogs(): WorkflowLogEntry[] {
    return this.logs;
  }

  getStatus(): WorkflowStatus {
    return this.status;
  }

  getGraph(): WorkflowGraph {
    return this.graph;
  }

  getResult(): WorkflowRunResult {
    return {
      runId: this.runId,
      status: this.status,
      logs: this.logs,
      state: this.state,
      waitingForInput: this.waitingForInput,
      currentNodeId: this.currentNodeId
    };
  }

  async run(): Promise<WorkflowRunResult> {
    this.status = 'running';
    const startNode = this.graph.nodes.find((n) => n.type === 'start');
    if (!startNode) {
      this.log('system', 'error', 'No start node found in workflow graph');
      this.status = 'failed';
      return this.getResult();
    }

    this.currentNodeId = startNode.id;
    await this.processNode(startNode);
    return this.getResult();
  }

  async resume(input?: ApprovalInput | string | Record<string, unknown>): Promise<WorkflowRunResult> {
    if (this.status !== 'paused' || !this.currentNodeId) {
      return this.getResult();
    }

    const currentNode = this.graph.nodes.find((n) => n.id === this.currentNodeId);
    if (!currentNode) {
      this.status = 'failed';
      this.log(this.currentNodeId, 'error', 'Unable to resume, current node missing');
      return this.getResult();
    }

    this.waitingForInput = false;
    this.status = 'running';

    let connection: WorkflowConnection | undefined;

    if (currentNode.type === 'approval') {
      const normalized = this.normalizeApprovalInput(input);
      const logMessage = this.describeApprovalResult(normalized);
      this.log(currentNode.id, 'input_received', logMessage);
      this.state[`${currentNode.id}_approval`] = normalized;

      const restored = this.state.pre_approval_output;
      if (restored !== undefined) {
        if (typeof restored === 'string') {
          this.state.previous_output = restored;
        } else {
          this.state.previous_output = JSON.stringify(restored);
        }
      }
      delete this.state.pre_approval_output;
      connection = this.graph.connections.find(
        (c) => c.source === currentNode.id && c.sourceHandle === normalized.decision
      );
    } else {
      this.log(currentNode.id, 'input_received', JSON.stringify(input));
      this.state.previous_output = input ?? '';
      connection = this.graph.connections.find((c) => c.source === currentNode.id);
    }

    if (connection) {
      const nextNode = this.graph.nodes.find((n) => n.id === connection.target);
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

  private normalizeGraph(graph: WorkflowGraph): WorkflowGraph {
    const nodes = Array.isArray(graph.nodes)
      ? graph.nodes.map((node) => {
          if (node.type === 'input') {
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

  private log(nodeId: string | null, type: string, content: string): void {
    const entry: WorkflowLogEntry = {
      timestamp: this.timestampFn(),
      nodeId: nodeId ?? 'system',
      type,
      content
    };
    this.logs.push(entry);
    if (this.onLog) {
      this.onLog(entry);
    }
  }

  private async processNode(node: WorkflowNode): Promise<void> {
    this.currentNodeId = node.id;
    this.log(node.id, 'step_start', this.describeNode(node));

    try {
      let output: unknown = null;

      switch (node.type) {
        case 'start':
          output = node.data?.initialInput || '';
          break;
        case 'agent':
          output = await this.executeAgentNode(node);
          break;
        case 'if': {
          const nextNodeId = this.evaluateIfNode(node);
          if (nextNodeId) {
            const nextNode = this.graph.nodes.find((n) => n.id === nextNodeId);
            if (nextNode) {
              await this.processNode(nextNode);
            } else {
              this.status = 'completed';
            }
          } else {
            this.status = 'completed';
          }
          return;
        }
        case 'approval':
          this.state.pre_approval_output = this.state.previous_output;
          this.status = 'paused';
          this.waitingForInput = true;
          this.log(node.id, 'wait_input', 'Waiting for user approval');
          return;
        case 'end':
          this.status = 'completed';
          return;
        default:
          this.log(node.id, 'warn', `Unknown node type "${node.type}" skipped`);
      }

      this.state.previous_output = output;
      this.state[node.id] = output;

      const nextConnection = this.graph.connections.find((c) => c.source === node.id);
      if (nextConnection) {
        const nextNode = this.graph.nodes.find((n) => n.id === nextConnection.target);
        if (nextNode) {
          await this.processNode(nextNode);
        } else {
          this.status = 'completed';
        }
      } else if (node.type !== 'end') {
        this.status = 'completed';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lastLog = this.logs[this.logs.length - 1];
      const isDuplicateLlmError =
        lastLog &&
        lastLog.nodeId === node.id &&
        lastLog.type === 'llm_error' &&
        lastLog.content === message;
      if (!isDuplicateLlmError) {
        this.log(node.id, 'error', message);
      }
      this.status = 'failed';
    }
  }

  private describeNode(node: WorkflowNode): string {
    if (node.type === 'agent') {
      const name = (node.data?.agentName as string) || 'Agent';
      return `${name} agent node`;
    }
    switch (node.type) {
      case 'start':
        return 'start node';
      case 'if':
        return 'condition node';
      case 'approval':
        return 'approval node';
      case 'end':
        return 'end node';
      default:
        return `${node.type} node`;
    }
  }

  private evaluateIfNode(node: WorkflowNode): string | null {
    const input = this.getIfInputString();
    const normalizedInput = input.toLowerCase();
    const conditions = this.getIfConditions(node);

    for (let index = 0; index < conditions.length; index += 1) {
      const condition = conditions[index];
      const match = this.evaluateIfCondition(normalizedInput, condition);
      this.log(
        node.id,
        'logic_check',
        `Condition ${index + 1} (${condition.operator} "${condition.value}") evaluated as ${match ? 'true' : 'false'}`
      );

      if (!match) continue;
      const conn = this.graph.connections.find((c) => {
        if (c.source !== node.id) return false;
        if (c.sourceHandle === `${IF_CONDITION_HANDLE_PREFIX}${index}`) return true;
        return index === 0 && c.sourceHandle === 'true';
      });
      if (conn) return conn.target;
    }

    const falseConn = this.graph.connections.find(
      (c) => c.source === node.id && c.sourceHandle === 'false'
    );
    if (falseConn) return falseConn.target;
    return null;
  }

  private getIfConditions(node: WorkflowNode): IfCondition[] {
    const legacyCondition = typeof node.data?.condition === 'string' ? node.data.condition : '';
    const conditionsData = node.data?.conditions;
    const rawConditions =
      Array.isArray(conditionsData) && conditionsData.length > 0
        ? (conditionsData as Array<Record<string, unknown>>)
        : [{ operator: 'contains', value: legacyCondition }];

    return rawConditions.map((condition) => ({
      operator: condition.operator === 'contains' ? 'contains' : 'equal',
      value: typeof condition.value === 'string' ? condition.value : ''
    }));
  }

  private getIfInputString(): string {
    const previousOutput = this.state.previous_output;
    if (typeof previousOutput === 'string') return previousOutput;
    if (previousOutput === undefined || previousOutput === null) return '';
    return JSON.stringify(previousOutput);
  }

  private evaluateIfCondition(input: string, condition: IfCondition): boolean {
    const expectedValue = condition.value.trim().toLowerCase();
    if (!expectedValue) return false;
    if (condition.operator === 'contains') {
      return input.includes(expectedValue);
    }
    return input === expectedValue;
  }

  private async executeAgentNode(node: WorkflowNode): Promise<string> {
    const previousOutput = this.state.previous_output;

    // Resolve previousOutput to a string for template substitution
    let lastOutputStr = '';
    if (typeof previousOutput === 'string') {
      lastOutputStr = previousOutput;
    } else if (previousOutput !== undefined && previousOutput !== null) {
      lastOutputStr = JSON.stringify(previousOutput);
    }

    // If the previous output was an approval object, use the last safe non-approval output
    if (
      previousOutput &&
      typeof previousOutput === 'object' &&
      ('decision' in (previousOutput as Record<string, unknown>) ||
        'note' in (previousOutput as Record<string, unknown>))
    ) {
      lastOutputStr = this.findLastNonApprovalOutput() || '';
    }

    const userPrompt = node.data?.userPrompt;
    let userContent: string;
    if (userPrompt && typeof userPrompt === 'string' && userPrompt.trim()) {
      userContent = userPrompt.replace(/\{\{PREVIOUS_OUTPUT\}\}/g, lastOutputStr);
    } else {
      // Backwards compatibility: empty userPrompt falls back to last output directly
      userContent = lastOutputStr;
    }

    const invocation: AgentInvocation = {
      systemPrompt:
        (node.data?.systemPrompt as string) || 'You are a helpful assistant.',
      userContent,
      model: (node.data?.model as string) || 'gpt-5',
      reasoningEffort: (node.data?.reasoningEffort as string) || DEFAULT_REASONING,
      tools: node.data?.tools as AgentToolsConfig
    };

    this.log(node.id, 'start_prompt', invocation.userContent || '');

    try {
      const responseText = await this.llm.respond(invocation);
      this.log(node.id, 'llm_response', responseText);
      return responseText;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(node.id, 'llm_error', message);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  private findLastNonApprovalOutput(): string | null {
    const entries = Object.entries(this.state);
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const [key, value] = entries[i];
      if (key.includes('_approval') || key === 'previous_output' || key === 'pre_approval_output') {
        continue;
      }
      if (typeof value === 'string') {
        return value;
      }
    }
    return null;
  }

  private normalizeApprovalInput(input?: ApprovalInput | string | Record<string, unknown>): ApprovalInput {
    if (typeof input === 'string') {
      return {
        decision: input.toLowerCase().includes('reject') ? 'reject' : 'approve',
        note: ''
      };
    }
    if (input && typeof input === 'object') {
      const decision =
        input.decision === 'reject' ||
        (typeof input.decision === 'string' && input.decision.toLowerCase() === 'reject')
          ? 'reject'
          : 'approve';
      return {
        decision,
        note: typeof input.note === 'string' ? input.note : ''
      };
    }
    return { decision: 'approve', note: '' };
  }

  private describeApprovalResult(result: ApprovalInput): string {
    const base = result.decision === 'approve' ? 'User approved this step.' : 'User rejected this step.';
    if (result.note && result.note.trim()) {
      return `${base} Feedback: ${result.note.trim()}`;
    }
    return base;
  }
}

export default WorkflowEngine;
