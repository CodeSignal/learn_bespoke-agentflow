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
const APPROVAL_CONTEXTS_STATE_KEY = '__approval_contexts__';
const PENDING_APPROVAL_QUEUE_STATE_KEY = '__pending_approval_queue__';
const DEFERRED_NODE_QUEUE_STATE_KEY = '__deferred_node_queue__';

type IfConditionOperator = 'equal' | 'contains';

interface IfCondition {
  operator: IfConditionOperator;
  value: string;
}

interface DeferredNodeExecution {
  nodeId: string;
  previousOutput: unknown;
}

class MissingLLM implements WorkflowLLM {
  async respond(): Promise<string> {
    throw new Error('No LLM service configured. Set OPENAI_API_KEY in the environment.');
  }
}

export class WorkflowEngine {
  private readonly runId: string;

  private readonly timestampFn: () => string;

  private onLog?: (entry: WorkflowLogEntry) => void;

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

  setOnLog(onLog?: (entry: WorkflowLogEntry) => void): void {
    this.onLog = onLog;
  }

  async run(): Promise<WorkflowRunResult> {
    this.status = 'running';
    this.waitingForInput = false;
    const startNode = this.graph.nodes.find((n) => n.type === 'start');
    if (!startNode) {
      this.log('system', 'error', 'No start node found in workflow graph');
      this.status = 'failed';
      return this.getResult();
    }

    this.currentNodeId = startNode.id;
    await this.processNode(startNode);
    if (this.status === 'running') {
      await this.drainDeferredNodes();
    }
    if (this.status === 'running') {
      this.status = 'completed';
      this.currentNodeId = null;
    }
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

    let previousOutput: unknown = input ?? '';
    let connections: WorkflowConnection[] = [];

    if (currentNode.type === 'approval') {
      this.removePendingApproval(currentNode.id);
      const normalized = this.normalizeApprovalInput(input);
      const logMessage = this.describeApprovalResult(normalized);
      this.log(currentNode.id, 'input_received', logMessage);
      this.state[`${currentNode.id}_approval`] = normalized;

      const restored = this.consumeApprovalContext(currentNode.id) ?? this.state.pre_approval_output;
      if (restored !== undefined) {
        previousOutput = restored;
      }
      delete this.state.pre_approval_output;
      connections = this.graph.connections.filter(
        (c) => c.source === currentNode.id && c.sourceHandle === normalized.decision
      );
    } else {
      this.log(currentNode.id, 'input_received', JSON.stringify(input));
      connections = this.graph.connections.filter((c) => c.source === currentNode.id);
    }

    this.state.previous_output = previousOutput;

    await this.processConnections(currentNode.id, connections, previousOutput);
    if (this.status === 'running') {
      await this.drainDeferredNodes();
    }
    if (this.status === 'running') {
      const nextPendingApprovalNodeId = this.dequeuePendingApproval();
      if (nextPendingApprovalNodeId) {
        this.currentNodeId = nextPendingApprovalNodeId;
        this.waitingForInput = true;
        this.status = 'paused';
        this.log(nextPendingApprovalNodeId, 'wait_input', 'Waiting for user approval');
      } else {
        this.status = 'completed';
        this.currentNodeId = null;
      }
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

  private async processNode(
    node: WorkflowNode,
    previousOutput: unknown = this.state.previous_output,
    writeSharedPreviousOutput = true
  ): Promise<unknown> {
    if (this.status !== 'running') {
      if (this.status === 'paused' && this.waitingForInput && node.type === 'approval') {
        this.setApprovalContext(node.id, previousOutput);
        this.enqueuePendingApproval(node.id);
        this.log(node.id, 'wait_input', 'Waiting for user approval');
      }
      return undefined;
    }

    this.log(node.id, 'step_start', this.describeNode(node));

    try {
      let output: unknown = null;

      switch (node.type) {
        case 'start':
          output = node.data?.initialInput || '';
          break;
        case 'agent':
          output = await this.executeAgentNode(node, previousOutput);
          break;
        case 'if': {
          const nextConnections = this.evaluateIfNodeConnections(node, previousOutput);
          await this.processConnections(node.id, nextConnections, previousOutput, writeSharedPreviousOutput);
          return undefined;
        }
        case 'approval':
          this.setApprovalContext(node.id, previousOutput);
          if (this.waitingForInput) {
            this.enqueuePendingApproval(node.id);
            this.log(node.id, 'wait_input', 'Waiting for user approval');
            return undefined;
          }
          this.state.pre_approval_output = previousOutput;
          this.currentNodeId = node.id;
          this.status = 'paused';
          this.waitingForInput = true;
          this.log(node.id, 'wait_input', 'Waiting for user approval');
          return undefined;
        case 'end':
          return undefined;
        default:
          this.log(node.id, 'warn', `Unknown node type "${node.type}" skipped`);
      }

      if (this.shouldSkipPostNodePropagation()) {
        return undefined;
      }

      if (writeSharedPreviousOutput) {
        this.state.previous_output = output;
      }
      this.state[node.id] = output;

      const nextConnections = this.graph.connections.filter((c) => c.source === node.id);
      await this.processConnections(node.id, nextConnections, output, writeSharedPreviousOutput);
      return output;
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
      return undefined;
    }
  }

  private async processConnections(
    sourceNodeId: string,
    connections: WorkflowConnection[],
    previousOutput: unknown,
    writeSharedPreviousOutput = true
  ): Promise<void> {
    if (connections.length === 0) {
      return;
    }

    if (this.status !== 'running') {
      if (this.status === 'paused' && this.waitingForInput) {
        this.deferConnections(sourceNodeId, connections, previousOutput);
      }
      return;
    }

    const nextNodes: WorkflowNode[] = [];
    for (const connection of connections) {
      const nextNode = this.graph.nodes.find((n) => n.id === connection.target);
      if (!nextNode) {
        this.log(sourceNodeId, 'warn', `Connection target "${connection.target}" not found`);
        continue;
      }
      nextNodes.push(nextNode);
    }

    if (nextNodes.length === 0) {
      return;
    }

    if (nextNodes.length === 1) {
      await this.processNode(nextNodes[0], previousOutput, writeSharedPreviousOutput);
      return;
    }

    await Promise.all(nextNodes.map((nextNode) => this.processNode(nextNode, previousOutput, false)));
  }

  private deferConnections(
    sourceNodeId: string,
    connections: WorkflowConnection[],
    previousOutput: unknown
  ): void {
    for (const connection of connections) {
      const nextNode = this.graph.nodes.find((n) => n.id === connection.target);
      if (!nextNode) {
        this.log(sourceNodeId, 'warn', `Connection target "${connection.target}" not found`);
        continue;
      }
      this.enqueueDeferredNode(nextNode.id, previousOutput);
    }
  }

  private async drainDeferredNodes(): Promise<void> {
    while (this.status === 'running') {
      const deferred = this.dequeueDeferredNode();
      if (!deferred) {
        return;
      }

      const node = this.graph.nodes.find((candidate) => candidate.id === deferred.nodeId);
      if (!node) {
        this.log('system', 'warn', `Deferred node "${deferred.nodeId}" not found`);
        continue;
      }

      await this.processNode(node, deferred.previousOutput);
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

  private evaluateIfNodeConnections(node: WorkflowNode, previousOutput: unknown): WorkflowConnection[] {
    const input = this.getIfInputString(previousOutput);
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
      const selectedHandles = new Set<string>([`${IF_CONDITION_HANDLE_PREFIX}${index}`]);
      if (index === 0) {
        selectedHandles.add('true');
      }
      return this.graph.connections.filter(
        (c) => c.source === node.id && typeof c.sourceHandle === 'string' && selectedHandles.has(c.sourceHandle)
      );
    }

    return this.graph.connections.filter(
      (c) => c.source === node.id && c.sourceHandle === 'false'
    );
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

  private getIfInputString(previousOutput: unknown): string {
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

  private async executeAgentNode(node: WorkflowNode, previousOutput: unknown): Promise<string> {
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

  private getApprovalContexts(): Record<string, unknown> {
    const raw = this.state[APPROVAL_CONTEXTS_STATE_KEY];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    const contexts: Record<string, unknown> = {};
    this.state[APPROVAL_CONTEXTS_STATE_KEY] = contexts;
    return contexts;
  }

  private setApprovalContext(nodeId: string, previousOutput: unknown): void {
    const contexts = this.getApprovalContexts();
    contexts[nodeId] = previousOutput;
  }

  private consumeApprovalContext(nodeId: string): unknown {
    const contexts = this.getApprovalContexts();
    const restored = contexts[nodeId];
    delete contexts[nodeId];
    if (Object.keys(contexts).length === 0) {
      delete this.state[APPROVAL_CONTEXTS_STATE_KEY];
    }
    return restored;
  }

  private getPendingApprovalQueue(): string[] {
    const raw = this.state[PENDING_APPROVAL_QUEUE_STATE_KEY];
    if (Array.isArray(raw)) {
      const queue = raw.filter((value): value is string => typeof value === 'string');
      if (queue.length !== raw.length) {
        this.state[PENDING_APPROVAL_QUEUE_STATE_KEY] = queue;
      }
      return queue;
    }
    const queue: string[] = [];
    this.state[PENDING_APPROVAL_QUEUE_STATE_KEY] = queue;
    return queue;
  }

  private enqueuePendingApproval(nodeId: string): void {
    if (this.currentNodeId === nodeId) return;
    const queue = this.getPendingApprovalQueue();
    if (!queue.includes(nodeId)) {
      queue.push(nodeId);
    }
  }

  private dequeuePendingApproval(): string | null {
    const queue = this.getPendingApprovalQueue();
    const nextNodeId = queue.shift() ?? null;
    if (queue.length === 0) {
      delete this.state[PENDING_APPROVAL_QUEUE_STATE_KEY];
    }
    return nextNodeId;
  }

  private removePendingApproval(nodeId: string): void {
    const raw = this.state[PENDING_APPROVAL_QUEUE_STATE_KEY];
    if (!Array.isArray(raw)) return;
    const queue = raw.filter((value): value is string => typeof value === 'string');
    const nextQueue = queue.filter((value) => value !== nodeId);
    if (nextQueue.length === queue.length) return;
    if (nextQueue.length === 0) {
      delete this.state[PENDING_APPROVAL_QUEUE_STATE_KEY];
      return;
    }
    this.state[PENDING_APPROVAL_QUEUE_STATE_KEY] = nextQueue;
  }

  private getDeferredNodeQueue(): DeferredNodeExecution[] {
    const raw = this.state[DEFERRED_NODE_QUEUE_STATE_KEY];
    if (Array.isArray(raw)) {
      const queue = raw.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const nodeId = (entry as { nodeId?: unknown }).nodeId;
        if (typeof nodeId !== 'string') return [];
        return [{ nodeId, previousOutput: (entry as { previousOutput?: unknown }).previousOutput }];
      });
      if (queue.length !== raw.length) {
        this.state[DEFERRED_NODE_QUEUE_STATE_KEY] = queue;
      }
      return queue;
    }
    const queue: DeferredNodeExecution[] = [];
    this.state[DEFERRED_NODE_QUEUE_STATE_KEY] = queue;
    return queue;
  }

  private enqueueDeferredNode(nodeId: string, previousOutput: unknown): void {
    const queue = this.getDeferredNodeQueue();
    queue.push({ nodeId, previousOutput });
  }

  private dequeueDeferredNode(): DeferredNodeExecution | null {
    const queue = this.getDeferredNodeQueue();
    const next = queue.shift() ?? null;
    if (queue.length === 0) {
      delete this.state[DEFERRED_NODE_QUEUE_STATE_KEY];
    }
    return next;
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

  private shouldSkipPostNodePropagation(): boolean {
    if (this.status === 'running') {
      return false;
    }
    if (this.status === 'failed' || this.status === 'completed') {
      return true;
    }
    if (this.status === 'paused' && !this.waitingForInput) {
      return true;
    }
    // Keep propagation active for paused + waitingForInput so processConnections
    // can defer downstream branches that have not executed yet.
    return false;
  }
}

export default WorkflowEngine;
