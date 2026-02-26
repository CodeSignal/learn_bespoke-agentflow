import { describe, expect, it, vi } from 'vitest';

import { WorkflowEditor } from './workflow-editor';

describe('WorkflowEditor renderPorts', () => {
  it('renders an output port for start nodes', () => {
    const renderPorts = (
      WorkflowEditor.prototype as unknown as {
        renderPorts: (
          node: { id: string; type: string },
          el: { appendChild: (port: { handle: string }) => void }
        ) => void;
      }
    ).renderPorts;
    const createPort = vi.fn((_nodeId: string, handle: string) => ({ handle }));
    const appended: Array<{ handle: string }> = [];
    const element = {
      appendChild: (port: { handle: string }) => {
        appended.push(port);
      }
    };

    renderPorts.call(
      { createPort },
      { id: 'node_start', type: 'start' },
      element
    );

    expect(createPort).toHaveBeenCalledTimes(1);
    expect(createPort).toHaveBeenCalledWith('node_start', 'output', 'port-out');
    expect(appended).toEqual([{ handle: 'output' }]);
  });
});
