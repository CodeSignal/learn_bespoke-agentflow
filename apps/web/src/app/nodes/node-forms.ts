import { buildModelPickerItems, flattenGroupedItems } from '../model-catalog';
import {
    DEFAULT_IF_CONDITION,
    IF_CONDITION_OPERATORS,
    PREVIOUS_OUTPUT_TEMPLATE,
    TOOLS_CONFIG
} from '../constants';
import { dropdownSupportsGroups, getDropdownCtor } from '../ds-loader';
import type { DropdownInstance, DropdownItem } from '../ds-loader';
import type { EditorHost } from '../editor-host';
import { getIfConditions, normalizeIfCondition, removeIfCondition } from '../graph/if-conditions';
import { isSubagentConnection, isSubagentTargetNode } from '../graph/validation';
import { escapeHtml } from '../markdown';
import type { EditorNode } from '../types';
import type { NodeView } from './node-view';

type FormRecord = {
    dropdowns: DropdownInstance[];
};

export function getUserPromptHighlightHTML(value: string): string {
    const escapedValue = escapeHtml(value || '');
    return escapedValue.replace(
        /\{\{PREVIOUS_OUTPUT\}\}/g,
        '<span class="prompt-highlight-token">{{PREVIOUS_OUTPUT}}</span>',
    );
}

/** Builds the settings form inside an expanded node. */
export class NodeForms {
    /** Set by the editor right after construction (the view and the forms reference each other). */
    view!: NodeView;

    private readonly records = new WeakMap<HTMLElement, FormRecord>();

    constructor(private readonly host: EditorHost) {}

    /** Whether the form in `container` was rendered with the subagent input lock. */
    isRenderedAsSubagentTarget(container: HTMLElement): boolean {
        return container.dataset.subagentLocked === 'true';
    }

    /** Destroys the design-system dropdowns of a form before it is discarded. */
    teardown(container: HTMLElement): void {
        const record = this.records.get(container);
        if (record) {
            record.dropdowns.forEach((dropdown) => dropdown.destroy?.());
            this.records.delete(container);
        }
        container.innerHTML = '';
    }

    private async setupDropdown(
        form: HTMLElement,
        container: HTMLElement,
        items: DropdownItem[],
        selectedValue: string,
        placeholder: string,
        onSelect: (value: string) => void
    ): Promise<void> {
        const record = this.records.get(form);
        try {
            const DropdownCtor = await getDropdownCtor();
            // The form may have been rebuilt or discarded while the component loaded.
            if (!record || this.records.get(form) !== record) return;
            const hasGroups = items.some((item) => item.group);
            record.dropdowns.push(new DropdownCtor(container, {
                placeholder,
                items: hasGroups && !dropdownSupportsGroups(DropdownCtor) ? flattenGroupedItems(items) : items,
                selectedValue,
                width: '100%',
                onSelect
            }));
            this.host.scheduleConnectionLayoutSync();
        } catch (error) {
            console.warn('Failed to initialize DS dropdown', error);
        }
    }

    renderNodeForm(node: EditorNode, container: HTMLElement): void {
        this.teardown(container);
        this.records.set(container, { dropdowns: [] });
        if (!node.data) node.data = {};
        const data = node.data;
        const { host, view } = this;
        const fieldId = (name: string) => `${node.id}-${name}`;

        const buildLabel = (text: string, forId?: string) => {
            const label = document.createElement('label');
            label.textContent = text;
            if (forId) label.htmlFor = forId;
            return label;
        };

        /** A label for a design-system dropdown, which is not a native form control. */
        const buildGroupLabel = (text: string, group: HTMLElement, name: string) => {
            const label = buildLabel(text);
            label.id = fieldId(`${name}-label`);
            group.setAttribute('role', 'group');
            group.setAttribute('aria-labelledby', label.id);
            return label;
        };

        const isSubagentTarget = node.type === 'agent' && isSubagentTargetNode(node.id, host.store.connections);
        container.dataset.subagentLocked = String(isSubagentTarget);

        if (node.type === 'agent') {
            // Agent Name
            container.appendChild(buildLabel('Agent Name', fieldId('agent-name')));
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'input';
            nameInput.id = fieldId('agent-name');
            nameInput.value = data.agentName || 'Agent';
            nameInput.placeholder = 'e.g., Research Agent';
            nameInput.addEventListener('input', () => {
                data.agentName = nameInput.value;
                view.updatePreview(node);
                view.updateNodeHeader(node);
            });
            container.appendChild(nameInput);

            // System Prompt
            container.appendChild(buildLabel('System Prompt', fieldId('system-prompt')));
            const sysInput = document.createElement('textarea');
            sysInput.className = 'input textarea-input';
            sysInput.id = fieldId('system-prompt');
            sysInput.placeholder = 'Define the agent\'s role, persona, or instructions.';
            sysInput.value = data.systemPrompt || '';
            sysInput.addEventListener('input', () => {
                data.systemPrompt = sysInput.value;
                view.updatePreview(node);
            });
            container.appendChild(sysInput);

            // Input
            if (isSubagentTarget) {
                // The parent agent writes a subagent's input, so the field is hidden
                // while linked. The saved prompt is kept and comes back when unlinked.
                container.appendChild(buildLabel('Input'));
                const helperText = document.createElement('div');
                helperText.className = 'subagent-input-lock-note';
                helperText.textContent = 'Input managed by parent agent.';
                container.appendChild(helperText);
            } else {
                container.appendChild(buildLabel('Input', fieldId('user-prompt')));
                const userInputWrapper = document.createElement('div');
                userInputWrapper.className = 'prompt-highlight-wrapper';
                const userInputHighlight = document.createElement('div');
                userInputHighlight.className = 'prompt-highlight-backdrop';
                userInputHighlight.setAttribute('aria-hidden', 'true');
                const userInputHighlightContent = document.createElement('div');
                userInputHighlightContent.className = 'prompt-highlight-content';
                userInputHighlight.appendChild(userInputHighlightContent);
                const userInput = document.createElement('textarea');
                userInput.className = 'input textarea-input prompt-highlight-input';
                userInput.id = fieldId('user-prompt');
                userInput.placeholder = 'Use {{PREVIOUS_OUTPUT}} to include the previous node\'s output.';
                userInput.value = data.userPrompt ?? PREVIOUS_OUTPUT_TEMPLATE;
                const syncUserPromptHighlight = () => {
                    userInputHighlightContent.innerHTML = getUserPromptHighlightHTML(userInput.value);
                    userInputHighlightContent.style.transform = `translate(${-userInput.scrollLeft}px, ${-userInput.scrollTop}px)`;
                };
                syncUserPromptHighlight();
                userInput.addEventListener('focus', () => {
                    userInputWrapper.classList.add('is-editing');
                });
                userInput.addEventListener('blur', () => {
                    userInputWrapper.classList.remove('is-editing');
                    syncUserPromptHighlight();
                });
                userInput.addEventListener('input', () => {
                    data.userPrompt = userInput.value;
                    syncUserPromptHighlight();
                    host.scheduleSave();
                });
                userInput.addEventListener('scroll', syncUserPromptHighlight);
                userInputWrapper.appendChild(userInputHighlight);
                userInputWrapper.appendChild(userInput);
                container.appendChild(userInputWrapper);
            }

            // Model
            const { modelOptions, modelEfforts, modelLabels, modelProviders, modelDefaultEfforts, defaultModel } = host.store;
            const currentModel = data.model || defaultModel || modelOptions[0];
            const modelDropdown = document.createElement('div');
            modelDropdown.className = 'ds-dropdown';
            container.appendChild(buildGroupLabel('Model', modelDropdown, 'model'));
            container.appendChild(modelDropdown);
            void this.setupDropdown(
                container,
                modelDropdown,
                buildModelPickerItems(modelOptions, modelLabels, modelProviders),
                currentModel,
                'Select model',
                (value) => {
                    data.model = value;
                    view.updatePreview(node);
                    host.commitHistory();
                    // The reasoning-effort options depend on the model, so rebuild
                    // this node's form only (after the dropdown finishes its own handling).
                    queueMicrotask(() => host.rerenderNodeForm(node));
                }
            );

            // Reasoning Effort
            const effortDropdown = document.createElement('div');
            effortDropdown.className = 'ds-dropdown';
            container.appendChild(buildGroupLabel('Reasoning Effort', effortDropdown, 'effort'));
            container.appendChild(effortDropdown);
            const effortSource = modelEfforts[currentModel] ?? [];
            const effortOptions: DropdownItem[] = effortSource.map((optValue: string) => ({
                value: optValue,
                label: optValue.charAt(0).toUpperCase() + optValue.slice(1)
            }));
            const selectedEffort =
                effortOptions.find((o) => o.value === data.reasoningEffort)?.value
                ?? effortOptions.find((o) => o.value === modelDefaultEfforts[currentModel])?.value
                ?? effortOptions[0]?.value
                ?? '';
            if (selectedEffort) {
                data.reasoningEffort = selectedEffort;
                void this.setupDropdown(
                    container,
                    effortDropdown,
                    effortOptions,
                    selectedEffort,
                    'Select effort',
                    (value) => {
                        data.reasoningEffort = value;
                        host.scheduleSave();
                        host.commitHistory();
                    }
                );
            }

            // Tools
            const toolsList = document.createElement('div');
            toolsList.className = 'tools-checkbox-group';
            container.appendChild(buildGroupLabel('Tools', toolsList, 'tools'));

            TOOLS_CONFIG.forEach((tool) => {
                const label = document.createElement('label');
                label.className = 'input-checkbox input-checkbox-small';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = Boolean(data.tools?.[tool.key]);
                checkbox.addEventListener('change', () => {
                    if (!data.tools) data.tools = {};
                    data.tools[tool.key] = checkbox.checked;
                    view.updatePreview(node);
                    if (tool.key === 'subagents') {
                        if (!checkbox.checked) {
                            host.store.connections = host.store.connections.filter(
                                (connection) => !(connection.source === node.id && isSubagentConnection(connection))
                            );
                        }
                        host.refreshNodePorts(node);
                        host.renderConnections();
                        host.updateRunButton();
                    }
                    host.commitHistory();
                });

                const box = document.createElement('span');
                box.className = 'input-checkbox-box';
                const checkmark = document.createElement('span');
                checkmark.className = 'input-checkbox-checkmark';
                box.appendChild(checkmark);

                label.appendChild(checkbox);
                label.appendChild(box);

                if (tool.iconClass) {
                    const icon = document.createElement('span');
                    icon.className = `icon ${tool.iconClass} icon-small`;
                    icon.setAttribute('aria-hidden', 'true');
                    label.appendChild(icon);
                }

                const labelText = document.createElement('span');
                labelText.className = 'input-checkbox-label';
                labelText.textContent = tool.label;
                label.appendChild(labelText);

                toolsList.appendChild(label);
            });

            container.appendChild(toolsList);

        } else if (node.type === 'if') {
            const conditions = getIfConditions(node);
            const conditionsList = document.createElement('div');
            conditionsList.className = 'condition-list';
            container.appendChild(buildGroupLabel('Conditions', conditionsList, 'conditions'));

            /** Rebuilds only this node after its condition rows changed. */
            const refreshAfterConditionChange = () => {
                view.updatePreview(node);
                host.rerenderNodeForm(node);
                host.refreshNodePorts(node);
                host.renderConnections();
                host.updateRunButton();
                host.commitHistory();
            };

            conditions.forEach((condition, index) => {
                const row = document.createElement('div');
                row.className = 'condition-row';

                const operatorDropdown = document.createElement('div');
                operatorDropdown.className = 'ds-dropdown';
                operatorDropdown.setAttribute('role', 'group');
                operatorDropdown.setAttribute('aria-label', `Condition ${index + 1} operator`);
                row.appendChild(operatorDropdown);
                void this.setupDropdown(
                    container,
                    operatorDropdown,
                    IF_CONDITION_OPERATORS,
                    condition.operator,
                    'Select operator',
                    (value) => {
                        conditions[index].operator = value === 'contains' ? 'contains' : 'equal';
                        data.conditions = conditions.map((entry) => normalizeIfCondition(entry));
                        view.updatePreview(node);
                        host.commitHistory();
                    }
                );

                const valueInput = document.createElement('input');
                valueInput.type = 'text';
                valueInput.className = 'input';
                valueInput.placeholder = 'Value';
                valueInput.setAttribute('aria-label', `Condition ${index + 1} value`);
                valueInput.value = condition.value || '';
                valueInput.addEventListener('input', () => {
                    conditions[index].value = valueInput.value;
                    data.conditions = conditions.map((entry) => normalizeIfCondition(entry));
                    view.updatePreview(node);
                });
                row.appendChild(valueInput);

                if (conditions.length > 1) {
                    const removeConditionButton = document.createElement('button');
                    removeConditionButton.type = 'button';
                    removeConditionButton.className = 'button button-tertiary button-small icon-btn condition-remove-btn';
                    removeConditionButton.title = `Remove condition ${index + 1}`;
                    removeConditionButton.setAttribute('aria-label', `Remove condition ${index + 1}`);
                    removeConditionButton.innerHTML = '<span class="icon icon-trash icon-danger" aria-hidden="true"></span>';
                    removeConditionButton.addEventListener('click', (e) => {
                        e.preventDefault();
                        host.store.connections = removeIfCondition(node, index, host.store.connections);
                        refreshAfterConditionChange();
                    });
                    row.appendChild(removeConditionButton);
                }

                conditionsList.appendChild(row);
            });

            container.appendChild(conditionsList);

            const addConditionButton = document.createElement('button');
            addConditionButton.type = 'button';
            addConditionButton.className = 'button button-secondary button-small add-condition-btn';
            addConditionButton.textContent = '+ Add Condition';
            addConditionButton.addEventListener('click', (e) => {
                e.preventDefault();
                data.conditions = [...conditions, { ...DEFAULT_IF_CONDITION }];
                refreshAfterConditionChange();
            });
            container.appendChild(addConditionButton);

        } else if (node.type === 'approval') {
            container.appendChild(buildLabel('Approval Message', fieldId('approval-message')));
            const pInput = document.createElement('textarea');
            pInput.className = 'input textarea-input';
            pInput.id = fieldId('approval-message');
            pInput.rows = 4;
            pInput.value = data.prompt || '';
            pInput.placeholder = 'Message shown to user when approval is required';
            pInput.addEventListener('input', () => {
                data.prompt = pInput.value;
                view.updatePreview(node);
            });
            container.appendChild(pInput);

        } else {
            container.textContent = 'No configurable options for this node.';
        }
    }
}
