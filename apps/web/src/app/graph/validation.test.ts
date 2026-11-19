import type { WorkflowConnection } from '@agentflow/types';
import { describe, expect, it } from 'vitest';

import type { EditorNode } from '../types';
import {
  canNodeBecomeSubagentTarget,
  getConnectionValidationError,
  getRunDisableReason,
  getSubagentGraphValidationError,
  isValidGraphInput
} from './validation';

const node = (id: string, type: string, data: EditorNode['data'] = {}): EditorNode => ({ id, type, x: 0, y: 0, data });
const agent = (id: string, subagents = false): EditorNode =>
  node(id, 'agent', { tools: { web_search: false, subagents } });
const edge = (source: string, target: string, sourceHandle = 'output', targetHandle: string | undefined = 'input'): WorkflowConnection =>
  ({ source, target, sourceHandle, targetHandle });
const sub = (source: string, target: string): WorkflowConnection => edge(source, target, 'subagent');

describe('isValidGraphInput', () => {
  it('accepts graphs whose nodes have string ids and types', () => {
    expect(isValidGraphInput({ nodes: [{ id: 'a', type: 'start' }], connections: [] })).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isValidGraphInput(null)).toBe(false);
    expect(isValidGraphInput({ nodes: [] })).toBe(false);
    expect(isValidGraphInput({ nodes: [{ id: 1, type: 'start' }], connections: [] })).toBe(false);
    expect(isValidGraphInput({ nodes: [{ id: 'a' }], connections: [] })).toBe(false);
  });
});

describe('getRunDisableReason', () => {
  const start = node('s', 'start');

  it('allows a connected Start -> Agent workflow', () => {
    expect(getRunDisableReason([start, agent('a')], [edge('s', 'a')])).toBeNull();
  });

  it('requires a Start node', () => {
    expect(getRunDisableReason([agent('a')], [])).toBe('Add a Start node to run the workflow.');
  });

  it('rejects more than one Start node', () => {
    expect(getRunDisableReason([start, node('s2', 'start')], [])).toBe('Use only one Start node before running.');
  });

  it('rejects connections that reference a missing node', () => {
    expect(getRunDisableReason([start, agent('a')], [edge('s', 'a'), edge('a', 'ghost')])).toBe(
      'Fix broken connections before running.'
    );
    expect(getRunDisableReason([start, agent('a')], [edge('s', 'a'), edge('ghost', 'a')])).toBe(
      'Fix broken connections before running.'
    );
  });

  it('reports invalid subagent structures', () => {
    const reason = getRunDisableReason([start, agent('a'), agent('b')], [edge('s', 'a'), sub('a', 'b')]);
    expect(reason).toBe('Enable Subagents on the parent agent before linking subagents.');
  });

  it('requires Start to have an outgoing execution connection', () => {
    expect(getRunDisableReason([start, agent('a')], [])).toBe('Connect Start to another node before running.');
  });

  it('requires a reachable Condition node to have a branch', () => {
    const nodes = [start, node('c', 'if')];
    expect(getRunDisableReason(nodes, [edge('s', 'c')])).toBe('Connect at least one branch for each Condition node.');
  });

  it('accepts a Condition node with only a condition branch or only the fallback', () => {
    const nodes = [start, node('c', 'if'), agent('a')];
    expect(getRunDisableReason(nodes, [edge('s', 'c'), edge('c', 'a', 'condition-0')])).toBeNull();
    expect(getRunDisableReason(nodes, [edge('s', 'c'), edge('c', 'a', 'false')])).toBeNull();
    expect(getRunDisableReason(nodes, [edge('s', 'c'), edge('c', 'a', 'true')])).toBeNull();
  });

  it('requires a reachable approval node to have a branch', () => {
    const reason = 'Connect at least one branch for each User Approval node.';
    expect(getRunDisableReason([start, node('p', 'approval')], [edge('s', 'p')])).toBe(reason);
    expect(getRunDisableReason([start, node('p', 'input')], [edge('s', 'p')])).toBe(reason);
  });

  it('accepts an approval node with only one branch', () => {
    const nodes = [start, node('p', 'approval'), agent('a')];
    expect(getRunDisableReason(nodes, [edge('s', 'p'), edge('p', 'a', 'approve')])).toBeNull();
    expect(getRunDisableReason(nodes, [edge('s', 'p'), edge('p', 'a', 'reject')])).toBeNull();
  });

  it('ignores unreachable nodes', () => {
    const nodes = [start, agent('a'), node('c', 'if'), node('p', 'approval')];
    expect(getRunDisableReason(nodes, [edge('s', 'a')])).toBeNull();
  });

  it('allows loops in the regular flow', () => {
    const nodes = [start, agent('a'), node('c', 'if')];
    const connections = [edge('s', 'a'), edge('a', 'c'), edge('c', 'a', 'false')];
    expect(getRunDisableReason(nodes, connections)).toBeNull();
  });

  it('allows nested acyclic subagent chains', () => {
    const nodes = [start, agent('a', true), agent('b', true), agent('c')];
    expect(getRunDisableReason(nodes, [edge('s', 'a'), sub('a', 'b'), sub('b', 'c')])).toBeNull();
  });
});

describe('getSubagentGraphValidationError', () => {
  it('returns null without subagent links', () => {
    expect(getSubagentGraphValidationError([agent('a'), agent('b')], [edge('a', 'b')])).toBeNull();
  });

  it('requires agent nodes at both ends', () => {
    expect(getSubagentGraphValidationError([node('c', 'if'), agent('b')], [sub('c', 'b')])).toBe(
      'Subagent links must start from an Agent node.'
    );
    expect(getSubagentGraphValidationError([agent('a', true), node('c', 'if')], [sub('a', 'c')])).toBe(
      'Subagent links must target an Agent node.'
    );
  });

  it('requires the input target handle, and accepts it omitted', () => {
    const nodes = [agent('a', true), agent('b')];
    expect(getSubagentGraphValidationError(nodes, [edge('a', 'b', 'subagent', 'other')])).toBe(
      'Subagent links must connect to the target input handle.'
    );
    expect(getSubagentGraphValidationError(nodes, [edge('a', 'b', 'subagent', undefined)])).toBeNull();
  });

  it('rejects self references', () => {
    expect(getSubagentGraphValidationError([agent('a', true)], [sub('a', 'a')])).toBe(
      'An agent cannot be a subagent of itself.'
    );
  });

  it('rejects a subagent with two parents', () => {
    const nodes = [agent('a', true), agent('b', true), agent('c')];
    expect(getSubagentGraphValidationError(nodes, [sub('a', 'c'), sub('b', 'c')])).toBe(
      'A subagent can belong to only one parent agent.'
    );
  });

  it('rejects subagent targets that are part of the regular flow', () => {
    const nodes = [node('s', 'start'), agent('a', true), agent('b')];
    const message = 'Subagent targets cannot be connected to regular workflow execution edges.';
    expect(getSubagentGraphValidationError(nodes, [sub('a', 'b'), edge('s', 'b')])).toBe(message);
    expect(getSubagentGraphValidationError(nodes, [sub('a', 'b'), edge('b', 'a')])).toBe(message);
  });

  it('rejects cycles and names them', () => {
    const nodes = [agent('a', true), agent('b', true), agent('c', true)];
    const error = getSubagentGraphValidationError(nodes, [sub('a', 'b'), sub('b', 'c'), sub('c', 'a')]);
    expect(error).toBe('Subagent hierarchy must be acyclic. Cycle: a -> b -> c -> a');
  });
});

describe('getConnectionValidationError', () => {
  it('rejects connections to missing nodes', () => {
    expect(getConnectionValidationError([agent('a')], [], edge('a', 'ghost'))).toBe(
      'Connection source or target node is missing.'
    );
  });

  it('allows a regular connection between regular nodes', () => {
    expect(getConnectionValidationError([agent('a'), agent('b')], [], edge('a', 'b'))).toBeNull();
  });

  it('applies the subagent source and target rules', () => {
    expect(getConnectionValidationError([node('c', 'if'), agent('b')], [], sub('c', 'b'))).toBe(
      'Only agent nodes can define subagents.'
    );
    expect(getConnectionValidationError([agent('a'), agent('b')], [], sub('a', 'b'))).toBe(
      'Enable Subagents on the parent agent before adding subagent links.'
    );
    expect(getConnectionValidationError([agent('a', true), node('c', 'if')], [], sub('a', 'c'))).toBe(
      'Subagent links can only target agent nodes.'
    );
    expect(getConnectionValidationError([agent('a', true)], [], sub('a', 'a'))).toBe(
      'An agent cannot be a subagent of itself.'
    );
  });

  it('accepts a subagent link with the target handle omitted, like the graph check does', () => {
    const nodes = [agent('a', true), agent('b')];
    expect(getConnectionValidationError(nodes, [], edge('a', 'b', 'subagent', undefined))).toBeNull();
    expect(getConnectionValidationError(nodes, [], edge('a', 'b', 'subagent', 'other'))).toBe(
      'Subagent links must connect to the target input handle.'
    );
  });

  it('keeps subagent targets out of the regular flow', () => {
    const nodes = [agent('a', true), agent('b'), agent('c')];
    const existing = [sub('a', 'b')];
    expect(getConnectionValidationError(nodes, existing, edge('b', 'c'))).toBe(
      'Subagent targets cannot be used as sources in regular workflow edges.'
    );
    expect(getConnectionValidationError(nodes, existing, edge('c', 'b'))).toBe(
      'Subagent targets cannot be used as targets in regular workflow edges.'
    );
  });

  it('rejects making a node with execution edges a subagent', () => {
    const nodes = [agent('a', true), agent('b'), agent('c')];
    expect(getConnectionValidationError(nodes, [edge('b', 'c')], sub('a', 'b'))).toBe(
      'Subagent targets cannot be connected to regular workflow execution edges.'
    );
  });

  it('rejects a second parent and a cycle', () => {
    const nodes = [agent('a', true), agent('b', true), agent('c', true)];
    expect(getConnectionValidationError(nodes, [sub('a', 'c')], sub('b', 'c'))).toBe(
      'A subagent can belong to only one parent agent.'
    );
    expect(getConnectionValidationError(nodes, [sub('a', 'b'), sub('b', 'c')], sub('c', 'a'))).toContain(
      'Subagent hierarchy must be acyclic.'
    );
  });
});

describe('canNodeBecomeSubagentTarget', () => {
  it('is true only for a free agent with an eligible parent', () => {
    const nodes = [agent('a', true), agent('b'), node('c', 'if')];
    expect(canNodeBecomeSubagentTarget(nodes, [], 'b')).toBe(true);
    expect(canNodeBecomeSubagentTarget(nodes, [], 'c')).toBe(false);
    expect(canNodeBecomeSubagentTarget(nodes, [], 'a')).toBe(false);
    expect(canNodeBecomeSubagentTarget(nodes, [sub('a', 'b')], 'b')).toBe(false);
    expect(canNodeBecomeSubagentTarget(nodes, [edge('b', 'c')], 'b')).toBe(false);
  });
});
