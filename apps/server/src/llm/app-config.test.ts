import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, ConfigSnapshot, ConfigStore, parseAppConfig } from './app-config.js';

const twoProviders = {
  defaultModel: 'claude-a',
  modelAliases: { 'old-model': 'gpt-a' },
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      models: [{ id: 'gpt-a', name: 'GPT A', reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' }]
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      type: 'anthropic',
      models: [{ id: 'claude-a', reasoningEfforts: ['medium'], refusalFallback: true, maxOutputTokens: 8000 }]
    }
  ]
};

describe('parseAppConfig', () => {
  it('fills in defaults so files written before provider types existed still load', () => {
    const config = parseAppConfig({
      providers: [{ id: 'openai', name: 'OpenAI', enabled: true, models: [{ id: 'gpt-5', name: 'GPT-5', reasoningEfforts: ['low'] }] }]
    });
    expect(config.providers[0]).toMatchObject({
      type: 'openai',
      apiKeyEnv: 'OPENAI_API_KEY',
      api: 'responses',
      enabled: true
    });
    expect(config.modelAliases).toEqual({});
  });

  it('reads provider and model options', () => {
    const config = parseAppConfig(twoProviders);
    expect(config.providers[1]).toMatchObject({ type: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' });
    expect(config.providers[1].models[0]).toMatchObject({
      id: 'claude-a',
      name: 'claude-a',
      refusalFallback: true,
      maxOutputTokens: 8000
    });
  });

  it.each([
    [{}, /"providers" array/],
    [{ providers: [{ id: 'mistral', models: [] }] }, /type must be "openai" or "anthropic"/],
    [{ providers: [{ id: 'openai', api: 'soap', models: [] }] }, /api must be/],
    [{ providers: [{ id: 'openai', models: [{ id: '' }] }] }, /models\[0\]\.id/],
    [{ providers: [{ id: 'openai', models: [{ id: 'm', reasoningEfforts: ['low'], defaultReasoningEffort: 'max' }] }] }, /defaultReasoningEffort/],
    [{ providers: [{ id: 'openai', models: [{ id: 'm' }] }, { id: 'openai', models: [] }] }, /Provider id "openai" is duplicated/],
    [{ providers: [{ id: 'a', type: 'openai', models: [{ id: 'm' }] }, { id: 'b', type: 'openai', models: [{ id: 'm' }] }] }, /listed by both "a" and "b"/],
    [{ defaultModel: 'nope', providers: [{ id: 'openai', models: [{ id: 'm' }] }] }, /defaultModel "nope"/],
    [{ modelAliases: { old: 'nope' }, providers: [{ id: 'openai', models: [{ id: 'm' }] }] }, /modelAliases\["old"\]/]
  ])('rejects invalid configuration %#', (raw, message) => {
    expect(() => parseAppConfig(raw)).toThrow(ConfigError);
    expect(() => parseAppConfig(raw)).toThrow(message);
  });

  it('allows the same model id in a disabled provider', () => {
    const config = parseAppConfig({
      providers: [
        { id: 'a', type: 'openai', models: [{ id: 'm' }] },
        { id: 'b', type: 'openai', enabled: false, models: [{ id: 'm' }] }
      ]
    });
    expect(config.providers).toHaveLength(2);
  });
});

describe('ConfigSnapshot', () => {
  const snapshot = (env: NodeJS.ProcessEnv) => new ConfigSnapshot(parseAppConfig(twoProviders), env);

  it('resolves a model to its provider and key', () => {
    const lookup = snapshot({ OPENAI_API_KEY: 'sk-test' }).lookup('gpt-a');
    expect(lookup).toMatchObject({ ok: true, resolved: { provider: { id: 'openai' }, model: { id: 'gpt-a' }, apiKey: 'sk-test' } });
  });

  it('follows aliases and falls back to the default model', () => {
    const both = snapshot({ OPENAI_API_KEY: 'a', ANTHROPIC_API_KEY: 'b' });
    expect(both.lookup('old-model')).toMatchObject({ ok: true, resolved: { model: { id: 'gpt-a' } } });
    expect(both.lookup(undefined)).toMatchObject({ ok: true, resolved: { model: { id: 'claude-a' } } });
    expect(both.lookup('  ')).toMatchObject({ ok: true, resolved: { model: { id: 'claude-a' } } });
  });

  it('explains a missing key and an unknown model', () => {
    const noKeys = snapshot({});
    expect(noKeys.lookup('claude-a')).toEqual({
      ok: false,
      reason: 'missing_key',
      message: 'ANTHROPIC_API_KEY is required to run Agent nodes that use Anthropic models.'
    });
    expect(noKeys.lookup('gpt-99')).toMatchObject({ ok: false, reason: 'unknown_model' });
  });

  it('prefers a provider with a key when no default model is configured', () => {
    const config = parseAppConfig({ ...twoProviders, defaultModel: undefined });
    expect(new ConfigSnapshot(config, { ANTHROPIC_API_KEY: 'k' }).defaultModel).toBe('claude-a');
    expect(new ConfigSnapshot(config, {}).defaultModel).toBe('gpt-a');
  });

  it('exposes availability but no key names or base URLs to the browser', () => {
    const publicConfig = snapshot({ OPENAI_API_KEY: 'sk-secret' }).toPublic();
    expect(publicConfig.providers.map((p) => [p.id, p.available])).toEqual([
      ['openai', true],
      ['anthropic', false]
    ]);
    expect(publicConfig.defaultModel).toBe('claude-a');
    const serialized = JSON.stringify(publicConfig);
    expect(serialized).not.toContain('sk-secret');
    expect(serialized).not.toContain('API_KEY');
  });
});

describe('ConfigStore', () => {
  it('reloads when the file changes and reports a missing or broken file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-config-'));
    const file = path.join(dir, 'config.json');
    const store = new ConfigStore(file, {});
    expect(() => store.get()).toThrow(/not found/);

    fs.writeFileSync(file, JSON.stringify(twoProviders));
    expect(store.get().defaultModel).toBe('claude-a');
    expect(store.get()).toBe(store.get());

    fs.writeFileSync(file, JSON.stringify({ ...twoProviders, defaultModel: 'gpt-a' }));
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(store.get().defaultModel).toBe('gpt-a');

    fs.writeFileSync(file, '{broken');
    fs.utimesSync(file, new Date(), new Date(Date.now() + 10000));
    expect(() => store.get()).toThrow(/not valid JSON/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accepts the configuration shipped with the project', () => {
    const shipped = ConfigStore.forProject(path.resolve(import.meta.dirname, '../../../..'), {}).get();
    expect(shipped.config.providers.map((p) => p.type)).toEqual(['openai', 'anthropic']);
    expect(shipped.lookup(undefined)).toMatchObject({ ok: false, reason: 'missing_key' });
  });
});
