import type { IfCondition, ToolConfig } from './types';

export const EXPANDED_NODE_WIDTH = 420;
/** Fallback width when a node has not been mounted yet. */
export const DEFAULT_NODE_WIDTH = 150;
export const COLLAPSED_NODE_FALLBACK_HEIGHT = 96;
export const EXPANDED_NODE_FALLBACK_HEIGHT = 220;
export const EXPANDED_AGENT_FALLBACK_HEIGHT = 240;

export const TOOLS_CONFIG: ToolConfig[] = [
    { key: 'web_search', label: 'Web Search', iconClass: 'icon-globe' },
    { key: 'subagents', label: 'Subagents', iconClass: 'icon-engineering-manager' }
];

// Fallbacks for when `/api/config` cannot be loaded. The real model list
// comes from `.config/config.json` on the server.
export const DEFAULT_MODEL = 'gpt-6-luna';
export const DEFAULT_REASONING_EFFORT = 'low';
export const DEFAULT_MODEL_OPTIONS = ['gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna'];
export const DEFAULT_MODEL_EFFORTS: Record<string, string[]> = {
    'gpt-6.2-sol': ['low', 'medium', 'high', 'xhigh', 'max'],
    'gpt-6.1-terra': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    'gpt-6-luna': ['none', 'low', 'medium', 'high', 'xhigh', 'max']
};
export const DEFAULT_MODEL_LABELS: Record<string, string> = {
    'gpt-6.2-sol': 'GPT-6.2 Sol',
    'gpt-6.1-terra': 'GPT-6.1 Terra',
    'gpt-6-luna': 'GPT-6 Luna'
};

export const IF_CONDITION_HANDLE_PREFIX = 'condition-';
export const IF_FALLBACK_HANDLE = 'false';
/** Handle used by graphs saved before multi-condition nodes existed. */
export const LEGACY_IF_TRUE_HANDLE = 'true';
export const SUBAGENT_HANDLE = 'subagent';
export const SUBAGENT_TARGET_HANDLE = 'subagent-target';
export const INPUT_HANDLE = 'input';
export const OUTPUT_HANDLE = 'output';
export const APPROVE_HANDLE = 'approve';
export const REJECT_HANDLE = 'reject';

export const IF_PORT_BASE_TOP = 45;
export const IF_PORT_STEP = 30;
export const SUBAGENT_PORT_MIN_TOP = 42;
export const DEFAULT_HEADER_CENTER_Y = 24;
export const DEFAULT_SECONDARY_CENTER_Y = 81;
export const PORT_RADIUS = 6;
export const AGGREGATE_PORT_RADIUS = 8;
export const SUBAGENT_CURVE_MIN_OFFSET = 40;
export const SUBAGENT_CURVE_RATIO = 0.35;

export const PREVIOUS_OUTPUT_TEMPLATE = '{{PREVIOUS_OUTPUT}}';
export const GENERIC_AGENT_SPINNER_KEY = '__generic_agent_spinner__';

export const IF_CONDITION_OPERATORS = [
    { value: 'equal', label: 'Equal' },
    { value: 'contains', label: 'Contains' }
];
export const DEFAULT_IF_CONDITION: IfCondition = { operator: 'equal', value: '' };
export const DEFAULT_APPROVAL_PROMPT = 'Review and approve this step.';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
export const ZOOM_BUTTON_STEP_PERCENT = 10;
/** Scale change per wheel pixel when zooming with Ctrl/Cmd + wheel or a pinch. */
export const WHEEL_ZOOM_SENSITIVITY = 0.0015;

export const CANVAS_MESSAGE_TIMEOUT_MS = 4500;
export const SAVE_DEBOUNCE_MS = 500;
export const RUN_POLL_INTERVAL_MS = 2000;
export const HISTORY_LIMIT = 100;
/** Pointer travel (px) before a press on a connection becomes a reconnect drag. */
export const CONNECTION_DRAG_THRESHOLD_PX = 4;
export const KEYBOARD_NODE_NUDGE_PX = 10;
/** Distance from the bottom (px) within which the chat keeps auto-scrolling. */
export const CHAT_PINNED_THRESHOLD_PX = 48;

export const START_NODE_FALLBACK_POSITION = { x: 370, y: 310 };
export const START_NODE_APPROX_SIZE = { width: 120, height: 60 };
export const DUPLICATE_NODE_SPACING = 24;
export const DUPLICATE_NODE_MIN_WORLD_Y = 16;
export const KEYBOARD_ADD_NODE_STAGGER_PX = 24;

export const DEFAULT_RIGHT_PANEL_WIDTH = 320;
export const SPLIT_PANEL_MIN_LEFT = 40;
export const SPLIT_PANEL_MAX_LEFT = 80;
export const SPLIT_PANEL_MIN_RIGHT = 20;

export const WORKFLOW_STORAGE_KEY = 'agentflow-workflow';
export const RUN_ID_STORAGE_KEY = 'agentflow-run-id';
