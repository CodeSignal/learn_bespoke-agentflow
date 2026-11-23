// @vitest-environment jsdom
import type { WorkflowConnection } from '@agentflow/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import indexHtml from '../../index.html?raw';
import { SAVE_DEBOUNCE_MS, WORKFLOW_STORAGE_KEY } from './constants';
import * as dsLoader from './ds-loader';
import type { EditorNode, WorkflowGraphPayload } from './types';
import { WorkflowEditor } from './workflow-editor';

// The design-system components are served from the submodule at runtime and
// cannot be imported here; confirmations resolve to "yes" and dropdowns are stubs.
vi.mock('./ds-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof dsLoader>();
  const destroyed: HTMLElement[] = [];
  class FakeDropdown {
    constructor(private readonly container: HTMLElement) {
      container.dataset.fakeDropdown = 'true';
    }

    destroy(): void {
      destroyed.push(this.container);
    }
  }
  return {
    ...actual,
    destroyedDropdowns: destroyed,
    getDropdownCtor: vi.fn(async () => FakeDropdown),
    getSplitPanelCtor: vi.fn(async () => { throw new Error('no split panel in tests'); }),
    openConfirmModal: vi.fn(async () => true)
  };
});

// The real page markup, so the test breaks if the editor and index.html drift apart.
const bodyHtml = indexHtml.slice(indexHtml.indexOf('<body>') + '<body>'.length, indexHtml.indexOf('<script'));

const destroyedDropdowns = (dsLoader as unknown as { destroyedDropdowns: HTMLElement[] }).destroyedDropdowns;

type FetchRoute = (url: string, init?: RequestInit) => Response | Promise<Response>;
let fetchRoute: FetchRoute;

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

const agentData = (overrides: EditorNode['data'] = {}): EditorNode['data'] => ({
  agentName: 'Agent',
  systemPrompt: 'You are a helpful assistant.',
  userPrompt: 'Summarise: {{PREVIOUS_OUTPUT}}',
  model: 'gpt-5',
  reasoningEffort: 'low',
  tools: { web_search: false, subagents: false },
  collapsed: true,
  ...overrides
});

const savedGraph = (): WorkflowGraphPayload => ({
  nodes: [
    { id: 'node_1', type: 'start', x: 100, y: 100, data: { collapsed: true, initialInput: 'Saved prompt' } },
    { id: 'node_2', type: 'agent', x: 300, y: 100, data: agentData({ agentName: 'Parent', tools: { web_search: false, subagents: true } }) },
    { id: 'node_3', type: 'agent', x: 300, y: 300, data: agentData({ agentName: 'Helper' }) }
  ],
  connections: [{ source: 'node_1', target: 'node_2', sourceHandle: 'output', targetHandle: 'input' }]
});

/** Creates the editor and waits for its asynchronous start-up to finish. */
async function createEditor(graph?: WorkflowGraphPayload): Promise<WorkflowEditor> {
  if (graph) localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(graph));
  const editor = new WorkflowEditor();
  await vi.waitFor(() => {
    expect((editor as unknown as { stateReady: boolean }).stateReady).toBe(true);
  });
  await Promise.resolve();
  return editor;
}

const nodeEl = (id: string) => document.getElementById(id) as HTMLElement;
const port = (nodeId: string, handle: string) =>
  document.querySelector<HTMLElement>(`.port[data-node-id="${nodeId}"][data-handle="${handle}"]`) as HTMLElement;
const lines = () => Array.from(document.querySelectorAll<SVGPathElement>('#connections-layer path.connection-line.editable'));
const key = (target: EventTarget, init: KeyboardEventInit) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const mouse = (target: EventTarget, type: string, init: MouseEventInit = {}) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
const connectionsOf = (editor: WorkflowEditor): WorkflowConnection[] => editor.store.connections;
const subagentLink: WorkflowConnection = { source: 'node_2', target: 'node_3', sourceHandle: 'subagent', targetHandle: 'input' };
const flushSave = () => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10);

beforeEach(() => {
  localStorage.clear();
  destroyedDropdowns.length = 0;
  document.body.innerHTML = bodyHtml;
  fetchRoute = (url) => {
    if (url === '/api/config') return json({});
    if (url === '/api/default-workflow') return json({ error: 'No default workflow found' }, 404);
    return json({ error: `unexpected request to ${url}` }, 500);
  };
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => Promise.resolve(fetchRoute(url, init))));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WorkflowEditor start-up', () => {
  it('starts with a single Start node and a disabled Run button that explains why', async () => {
    const editor = await createEditor();
    expect(editor.store.nodes.map((node) => node.type)).toEqual(['start']);
    expect(document.querySelectorAll('.node')).toHaveLength(1);

    const runButton = document.getElementById('btn-run') as HTMLButtonElement;
    expect(runButton.disabled).toBe(true);
    expect(runButton.getAttribute('data-disabled-hint')).toBe('Connect Start to another node before running.');
    const describedBy = runButton.getAttribute('aria-describedby') as string;
    expect(document.getElementById(describedBy)?.textContent).toBe('Connect Start to another node before running.');
    expect((document.getElementById('btn-cancel-run') as HTMLElement).style.display).toBe('none');
  });

  it('restores a saved workflow, its prompt, and enables Run', async () => {
    const editor = await createEditor(savedGraph());
    expect(document.querySelectorAll('.node')).toHaveLength(3);
    expect(lines()).toHaveLength(1);
    expect((document.getElementById('initial-prompt') as HTMLTextAreaElement).value).toBe('Saved prompt');
    expect((document.getElementById('btn-run') as HTMLButtonElement).disabled).toBe(false);
    expect(editor.store.nextNodeId).toBe(4);
  });

  it('loads the server default workflow when nothing is saved, upgrading legacy shapes', async () => {
    fetchRoute = (url) => {
      if (url === '/api/default-workflow') {
        return json({
          nodes: [
            { id: 'node_1', type: 'start', x: 0, y: 0, data: {} },
            { id: 'node_2', type: 'if', x: 0, y: 0, data: { condition: 'yes' } },
            { id: 'node_3', type: 'input', x: 0, y: 0, data: {} }
          ],
          connections: [
            { source: 'node_1', target: 'node_2', sourceHandle: 'output', targetHandle: 'input' },
            { source: 'node_2', target: 'node_3', sourceHandle: 'true', targetHandle: 'input' }
          ]
        });
      }
      return json({});
    };
    const editor = await createEditor();
    expect(editor.store.nodes.map((node) => node.type)).toEqual(['start', 'if', 'approval']);
    expect(editor.store.nodes[1].data?.conditions).toEqual([{ operator: 'contains', value: 'yes' }]);
    expect(connectionsOf(editor)[1].sourceHandle).toBe('condition-0');
  });

  it('escapes an unknown node type instead of injecting it as HTML', async () => {
    const graph = savedGraph();
    graph.nodes.push({ id: 'node_9', type: '<img src=x onerror=alert(1)>', x: 0, y: 0, data: {} });
    await createEditor(graph);
    const header = nodeEl('node_9').querySelector('.node-header') as HTMLElement;
    expect(header.querySelector('img')).toBeNull();
    expect(header.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('WorkflowEditor nodes', () => {
  it('adds a node from the palette with the keyboard and focuses it', async () => {
    const editor = await createEditor();
    const paletteItem = document.querySelector<HTMLElement>('.draggable-node[data-type="agent"]') as HTMLElement;
    expect(paletteItem.tabIndex).toBe(0);

    key(paletteItem, { key: 'Enter' });

    expect(editor.store.nodes.map((node) => node.type)).toEqual(['start', 'agent']);
    const added = editor.store.nodes[1];
    expect(editor.store.selectedNodeId).toBe(added.id);
    expect(document.activeElement).toBe(nodeEl(added.id));
    expect(nodeEl(added.id).classList.contains('selected')).toBe(true);
  });

  it('toggles settings with a real button that reports its state', async () => {
    const editor = await createEditor(savedGraph());
    const collapse = nodeEl('node_2').querySelector<HTMLButtonElement>('.icon-btn.collapse') as HTMLButtonElement;
    expect(collapse.getAttribute('aria-expanded')).toBe('false');
    expect(collapse.getAttribute('aria-label')).toBe('Open settings');

    collapse.click();

    expect(editor.store.nodes[1].data?.collapsed).toBe(false);
    expect(nodeEl('node_2').classList.contains('expanded')).toBe(true);
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(collapse.getAttribute('aria-label')).toBe('Close settings');

    key(nodeEl('node_2'), { key: 'Enter' });
    expect(editor.store.nodes[1].data?.collapsed).toBe(true);
  });

  it('associates form labels with their fields', async () => {
    await createEditor(savedGraph());
    const form = nodeEl('node_2').querySelector('.node-form') as HTMLElement;
    const nameLabel = Array.from(form.querySelectorAll('label')).find((label) => label.textContent === 'Agent Name');
    expect(nameLabel?.htmlFor).toBe('node_2-agent-name');
    expect(document.getElementById('node_2-agent-name')).toBeInstanceOf(HTMLInputElement);
    const modelGroup = form.querySelector('[aria-labelledby="node_2-model-label"]');
    expect(modelGroup).not.toBeNull();
    expect(document.getElementById('node_2-model-label')?.textContent).toBe('Model');
  });

  it('deletes the selected node with the Delete key, keeps Start, and clears the selection', async () => {
    const editor = await createEditor(savedGraph());
    nodeEl('node_3').focus();
    expect(editor.store.selectedNodeId).toBe('node_3');

    key(nodeEl('node_3'), { key: 'Delete' });
    await vi.waitFor(() => expect(editor.store.nodes).toHaveLength(2));
    expect(editor.store.selectedNodeId).toBeNull();

    nodeEl('node_1').focus();
    key(nodeEl('node_1'), { key: 'Delete' });
    await Promise.resolve();
    expect(editor.store.nodes.some((node) => node.type === 'start')).toBe(true);
  });

  it('does not delete a node while typing in one of its fields', async () => {
    const editor = await createEditor(savedGraph());
    nodeEl('node_2').focus();
    const nameInput = document.getElementById('node_2-agent-name') as HTMLInputElement;
    key(nameInput, { key: 'Backspace' });
    await Promise.resolve();
    expect(editor.store.nodes).toHaveLength(3);
    expect(dsLoader.openConfirmModal).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete Node' }));
  });

  it('keeps the selection highlight across a full re-render', async () => {
    const editor = await createEditor(savedGraph());
    editor.selectNode('node_2');
    editor.render();
    expect(nodeEl('node_2').classList.contains('selected')).toBe(true);
  });

  it('moves the focused node with the arrow keys', async () => {
    const editor = await createEditor(savedGraph());
    nodeEl('node_3').focus();
    key(nodeEl('node_3'), { key: 'ArrowRight' });
    key(nodeEl('node_3'), { key: 'ArrowDown' });
    expect(editor.store.nodes[2]).toMatchObject({ x: 310, y: 310 });
    expect(nodeEl('node_3').style.left).toBe('310px');
  });
});

describe('WorkflowEditor connections', () => {
  it('creates a connection from the keyboard', async () => {
    const editor = await createEditor(savedGraph());
    const output = port('node_2', 'output');
    expect(output.tabIndex).toBe(0);

    key(output, { key: 'Enter' });
    key(port('node_3', 'input'), { key: 'Enter' });

    expect(connectionsOf(editor)).toContainEqual({
      source: 'node_2', target: 'node_3', sourceHandle: 'output', targetHandle: 'input'
    });
    expect(lines()).toHaveLength(2);
  });

  it('cancels a pending connection with Escape', async () => {
    const editor = await createEditor(savedGraph());
    key(port('node_2', 'output'), { key: 'Enter' });
    key(document.body, { key: 'Escape' });
    key(port('node_3', 'input'), { key: 'Enter' });
    expect(connectionsOf(editor)).toHaveLength(1);
  });

  it('selects a line on click and deletes it with the Delete key', async () => {
    const editor = await createEditor(savedGraph());
    const line = lines()[0];
    expect(line.getAttribute('tabindex')).toBe('0');
    expect(line.getAttribute('aria-label')).toContain('Connection from Start node to Agent node: Parent');

    mouse(line, 'mousedown', { clientX: 10, clientY: 10 });
    mouse(document, 'mouseup', { clientX: 10, clientY: 10 });

    expect(connectionsOf(editor)).toHaveLength(1);
    expect(editor.store.selectedConnection).toEqual(connectionsOf(editor)[0]);
    expect(lines()[0].classList.contains('selected')).toBe(true);

    key(document.body, { key: 'Delete' });
    expect(connectionsOf(editor)).toHaveLength(0);
    expect(lines()).toHaveLength(0);
  });

  it('puts a re-dragged line back when it is dropped on a connector that cannot take it', async () => {
    const editor = await createEditor(savedGraph());
    const original = { ...connectionsOf(editor)[0] };

    mouse(lines()[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(document, 'mousemove', { clientX: 60, clientY: 60 });
    expect(connectionsOf(editor)).toHaveLength(0); // out of the list while dragged
    // A regular line dropped on the green subagent connector is invalid.
    mouse(port('node_3', 'subagent-target'), 'mouseup');

    expect(connectionsOf(editor)).toEqual([original]);
    expect(lines()).toHaveLength(1);
    expect(document.querySelector('.connection-line.reconnecting')).toBeNull();
  });

  it('puts a re-dragged line back on Escape and when released over an output connector', async () => {
    const editor = await createEditor(savedGraph());
    const original = { ...connectionsOf(editor)[0] };

    mouse(lines()[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(document, 'mousemove', { clientX: 60, clientY: 60 });
    key(document.body, { key: 'Escape' });
    expect(connectionsOf(editor)).toEqual([original]);

    mouse(lines()[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(document, 'mousemove', { clientX: 60, clientY: 60 });
    mouse(port('node_3', 'output'), 'mouseup');
    expect(connectionsOf(editor)).toEqual([original]);
    expect(document.querySelector('.connection-line.reconnecting')).toBeNull();
  });

  it('moves a re-dragged line to a valid new target', async () => {
    const editor = await createEditor(savedGraph());
    mouse(lines()[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(document, 'mousemove', { clientX: 60, clientY: 60 });
    mouse(port('node_3', 'input'), 'mouseup');
    expect(connectionsOf(editor)).toEqual([
      { source: 'node_1', target: 'node_3', sourceHandle: 'output', targetHandle: 'input' }
    ]);
  });

  it('removes a re-dragged line dropped on empty canvas, and undo brings it back', async () => {
    const editor = await createEditor(savedGraph());
    const original = { ...connectionsOf(editor)[0] };
    mouse(lines()[0], 'mousedown', { clientX: 10, clientY: 10 });
    mouse(document, 'mousemove', { clientX: 60, clientY: 60 });
    mouse(document.getElementById('canvas-container') as HTMLElement, 'mouseup');
    expect(connectionsOf(editor)).toHaveLength(0);

    key(document.body, { key: 'z', ctrlKey: true });
    expect(connectionsOf(editor)).toEqual([original]);
  });
});

describe('WorkflowEditor subagents', () => {
  it('locks the Input field of a subagent target without losing the saved prompt', async () => {
    const editor = await createEditor(savedGraph());
    const helper = editor.store.nodes[2];
    expect(document.getElementById('node_3-user-prompt')).not.toBeNull();

    connectionsOf(editor).push({ ...subagentLink });
    editor.renderConnections();

    expect(document.getElementById('node_3-user-prompt')).toBeNull();
    expect(nodeEl('node_3').querySelector('.subagent-input-lock-note')).not.toBeNull();
    expect(nodeEl('node_3').classList.contains('subagent-target-node')).toBe(true);
    expect(helper.data?.userPrompt).toBe('Summarise: {{PREVIOUS_OUTPUT}}');

    editor.store.connections = connectionsOf(editor).filter((connection) => connection.sourceHandle !== 'subagent');
    editor.renderConnections();

    const restored = document.getElementById('node_3-user-prompt') as HTMLTextAreaElement;
    expect(restored.value).toBe('Summarise: {{PREVIOUS_OUTPUT}}');
    expect(nodeEl('node_3').querySelector('.subagent-input-lock-note')).toBeNull();
  });

  it('removes subagent links when the Subagents tool is turned off', async () => {
    const editor = await createEditor(savedGraph());
    connectionsOf(editor).push({ ...subagentLink });
    editor.renderConnections();

    const checkboxes = nodeEl('node_2').querySelectorAll<HTMLInputElement>('.tools-checkbox-group input[type="checkbox"]');
    const subagentsCheckbox = checkboxes[1];
    expect(subagentsCheckbox.checked).toBe(true);
    subagentsCheckbox.checked = false;
    subagentsCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

    expect(connectionsOf(editor).some((connection) => connection.sourceHandle === 'subagent')).toBe(false);
    expect(port('node_2', 'subagent')).toBeNull();
  });
});

describe('WorkflowEditor forms', () => {
  it('does not rebuild node forms while a node is dragged', async () => {
    const editor = await createEditor(savedGraph());
    const nameInput = document.getElementById('node_2-agent-name');
    const header = nodeEl('node_2').querySelector('.node-header') as HTMLElement;

    mouse(header, 'mousedown', { clientX: 0, clientY: 0 });
    for (let i = 1; i <= 5; i += 1) mouse(document, 'mousemove', { clientX: i * 10, clientY: i * 5 });
    mouse(document, 'mouseup');

    expect(editor.store.nodes[1]).toMatchObject({ x: 350, y: 125 });
    expect(document.getElementById('node_2-agent-name')).toBe(nameInput);
    expect(destroyedDropdowns).toHaveLength(0);
  });

  it('destroys dropdowns when a form is rebuilt, and rebuilds only the edited Condition node', async () => {
    const graph = savedGraph();
    graph.nodes.push({ id: 'node_4', type: 'if', x: 500, y: 100, data: { conditions: [{ operator: 'equal', value: 'a' }] } });
    graph.connections.push({ source: 'node_4', target: 'node_3', sourceHandle: 'condition-0', targetHandle: 'input' });
    const editor = await createEditor(graph);
    await vi.waitFor(() => expect(nodeEl('node_4').querySelectorAll('[data-fake-dropdown]')).toHaveLength(1));
    const agentNameInput = document.getElementById('node_2-agent-name');

    (nodeEl('node_4').querySelector('.add-condition-btn') as HTMLButtonElement).click();

    expect(editor.store.nodes[3].data?.conditions).toHaveLength(2);
    expect(nodeEl('node_4').querySelectorAll('.condition-row')).toHaveLength(2);
    expect(destroyedDropdowns).toHaveLength(1);
    expect(document.getElementById('node_2-agent-name')).toBe(agentNameInput);

    // Removing the first condition re-indexes the connection of the second.
    editor.store.connections.push({ source: 'node_4', target: 'node_2', sourceHandle: 'condition-1', targetHandle: 'input' });
    (nodeEl('node_4').querySelector('.condition-remove-btn') as HTMLButtonElement).click();
    expect(editor.store.nodes[3].data?.conditions).toHaveLength(1);
    expect(connectionsOf(editor).filter((connection) => connection.source === 'node_4')).toEqual([
      { source: 'node_4', target: 'node_2', sourceHandle: 'condition-0', targetHandle: 'input' }
    ]);
  });
});

describe('WorkflowEditor undo and redo', () => {
  it('undoes and redoes adding a node', async () => {
    const editor = await createEditor(savedGraph());
    editor.addNode('approval', 10, 10);
    expect(editor.store.nodes).toHaveLength(4);

    key(document.body, { key: 'z', metaKey: true });
    expect(editor.store.nodes).toHaveLength(3);
    expect(document.querySelectorAll('.node')).toHaveLength(3);

    key(document.body, { key: 'z', metaKey: true, shiftKey: true });
    expect(editor.store.nodes).toHaveLength(4);

    key(document.body, { key: 'z', ctrlKey: true });
    key(document.body, { key: 'y', ctrlKey: true });
    expect(editor.store.nodes).toHaveLength(4);
  });

  it('undoes a deletion together with the node\'s connections', async () => {
    const editor = await createEditor(savedGraph());
    editor.deleteNode('node_2');
    expect(connectionsOf(editor)).toHaveLength(0);

    key(document.body, { key: 'z', ctrlKey: true });
    expect(editor.store.nodes.map((node) => node.id)).toEqual(['node_1', 'node_2', 'node_3']);
    expect(connectionsOf(editor)).toHaveLength(1);
    expect(lines()).toHaveLength(1);
  });

  it('coalesces typing into one step and leaves native undo to text fields', async () => {
    vi.useFakeTimers();
    const editor = await createEditor(savedGraph());
    const nameInput = document.getElementById('node_2-agent-name') as HTMLInputElement;
    for (const value of ['R', 'Re', 'Res', 'Researcher']) {
      nameInput.value = value;
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await flushSave();
    expect(editor.store.nodes[1].data?.agentName).toBe('Researcher');

    // Ctrl+Z inside the field is the browser's own text undo, not ours.
    key(nameInput, { key: 'z', ctrlKey: true });
    expect(editor.store.nodes[1].data?.agentName).toBe('Researcher');

    key(document.body, { key: 'z', ctrlKey: true });
    expect(editor.store.nodes[1].data?.agentName).toBe('Parent');
    expect((document.getElementById('node_2-agent-name') as HTMLInputElement).value).toBe('Parent');
  });

  it('undoes a node move as one step and keeps settings panels as they are', async () => {
    const editor = await createEditor(savedGraph());
    editor.toggleNodeCollapsed(editor.store.nodes[1]);
    const header = nodeEl('node_2').querySelector('.node-header') as HTMLElement;
    mouse(header, 'mousedown', { clientX: 0, clientY: 0 });
    mouse(document, 'mousemove', { clientX: 30, clientY: 0 });
    mouse(document, 'mousemove', { clientX: 80, clientY: 0 });
    mouse(document, 'mouseup');
    expect(editor.store.nodes[1].x).toBe(380);

    key(document.body, { key: 'z', ctrlKey: true });
    expect(editor.store.nodes[1].x).toBe(300);
    expect(editor.store.nodes[1].data?.collapsed).toBe(false);
    expect(nodeEl('node_2').classList.contains('expanded')).toBe(true);
  });

  it('reports when there is nothing to undo', async () => {
    await createEditor(savedGraph());
    key(document.body, { key: 'z', ctrlKey: true });
    expect(document.getElementById('canvas-validation-message')?.textContent).toBe('Nothing to undo.');
  });
});

describe('WorkflowEditor run controls', () => {
  const sse = (events: unknown[]) => new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );
  const pausedRun = {
    runId: 'run-1',
    status: 'paused',
    logs: [],
    state: {},
    waitingForInput: true,
    currentNodeId: 'node_3'
  };
  const approvalGraph = (): WorkflowGraphPayload => ({
    nodes: [
      { id: 'node_1', type: 'start', x: 0, y: 0, data: {} },
      { id: 'node_3', type: 'approval', x: 200, y: 0, data: { prompt: 'Proceed?' } },
      { id: 'node_2', type: 'agent', x: 400, y: 0, data: agentData() }
    ],
    connections: [
      { source: 'node_1', target: 'node_3', sourceHandle: 'output', targetHandle: 'input' },
      { source: 'node_3', target: 'node_2', sourceHandle: 'approve', targetHandle: 'input' }
    ]
  });

  it('lets a paused run be cancelled, and blocks Run, Clear and undo meanwhile', async () => {
    const requests: string[] = [];
    fetchRoute = (url) => {
      requests.push(url);
      if (url === '/api/run-stream') return sse([{ type: 'start', runId: 'run-1' }, { type: 'done', result: pausedRun }]);
      if (url === '/api/cancel') return json({ ...pausedRun, status: 'cancelled', waitingForInput: false });
      if (url === '/api/default-workflow') return json({}, 404);
      return json({});
    };
    const editor = await createEditor(approvalGraph());
    const runButton = document.getElementById('btn-run') as HTMLButtonElement;
    const cancelButton = document.getElementById('btn-cancel-run') as HTMLButtonElement;
    const clearButton = document.getElementById('btn-clear') as HTMLButtonElement;
    const chat = document.getElementById('chat-messages') as HTMLElement;
    (document.getElementById('initial-prompt') as HTMLTextAreaElement).value = 'Go';

    runButton.click();
    await vi.waitFor(() => expect(chat.querySelector('.approve-btn')).not.toBeNull());

    expect(runButton.disabled).toBe(true);
    expect(runButton.textContent).toBe('Paused');
    expect(clearButton.disabled).toBe(true);
    expect(cancelButton.style.display).toBe('inline-flex');
    expect(cancelButton.disabled).toBe(false);

    editor.addNode('agent', 0, 0);
    key(document.body, { key: 'z', ctrlKey: true });
    expect(editor.store.nodes).toHaveLength(4);
    expect(document.getElementById('canvas-validation-message')?.textContent).toContain('unavailable while a workflow is running or paused');

    cancelButton.click();
    await vi.waitFor(() => expect(cancelButton.style.display).toBe('none'));

    expect(requests).toContain('/api/cancel');
    expect(chat.querySelector('.approve-btn')).toBeNull();
    expect(chat.textContent).toContain('Cancelled');
    expect(runButton.disabled).toBe(false);
    expect(clearButton.disabled).toBe(false);
  });

  it('clears the canvas back to one Start node and can undo it', async () => {
    const editor = await createEditor(savedGraph());
    (document.getElementById('btn-clear') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(editor.store.nodes).toHaveLength(1));

    expect(editor.store.nodes[0]).toMatchObject({ id: 'node_1', type: 'start' });
    expect(editor.store.nextNodeId).toBe(2);
    expect(connectionsOf(editor)).toHaveLength(0);
    expect(document.getElementById('chat-messages')?.textContent).toContain('Canvas cleared');

    key(document.body, { key: 'z', ctrlKey: true });
    expect(editor.store.nodes).toHaveLength(3);
  });

  it('exposes the run console as a live log', () => {
    const chat = document.getElementById('chat-messages') as HTMLElement;
    expect(chat.getAttribute('role')).toBe('log');
    expect(chat.getAttribute('aria-live')).toBe('polite');
  });
});
