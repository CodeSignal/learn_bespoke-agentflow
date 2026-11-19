// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_HEADER_CENTER_Y, PORT_RADIUS } from '../constants';
import type { PortInteractions } from '../editor-host';
import type { EditorNode } from '../types';
import { createPortElement, renderPorts } from './ports';

const collectHandles = (node: EditorNode): string[] => {
  const handles: string[] = [];
  renderPorts(node, { appendChild: (port) => handles.push(port.dataset.handle ?? '') }, (nodeId, handle) => {
    const port = document.createElement('div');
    port.dataset.nodeId = nodeId;
    port.dataset.handle = handle;
    return port;
  });
  return handles;
};

describe('renderPorts', () => {
  it('renders an output port for start nodes', () => {
    const createPort = vi.fn((_nodeId: string, handle: string) => {
      const port = document.createElement('div');
      port.dataset.handle = handle;
      return port;
    });
    const appended: HTMLElement[] = [];

    renderPorts({ id: 'node_start', type: 'start', x: 0, y: 0 }, { appendChild: (port) => appended.push(port) }, createPort);

    expect(createPort).toHaveBeenCalledTimes(1);
    expect(createPort).toHaveBeenCalledWith(
      'node_start',
      'output',
      'port-out',
      'Next step',
      DEFAULT_HEADER_CENTER_Y - PORT_RADIUS
    );
    expect(appended.map((port) => port.dataset.handle)).toEqual(['output']);
  });

  it('renders the ports of each node type', () => {
    expect(collectHandles({ id: 'a', type: 'agent', x: 0, y: 0, data: { tools: { subagents: false } } }))
      .toEqual(['subagent-target', 'input', 'output']);
    expect(collectHandles({ id: 'a', type: 'agent', x: 0, y: 0, data: { tools: { subagents: true } } }))
      .toEqual(['subagent-target', 'input', 'output', 'subagent']);
    expect(collectHandles({ id: 'p', type: 'approval', x: 0, y: 0 })).toEqual(['input', 'approve', 'reject']);
    expect(collectHandles({
      id: 'c',
      type: 'if',
      x: 0,
      y: 0,
      data: { conditions: [{ operator: 'equal', value: 'a' }, { operator: 'equal', value: 'b' }] }
    })).toEqual(['input', 'condition-0', 'condition-1', 'false']);
  });

  it('aggregates condition ports on a collapsed multi-condition node', () => {
    expect(collectHandles({
      id: 'c',
      type: 'if',
      x: 0,
      y: 0,
      data: { collapsed: true, conditions: [{ operator: 'equal', value: 'a' }, { operator: 'equal', value: 'b' }] }
    })).toEqual(['input', 'condition-0', 'false']);
  });
});

describe('createPortElement', () => {
  const interactions = (): PortInteractions => ({
    onPortMouseDown: vi.fn(),
    onPortMouseUp: vi.fn(),
    onPortKeyActivate: vi.fn()
  });

  it('makes a source port a focusable button that starts a connection', () => {
    const handlers = interactions();
    const port = createPortElement(handlers, 'n1', 'output', 'port-out', 'Output', 18);

    expect(port.getAttribute('role')).toBe('button');
    expect(port.tabIndex).toBe(0);
    expect(port.getAttribute('aria-label')).toBe('Output');
    expect(port.style.top).toBe('18px');

    port.dispatchEvent(new MouseEvent('mousedown'));
    expect(handlers.onPortMouseDown).toHaveBeenCalledTimes(1);
    port.dispatchEvent(new MouseEvent('mouseup'));
    expect(handlers.onPortMouseUp).not.toHaveBeenCalled();
  });

  it('makes a target port accept a connection on mouse up', () => {
    const handlers = interactions();
    const port = createPortElement(handlers, 'n1', 'input', 'port-in', 'Input');
    port.dispatchEvent(new MouseEvent('mouseup'));
    port.dispatchEvent(new MouseEvent('mousedown'));
    expect(handlers.onPortMouseUp).toHaveBeenCalledTimes(1);
    expect(handlers.onPortMouseDown).not.toHaveBeenCalled();
  });

  it('activates from the keyboard with Enter and Space only', () => {
    const handlers = interactions();
    const port = createPortElement(handlers, 'n1', 'output', 'port-out', 'Output');
    port.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    port.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    port.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(handlers.onPortKeyActivate).toHaveBeenCalledTimes(2);
    expect(handlers.onPortKeyActivate).toHaveBeenCalledWith('n1', 'output');
  });

  it('leaves a non-connectable port inert', () => {
    const handlers = interactions();
    const port = createPortElement(handlers, 'n1', 'condition-0', 'port-out', 'Expand to connect', null, false);
    expect(port.getAttribute('aria-disabled')).toBe('true');
    expect(port.hasAttribute('tabindex')).toBe(false);
    port.dispatchEvent(new MouseEvent('mousedown'));
    port.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(handlers.onPortMouseDown).not.toHaveBeenCalled();
    expect(handlers.onPortKeyActivate).not.toHaveBeenCalled();
  });
});
