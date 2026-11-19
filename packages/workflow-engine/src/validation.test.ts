import { describe, expect, it } from 'vitest';
import { MAX_GRAPH_NODES, validateWorkflowGraph } from './validation.js';

const errorsOf = (input: unknown): string[] => {
  const result = validateWorkflowGraph(input);
  return result.ok ? [] : result.errors;
};

describe('validateWorkflowGraph', () => {
  it('accepts a well-formed graph', () => {
    const graph = {
      nodes: [
        { id: 'a', type: 'start', x: 0, y: 0, data: {} },
        { id: 'b', type: 'agent', x: 10, y: 10 }
      ],
      connections: [{ source: 'a', target: 'b', sourceHandle: 'output', targetHandle: 'input' }]
    };
    expect(validateWorkflowGraph(graph)).toEqual({ ok: true, graph });
  });

  it.each([undefined, null, 'graph', [], {}, { nodes: [] }, { nodes: {}, connections: [] }])(
    'rejects a payload without node and connection arrays: %j',
    (input) => {
      expect(errorsOf(input)).toHaveLength(1);
    }
  );

  it('reports malformed nodes', () => {
    const errors = errorsOf({
      nodes: [null, { id: '', type: 'agent' }, { id: 'a', type: 5 }, { id: 'a', type: 'agent', x: 'left', data: [] }],
      connections: []
    });
    expect(errors).toEqual([
      'nodes[0] must be an object.',
      'nodes[1].id must be a non-empty string.',
      'nodes[2].type must be a non-empty string.',
      'nodes[3].id "a" is duplicated.',
      'nodes[3].x must be a finite number.',
      'nodes[3].data must be an object.'
    ]);
  });

  it('reports malformed connections and unknown references', () => {
    const errors = errorsOf({
      nodes: [{ id: 'a', type: 'start' }],
      connections: ['a->b', { source: 'a', target: 'missing' }, { source: 'a', target: 'a', sourceHandle: 3 }]
    });
    expect(errors).toEqual([
      'connections[0] must be an object.',
      'connections[1].target references unknown node "missing".',
      'connections[2] handles must be strings when present.'
    ]);
  });

  it('rejects oversized graphs', () => {
    const nodes = Array.from({ length: MAX_GRAPH_NODES + 1 }, (_, index) => ({ id: `n${index}`, type: 'agent' }));
    expect(errorsOf({ nodes, connections: [] })[0]).toMatch(/limit is 500/);
  });
});
