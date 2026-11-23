import type { WorkflowConnection } from '@agentflow/types';
import { describe, expect, it } from 'vitest';

import type { EditorNode } from '../types';
import {
  getIfConditionHandle,
  getIfConditionIndexFromHandle,
  getIfConditions,
  normalizeIfCondition,
  removeIfCondition
} from './if-conditions';
import { upgradeLegacyGraph } from './legacy-upgrade';

const ifNode = (values: string[]): EditorNode => ({
  id: 'c',
  type: 'if',
  x: 0,
  y: 0,
  data: { conditions: values.map((value) => ({ operator: 'equal' as const, value })) }
});
const edge = (source: string, target: string, sourceHandle: string): WorkflowConnection =>
  ({ source, target, sourceHandle, targetHandle: 'input' });

describe('if-condition helpers', () => {
  it('normalises unknown shapes', () => {
    expect(normalizeIfCondition(null)).toEqual({ operator: 'equal', value: '' });
    expect(normalizeIfCondition({ operator: 'contains', value: 'x' })).toEqual({ operator: 'contains', value: 'x' });
    expect(normalizeIfCondition({ operator: 'weird', value: 3 })).toEqual({ operator: 'equal', value: '' });
  });

  it('maps handles to indexes, including the legacy true handle', () => {
    expect(getIfConditionHandle(2)).toBe('condition-2');
    expect(getIfConditionIndexFromHandle('condition-2')).toBe(2);
    expect(getIfConditionIndexFromHandle('true')).toBe(0);
    expect(getIfConditionIndexFromHandle('false')).toBeNull();
    expect(getIfConditionIndexFromHandle('condition-x')).toBeNull();
    expect(getIfConditionIndexFromHandle(undefined)).toBeNull();
  });

  it('always returns at least one condition', () => {
    const node: EditorNode = { id: 'c', type: 'if', x: 0, y: 0 };
    expect(getIfConditions(node)).toEqual([{ operator: 'equal', value: '' }]);
    expect(node.data?.conditions).toHaveLength(1);
  });
});

describe('removeIfCondition', () => {
  it('drops the removed branch and re-indexes the later ones', () => {
    const node = ifNode(['a', 'b', 'c']);
    const connections = [
      edge('s', 'c', 'output'),
      edge('c', 'x', 'condition-0'),
      edge('c', 'y', 'condition-1'),
      edge('c', 'z', 'condition-2'),
      edge('c', 'f', 'false'),
      edge('other', 'q', 'condition-1')
    ];

    const next = removeIfCondition(node, 1, connections);

    expect(node.data?.conditions?.map((condition) => condition.value)).toEqual(['a', 'c']);
    expect(next).toEqual([
      edge('s', 'c', 'output'),
      edge('c', 'x', 'condition-0'),
      edge('c', 'z', 'condition-1'),
      edge('c', 'f', 'false'),
      edge('other', 'q', 'condition-1')
    ]);
  });

  it('keeps the last remaining condition', () => {
    const node = ifNode(['only']);
    const connections = [edge('c', 'x', 'condition-0')];
    expect(removeIfCondition(node, 0, connections)).toBe(connections);
    expect(node.data?.conditions).toHaveLength(1);
  });
});

describe('upgradeLegacyGraph', () => {
  it('turns input nodes into approval nodes with a default prompt', () => {
    const nodes: EditorNode[] = [{ id: 'n', type: 'input', x: 0, y: 0, data: {} }];
    expect(upgradeLegacyGraph(nodes, [])).toBe(true);
    expect(nodes[0].type).toBe('approval');
    expect(nodes[0].data?.prompt).toBe('Review and approve this step.');
  });

  it('keeps an existing prompt on a legacy input node', () => {
    const nodes: EditorNode[] = [{ id: 'n', type: 'input', x: 0, y: 0, data: { prompt: 'Check it' } }];
    upgradeLegacyGraph(nodes, []);
    expect(nodes[0].data?.prompt).toBe('Check it');
  });

  it('fills in missing agent tool flags', () => {
    const nodes: EditorNode[] = [{ id: 'a', type: 'agent', x: 0, y: 0, data: { tools: { web_search: true } } }];
    expect(upgradeLegacyGraph(nodes, [])).toBe(true);
    expect(nodes[0].data?.tools).toEqual({ web_search: true, subagents: false });
  });

  it('converts a legacy condition string and the true handle', () => {
    const nodes: EditorNode[] = [{ id: 'c', type: 'if', x: 0, y: 0, data: { condition: 'yes' } }];
    const connections = [edge('c', 'x', 'true'), edge('c', 'y', 'false'), edge('other', 'z', 'true')];
    expect(upgradeLegacyGraph(nodes, connections)).toBe(true);
    expect(nodes[0].data?.conditions).toEqual([{ operator: 'contains', value: 'yes' }]);
    expect(nodes[0].data && 'condition' in nodes[0].data).toBe(false);
    expect(connections.map((connection) => connection.sourceHandle)).toEqual(['condition-0', 'false', 'true']);
  });

  it('reports no change for an up-to-date graph, however often it runs', () => {
    const nodes: EditorNode[] = [
      { id: 's', type: 'start', x: 0, y: 0, data: {} },
      { id: 'a', type: 'agent', x: 0, y: 0, data: { tools: { web_search: false, subagents: true } } },
      { id: 'c', type: 'if', x: 0, y: 0, data: { conditions: [{ operator: 'contains', value: 'x' }] } },
      { id: 'p', type: 'approval', x: 0, y: 0, data: { prompt: 'ok' } }
    ];
    const connections = [edge('c', 'a', 'condition-0')];
    const before = JSON.stringify({ nodes, connections });
    expect(upgradeLegacyGraph(nodes, connections)).toBe(false);
    expect(upgradeLegacyGraph(nodes, connections)).toBe(false);
    expect(JSON.stringify({ nodes, connections })).toBe(before);
  });
});
