import type { AppConfig } from '../services/api';
import type { EditorNode } from './types';

export interface ModelCatalog {
    /** Model ids offered in the picker. */
    options: string[];
    efforts: Record<string, string[]>;
    labels: Record<string, string>;
    /** Provider display name by model id. */
    providers: Record<string, string>;
    defaultEfforts: Record<string, string>;
    defaultModel: string;
    aliases: Record<string, string>;
}

/**
 * Turns the server's provider configuration into what the model picker needs.
 * Returns null when the configuration lists no models, so callers keep their
 * built-in fallback.
 */
export function buildModelCatalog(config: AppConfig): ModelCatalog | null {
    const enabledProviders = (config.providers ?? []).filter((provider) => provider.enabled);
    // Offer only models that can run. If no provider has a key yet, list them
    // all so workflows can still be designed; Run reports the missing key.
    const usableProviders = enabledProviders.filter((provider) => provider.available !== false);
    const providers = usableProviders.length > 0 ? usableProviders : enabledProviders;

    const catalog: ModelCatalog = {
        options: [],
        efforts: {},
        labels: {},
        providers: {},
        defaultEfforts: {},
        defaultModel: '',
        aliases: config.modelAliases ?? {}
    };
    for (const provider of providers) {
        for (const model of provider.models) {
            catalog.options.push(model.id);
            catalog.efforts[model.id] = model.reasoningEfforts ?? [];
            catalog.labels[model.id] = model.name || model.id;
            catalog.providers[model.id] = provider.name || provider.id;
            if (model.defaultReasoningEffort) catalog.defaultEfforts[model.id] = model.defaultReasoningEffort;
        }
    }
    if (catalog.options.length === 0) return null;

    catalog.defaultModel =
        config.defaultModel && catalog.options.includes(config.defaultModel)
            ? config.defaultModel
            : catalog.options[0];
    return catalog;
}

export interface ModelPickerOption {
    value: string;
    label: string;
}

/** A provider heading with its models, in the design-system dropdown's group shape. */
export interface ModelPickerGroup {
    label: string;
    items: ModelPickerOption[];
}

export type ModelPickerEntry = ModelPickerOption | ModelPickerGroup;

export function isModelPickerGroup(entry: ModelPickerEntry): entry is ModelPickerGroup {
    return Array.isArray((entry as ModelPickerGroup).items);
}

/**
 * Entries for the model dropdown, in provider order. With more than one
 * provider, each provider becomes a group that the design-system dropdown
 * renders under a heading; with one provider the list stays flat.
 */
export function buildModelPickerItems(
    options: string[],
    labels: Record<string, string>,
    providers: Record<string, string>
): ModelPickerEntry[] {
    const toOption = (id: string): ModelPickerOption => ({ value: id, label: labels[id] ?? id });
    const providerNames = new Set(options.map((id) => providers[id]).filter(Boolean));
    if (providerNames.size <= 1) return options.map(toOption);

    const entries: ModelPickerEntry[] = [];
    let current: ModelPickerGroup | null = null;
    for (const id of options) {
        const provider = providers[id];
        if (!provider) {
            current = null;
            entries.push(toOption(id));
            continue;
        }
        if (!current || current.label !== provider) {
            current = { label: provider, items: [] };
            entries.push(current);
        }
        current.items.push(toOption(id));
    }
    return entries;
}

/**
 * For a design-system dropdown that cannot render groups: flattens them and
 * names the provider in each label instead ("OpenAI · GPT-6 Luna").
 */
export function flattenGroupedItems(entries: ModelPickerEntry[]): ModelPickerOption[] {
    return entries.flatMap((entry) =>
        isModelPickerGroup(entry)
            ? entry.items.map(({ value, label }) => ({ value, label: `${entry.label} · ${label}` }))
            : [entry]
    );
}

/**
 * Moves agent nodes saved with a retired model id to its configured
 * replacement, so older workflows keep running. Returns true if any node changed.
 */
export function applyModelAliases(
    nodes: EditorNode[],
    aliases: Record<string, string>,
    options: string[]
): boolean {
    let changed = false;
    for (const node of nodes) {
        const model = node.data?.model;
        if (node.type !== 'agent' || !node.data || !model) continue;
        const replacement = aliases[model];
        if (replacement && options.includes(replacement)) {
            node.data.model = replacement;
            changed = true;
        }
    }
    return changed;
}
