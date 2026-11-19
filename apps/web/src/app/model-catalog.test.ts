import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../services/api';
import { applyModelAliases, buildModelCatalog } from './model-catalog';
import type { EditorNode } from './types';

const config: AppConfig = {
  defaultModel: 'claude-a',
  modelAliases: { 'gpt-old': 'gpt-a' },
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      enabled: true,
      available: true,
      models: [{ id: 'gpt-a', name: 'GPT A', reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' }]
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      enabled: true,
      available: true,
      models: [{ id: 'claude-a', name: 'Claude A', reasoningEfforts: ['medium'] }]
    },
    { id: 'off', name: 'Off', enabled: false, models: [{ id: 'hidden', name: 'Hidden', reasoningEfforts: [] }] }
  ]
};

describe('buildModelCatalog', () => {
  it('lists models from every enabled provider with labels, efforts and the default', () => {
    expect(buildModelCatalog(config)).toEqual({
      options: ['gpt-a', 'claude-a'],
      efforts: { 'gpt-a': ['low', 'high'], 'claude-a': ['medium'] },
      labels: { 'gpt-a': 'GPT A', 'claude-a': 'Claude A' },
      defaultEfforts: { 'gpt-a': 'low' },
      defaultModel: 'claude-a',
      aliases: { 'gpt-old': 'gpt-a' }
    });
  });

  it('hides providers without an API key and moves the default to a model that can run', () => {
    const catalog = buildModelCatalog({
      ...config,
      providers: config.providers!.map((p) => (p.id === 'anthropic' ? { ...p, available: false } : p))
    });
    expect(catalog?.options).toEqual(['gpt-a']);
    expect(catalog?.defaultModel).toBe('gpt-a');
  });

  it('still lists models when no provider has a key', () => {
    const catalog = buildModelCatalog({
      ...config,
      providers: config.providers!.map((p) => ({ ...p, available: false }))
    });
    expect(catalog?.options).toEqual(['gpt-a', 'claude-a']);
  });

  it('accepts the older configuration shape without availability, aliases or a default', () => {
    const catalog = buildModelCatalog({
      providers: [{ id: 'openai', name: 'OpenAI', enabled: true, models: [{ id: 'gpt-5', name: 'GPT-5', reasoningEfforts: ['low'] }] }]
    });
    expect(catalog).toMatchObject({ options: ['gpt-5'], defaultModel: 'gpt-5', aliases: {} });
  });

  it('returns null when nothing is configured', () => {
    expect(buildModelCatalog({})).toBeNull();
    expect(buildModelCatalog({ providers: [{ id: 'x', name: 'X', enabled: true, models: [] }] })).toBeNull();
  });
});

describe('applyModelAliases', () => {
  const agent = (id: string, model?: string): EditorNode => ({ id, type: 'agent', x: 0, y: 0, data: { model } });

  it('replaces retired model ids on agent nodes only', () => {
    const nodes: EditorNode[] = [
      agent('a', 'gpt-old'),
      agent('b', 'claude-a'),
      agent('c'),
      { id: 'd', type: 'start', x: 0, y: 0, data: {} }
    ];
    expect(applyModelAliases(nodes, { 'gpt-old': 'gpt-a' }, ['gpt-a', 'claude-a'])).toBe(true);
    expect(nodes.map((node) => node.data?.model)).toEqual(['gpt-a', 'claude-a', undefined, undefined]);
  });

  it('leaves a node alone when the replacement is not offered', () => {
    const nodes = [agent('a', 'gpt-old')];
    expect(applyModelAliases(nodes, { 'gpt-old': 'gpt-a' }, ['claude-a'])).toBe(false);
    expect(nodes[0].data?.model).toBe('gpt-old');
  });
});
