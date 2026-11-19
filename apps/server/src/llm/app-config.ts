import fs from 'node:fs';
import path from 'node:path';

export type ProviderType = 'openai' | 'anthropic';
export type OpenAiApi = 'responses' | 'chat_completions';

export interface ModelConfig {
  id: string;
  name: string;
  /** Effort values offered in the editor. Empty when the model has no effort setting. */
  reasoningEfforts: string[];
  /** Used when a node has no effort or one the model does not accept. */
  defaultReasoningEffort?: string;
  /** Output token cap per model call (Anthropic `max_tokens`). */
  maxOutputTokens?: number;
  /** Anthropic only: let the API re-run a declined request on a fallback model. */
  refusalFallback?: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  enabled: boolean;
  /** Name of the environment variable that holds the API key. Keys never live in the file. */
  apiKeyEnv: string;
  /** Optional API base URL, for a proxy or an OpenAI-compatible service. */
  baseUrl?: string;
  /** OpenAI-type providers only. `chat_completions` is for OpenAI-compatible services. */
  api: OpenAiApi;
  models: ModelConfig[];
}

export interface AppConfig {
  /** Model used by agent nodes that do not name one. Defaults to the first available model. */
  defaultModel?: string;
  /** Maps model ids found in older saved workflows to current ones. */
  modelAliases: Record<string, string>;
  providers: ProviderConfig[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULT_API_KEY_ENV: Record<ProviderType, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY'
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ConfigError(`${where} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, where);
}

function parseModel(raw: unknown, where: string): ModelConfig {
  if (!isObject(raw)) throw new ConfigError(`${where} must be an object.`);
  const id = requireString(raw.id, `${where}.id`);
  const efforts = raw.reasoningEfforts ?? [];
  if (!Array.isArray(efforts) || efforts.some((effort) => typeof effort !== 'string' || !effort)) {
    throw new ConfigError(`${where}.reasoningEfforts must be an array of strings.`);
  }
  const defaultReasoningEffort = optionalString(raw.defaultReasoningEffort, `${where}.defaultReasoningEffort`);
  if (defaultReasoningEffort && !efforts.includes(defaultReasoningEffort)) {
    throw new ConfigError(`${where}.defaultReasoningEffort must be one of reasoningEfforts.`);
  }
  const maxOutputTokens = raw.maxOutputTokens;
  if (
    maxOutputTokens !== undefined &&
    (typeof maxOutputTokens !== 'number' || !Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0)
  ) {
    throw new ConfigError(`${where}.maxOutputTokens must be a positive integer.`);
  }
  return {
    id,
    name: optionalString(raw.name, `${where}.name`) ?? id,
    reasoningEfforts: efforts as string[],
    defaultReasoningEffort,
    maxOutputTokens: maxOutputTokens as number | undefined,
    refusalFallback: raw.refusalFallback === true
  };
}

function parseProvider(raw: unknown, where: string): ProviderConfig {
  if (!isObject(raw)) throw new ConfigError(`${where} must be an object.`);
  const id = requireString(raw.id, `${where}.id`);
  // `type` may be omitted when the id already names a supported provider,
  // which is how configuration files written before `type` existed look.
  const type = optionalString(raw.type, `${where}.type`) ?? id;
  if (type !== 'openai' && type !== 'anthropic') {
    throw new ConfigError(`${where}.type must be "openai" or "anthropic" (got "${type}").`);
  }
  const api = optionalString(raw.api, `${where}.api`) ?? 'responses';
  if (api !== 'responses' && api !== 'chat_completions') {
    throw new ConfigError(`${where}.api must be "responses" or "chat_completions".`);
  }
  if (!Array.isArray(raw.models)) throw new ConfigError(`${where}.models must be an array.`);
  return {
    id,
    name: optionalString(raw.name, `${where}.name`) ?? id,
    type,
    enabled: raw.enabled !== false,
    apiKeyEnv: optionalString(raw.apiKeyEnv, `${where}.apiKeyEnv`) ?? DEFAULT_API_KEY_ENV[type],
    baseUrl: optionalString(raw.baseUrl, `${where}.baseUrl`),
    api,
    models: raw.models.map((model, index) => parseModel(model, `${where}.models[${index}]`))
  };
}

/** Validates and normalises the contents of `.config/config.json`. */
export function parseAppConfig(raw: unknown): AppConfig {
  if (!isObject(raw) || !Array.isArray(raw.providers)) {
    throw new ConfigError('config.json must be an object with a "providers" array.');
  }
  const providers = raw.providers.map((provider, index) => parseProvider(provider, `providers[${index}]`));

  const providerIds = new Set<string>();
  const modelOwners = new Map<string, string>();
  for (const provider of providers) {
    if (providerIds.has(provider.id)) throw new ConfigError(`Provider id "${provider.id}" is duplicated.`);
    providerIds.add(provider.id);
    if (!provider.enabled) continue;
    for (const model of provider.models) {
      const owner = modelOwners.get(model.id);
      if (owner) {
        throw new ConfigError(`Model id "${model.id}" is listed by both "${owner}" and "${provider.id}".`);
      }
      modelOwners.set(model.id, provider.id);
    }
  }

  const modelAliases: Record<string, string> = {};
  if (raw.modelAliases !== undefined) {
    if (!isObject(raw.modelAliases)) throw new ConfigError('modelAliases must be an object.');
    for (const [alias, target] of Object.entries(raw.modelAliases)) {
      const targetId = requireString(target, `modelAliases["${alias}"]`);
      if (!modelOwners.has(targetId)) {
        throw new ConfigError(`modelAliases["${alias}"] points to "${targetId}", which no enabled provider lists.`);
      }
      modelAliases[alias] = targetId;
    }
  }

  const defaultModel = optionalString(raw.defaultModel, 'defaultModel');
  if (defaultModel && !modelOwners.has(defaultModel)) {
    throw new ConfigError(`defaultModel "${defaultModel}" is not listed by any enabled provider.`);
  }

  return { defaultModel, modelAliases, providers };
}

export interface ResolvedModel {
  provider: ProviderConfig;
  model: ModelConfig;
  /** Empty when the provider's key variable is not set. */
  apiKey: string;
}

export type ModelLookup =
  | { ok: true; resolved: ResolvedModel }
  | { ok: false; reason: 'unknown_model' | 'missing_key'; message: string };

/** A parsed configuration together with the environment it reads keys from. */
export class ConfigSnapshot {
  constructor(
    readonly config: AppConfig,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  private apiKey(provider: ProviderConfig): string {
    return (this.env[provider.apiKeyEnv] ?? '').trim();
  }

  isAvailable(provider: ProviderConfig): boolean {
    return provider.enabled && this.apiKey(provider) !== '';
  }

  /** The configured default, or the first model of a provider that has a key. */
  get defaultModel(): string | undefined {
    if (this.config.defaultModel) return this.config.defaultModel;
    const enabled = this.config.providers.filter((provider) => provider.enabled);
    const preferred = enabled.find((provider) => this.isAvailable(provider) && provider.models.length > 0);
    return (preferred ?? enabled.find((provider) => provider.models.length > 0))?.models[0]?.id;
  }

  lookup(requestedModel: string | undefined): ModelLookup {
    const requested = requestedModel?.trim() || this.defaultModel;
    if (!requested) {
      return { ok: false, reason: 'unknown_model', message: 'No models are configured in .config/config.json.' };
    }
    const modelId = this.config.modelAliases[requested] ?? requested;
    for (const provider of this.config.providers) {
      if (!provider.enabled) continue;
      const model = provider.models.find((candidate) => candidate.id === modelId);
      if (!model) continue;
      const apiKey = this.apiKey(provider);
      if (!apiKey) {
        return {
          ok: false,
          reason: 'missing_key',
          message: `${provider.apiKeyEnv} is required to run Agent nodes that use ${provider.name} models.`
        };
      }
      return { ok: true, resolved: { provider, model, apiKey } };
    }
    return {
      ok: false,
      reason: 'unknown_model',
      message: `Model "${requested}" is not listed by any enabled provider in .config/config.json.`
    };
  }

  /** What the browser receives: no key names, no base URLs. */
  toPublic(): PublicAppConfig {
    return {
      defaultModel: this.defaultModel,
      modelAliases: this.config.modelAliases,
      providers: this.config.providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        enabled: provider.enabled,
        available: this.isAvailable(provider),
        models: provider.models.map((model) => ({
          id: model.id,
          name: model.name,
          reasoningEfforts: model.reasoningEfforts,
          defaultReasoningEffort: model.defaultReasoningEffort
        }))
      }))
    };
  }
}

export interface PublicAppConfig {
  defaultModel?: string;
  modelAliases: Record<string, string>;
  providers: Array<{
    id: string;
    name: string;
    enabled: boolean;
    available: boolean;
    models: Array<Pick<ModelConfig, 'id' | 'name' | 'reasoningEfforts' | 'defaultReasoningEffort'>>;
  }>;
}

/**
 * Loads `.config/config.json` and reloads it when the file changes, so models
 * and providers can be edited without restarting the server.
 */
export class ConfigStore {
  private cached?: { mtimeMs: number; snapshot: ConfigSnapshot };

  constructor(
    private readonly filePath: string,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  static forProject(projectRoot: string, env: NodeJS.ProcessEnv = process.env): ConfigStore {
    return new ConfigStore(path.join(projectRoot, '.config', 'config.json'), env);
  }

  /** Throws `ConfigError` when the file is missing or invalid. */
  get(): ConfigSnapshot {
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(this.filePath).mtimeMs;
    } catch {
      throw new ConfigError(`Configuration file not found: ${this.filePath}`);
    }
    if (this.cached?.mtimeMs === mtimeMs) return this.cached.snapshot;

    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    } catch (error) {
      throw new ConfigError(`config.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const snapshot = new ConfigSnapshot(parseAppConfig(raw), this.env);
    this.cached = { mtimeMs, snapshot };
    return snapshot;
  }
}
