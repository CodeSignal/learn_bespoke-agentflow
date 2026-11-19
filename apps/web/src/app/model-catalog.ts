import type { AppConfig } from '../services/api';
import type { EditorNode } from './types';

export interface ModelCatalog {
    /** Model ids offered in the picker. */
    options: string[];
    efforts: Record<string, string[]>;
    labels: Record<string, string>;
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
        defaultEfforts: {},
        defaultModel: '',
        aliases: config.modelAliases ?? {}
    };
    for (const provider of providers) {
        for (const model of provider.models) {
            catalog.options.push(model.id);
            catalog.efforts[model.id] = model.reasoningEfforts ?? [];
            catalog.labels[model.id] = model.name || model.id;
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
