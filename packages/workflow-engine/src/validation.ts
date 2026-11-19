import type { WorkflowGraph } from '@agentic/types';

export const MAX_GRAPH_NODES = 500;
export const MAX_GRAPH_CONNECTIONS = 2000;

export type GraphValidationResult =
  | { ok: true; graph: WorkflowGraph }
  | { ok: false; errors: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

/**
 * Structural validation of an untrusted workflow graph payload. It checks
 * shapes and references only; execution rules (start node, subagent hierarchy)
 * are enforced by the engine at run time.
 */
export function validateWorkflowGraph(input: unknown): GraphValidationResult {
  if (!isPlainObject(input) || !Array.isArray(input.nodes) || !Array.isArray(input.connections)) {
    return { ok: false, errors: ['Graph must be an object with "nodes" and "connections" arrays.'] };
  }

  const errors: string[] = [];
  const { nodes, connections } = input;

  if (nodes.length > MAX_GRAPH_NODES) {
    errors.push(`Graph has ${nodes.length} nodes; the limit is ${MAX_GRAPH_NODES}.`);
  }
  if (connections.length > MAX_GRAPH_CONNECTIONS) {
    errors.push(`Graph has ${connections.length} connections; the limit is ${MAX_GRAPH_CONNECTIONS}.`);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const nodeIds = new Set<string>();
  nodes.forEach((node: unknown, index: number) => {
    if (!isPlainObject(node)) {
      errors.push(`nodes[${index}] must be an object.`);
      return;
    }
    if (typeof node.id !== 'string' || !node.id) {
      errors.push(`nodes[${index}].id must be a non-empty string.`);
    } else if (nodeIds.has(node.id)) {
      errors.push(`nodes[${index}].id "${node.id}" is duplicated.`);
    } else {
      nodeIds.add(node.id);
    }
    if (typeof node.type !== 'string' || !node.type) {
      errors.push(`nodes[${index}].type must be a non-empty string.`);
    }
    for (const axis of ['x', 'y'] as const) {
      const value = node[axis];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
        errors.push(`nodes[${index}].${axis} must be a finite number.`);
      }
    }
    if (node.data !== undefined && node.data !== null && !isPlainObject(node.data)) {
      errors.push(`nodes[${index}].data must be an object.`);
    }
  });

  connections.forEach((connection: unknown, index: number) => {
    if (!isPlainObject(connection)) {
      errors.push(`connections[${index}] must be an object.`);
      return;
    }
    for (const end of ['source', 'target'] as const) {
      const value = connection[end];
      if (typeof value !== 'string' || !value) {
        errors.push(`connections[${index}].${end} must be a non-empty string.`);
      } else if (!nodeIds.has(value)) {
        errors.push(`connections[${index}].${end} references unknown node "${value}".`);
      }
    }
    if (!isOptionalString(connection.sourceHandle) || !isOptionalString(connection.targetHandle)) {
      errors.push(`connections[${index}] handles must be strings when present.`);
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, graph: input as unknown as WorkflowGraph };
}
