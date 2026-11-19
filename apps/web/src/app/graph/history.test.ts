import { describe, expect, it } from 'vitest';

import type { WorkflowGraphPayload } from '../types';
import { GraphHistory } from './history';

const graph = (...ids: string[]): WorkflowGraphPayload => ({
  nodes: ids.map((id) => ({ id, type: 'agent', x: 0, y: 0, data: {} })),
  connections: []
});
const ids = (value: WorkflowGraphPayload | null) => value?.nodes.map((node) => node.id) ?? null;

describe('GraphHistory', () => {
  it('has nothing to undo or redo at first', () => {
    const history = new GraphHistory(graph('a'));
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.undo(graph('a'))).toBeNull();
    expect(history.redo(graph('a'))).toBeNull();
  });

  it('undoes and redoes observed steps', () => {
    const history = new GraphHistory(graph('a'));
    history.observe(graph('a', 'b'));
    history.observe(graph('a', 'b', 'c'));

    expect(ids(history.undo(graph('a', 'b', 'c')))).toEqual(['a', 'b']);
    expect(ids(history.undo(graph('a', 'b')))).toEqual(['a']);
    expect(history.undo(graph('a'))).toBeNull();
    expect(ids(history.redo(graph('a')))).toEqual(['a', 'b']);
    expect(ids(history.redo(graph('a', 'b')))).toEqual(['a', 'b', 'c']);
    expect(history.redo(graph('a', 'b', 'c'))).toBeNull();
  });

  it('ignores an observation that changes nothing', () => {
    const history = new GraphHistory(graph('a'));
    expect(history.observe(graph('a'))).toBe(false);
    expect(history.canUndo()).toBe(false);
  });

  it('does not create steps for view-only fields', () => {
    const history = new GraphHistory(graph('a'));
    const collapsed = graph('a');
    collapsed.nodes[0].data = { collapsed: true, initialInput: 'hello' };
    expect(history.observe(collapsed)).toBe(false);
  });

  it('captures an unobserved edit before undoing, so it can be redone', () => {
    const history = new GraphHistory(graph('a'));
    // The live graph changed but the debounced observe has not run yet.
    expect(ids(history.undo(graph('a', 'b')))).toEqual(['a']);
    expect(ids(history.redo(graph('a')))).toEqual(['a', 'b']);
  });

  it('drops the redo stack after a new edit', () => {
    const history = new GraphHistory(graph('a'));
    history.observe(graph('a', 'b'));
    history.undo(graph('a', 'b'));
    history.observe(graph('a', 'x'));
    expect(history.canRedo()).toBe(false);
    expect(history.redo(graph('a', 'x'))).toBeNull();
    // An unobserved edit also invalidates redo.
    history.undo(graph('a', 'x'));
    expect(history.redo(graph('a', 'y'))).toBeNull();
  });

  it('is bounded', () => {
    const history = new GraphHistory(graph('n0'), 3);
    for (let i = 1; i <= 10; i += 1) history.observe(graph(`n${i}`));
    const seen: Array<string[] | null> = [];
    let current = graph('n10');
    for (let i = 0; i < 5; i += 1) {
      const previous = history.undo(current);
      seen.push(ids(previous));
      if (previous) current = previous;
    }
    expect(seen).toEqual([['n9'], ['n8'], ['n7'], null, null]);
  });

  it('returns copies, so later mutation does not corrupt history', () => {
    const history = new GraphHistory(graph('a'));
    const live = graph('a', 'b');
    history.observe(live);
    live.nodes[1].id = 'mutated';
    const restored = history.undo(graph('a', 'b'));
    if (restored) restored.nodes[0].id = 'mutated-too';
    expect(ids(history.redo(graph('a')))).toEqual(['a', 'b']);
    expect(ids(history.undo(graph('a', 'b')))).toEqual(['a']);
  });

  it('forgets everything on reset', () => {
    const history = new GraphHistory(graph('a'));
    history.observe(graph('a', 'b'));
    history.reset(graph('z'));
    expect(history.canUndo()).toBe(false);
    expect(history.undo(graph('z'))).toBeNull();
  });
});
