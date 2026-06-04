import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildCommandContract, buildPluginContract, fieldsFromZodObject } from '../../src/plugin/contract.js';

describe('plugin contract', () => {
  it('infers form fields from zod parameters', () => {
    const fields = fieldsFromZodObject(z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().default(10),
      includeImages: z.boolean().optional().default(false),
      engine: z.enum(['google', 'bing']).optional().default('google'),
    }));

    expect(fields).toMatchObject([
      { name: 'query', type: 'string', widget: 'text', required: true, description: 'Search query' },
      { name: 'limit', type: 'number', widget: 'number', required: false, default: 10 },
      { name: 'includeImages', type: 'boolean', widget: 'checkbox', required: false, default: false },
      { name: 'engine', type: 'enum', widget: 'select', required: false, enum: ['google', 'bing'], default: 'google' },
    ]);
  });

  it('merges explicit xbrowser form metadata over inferred fields', () => {
    const contract = buildCommandContract({
      name: 'search',
      description: 'Search content',
      scope: 'page',
      requiresLogin: true,
      parameters: z.object({
        query: z.string(),
        limit: z.number().optional(),
      }),
      xbrowser: {
        category: 'search',
        capabilities: ['browser.page', 'network'],
        positional: ['query'],
        form: {
          title: 'Search',
          submitLabel: 'Go',
          fields: [
            { name: 'query', label: 'Keywords', placeholder: 'agent browser' },
            { name: 'apiKey', label: 'API key', widget: 'password', secret: true },
          ],
        },
      },
    });

    expect(contract.category).toBe('search');
    expect(contract.capabilities).toEqual(['browser.page', 'network']);
    expect(contract.positional).toEqual(['query']);
    expect(contract.form.submitLabel).toBe('Go');
    expect(contract.form.fields).toMatchObject([
      { name: 'query', label: 'Keywords', required: true, placeholder: 'agent browser' },
      { name: 'apiKey', label: 'API key', widget: 'password', secret: true },
      { name: 'limit', type: 'number', required: false },
    ]);
  });

  it('builds site-level contract with commands', () => {
    const contract = buildPluginContract({
      name: 'demo',
      url: 'https://example.com',
      config: { description: 'Demo plugin' },
      getAllCommands: () => [
        {
          name: 'fill-form',
          description: 'Fill a form',
          scope: 'page',
          parameters: z.object({
            email: z.string(),
          }),
        },
      ],
    });

    expect(contract.version).toBe(2);
    expect(contract.plugin).toMatchObject({ name: 'demo', url: 'https://example.com' });
    expect(contract.commands[0]).toMatchObject({
      name: 'fill-form',
      capabilities: ['browser.page'],
      form: {
        fields: [{ name: 'email', type: 'string', widget: 'text', required: true }],
      },
    });
  });

  it('uses full command definitions when getAllCommands returns summaries', () => {
    const fullCommand = {
      name: 'search',
      description: 'Search',
      scope: 'page',
      parameters: z.object({
        query: z.string(),
      }),
    };

    const contract = buildPluginContract({
      name: 'demo',
      getAllCommands: () => [{ name: 'search', description: 'Search', scope: 'page' }],
      getCommand: (name: string) => name === 'search' ? fullCommand : undefined,
    });

    expect(contract.commands[0].form.fields).toMatchObject([
      { name: 'query', type: 'string', widget: 'text', required: true },
    ]);
  });

  it('summarizes result schemas for command output', () => {
    const contract = buildCommandContract({
      name: 'list',
      description: 'List items',
      scope: 'project',
      parameters: z.object({}),
      result: z.array(z.object({
        title: z.string(),
        score: z.number().optional(),
      })),
    });

    expect(contract.output).toMatchObject({
      schema: {
        type: 'array',
        items: {
          title: { type: 'string', required: true },
          score: { type: 'number', required: false },
        },
      },
    });
  });

  it('inherits site-level login requirement into command contract', () => {
    const contract = buildPluginContract({
      name: 'secure',
      config: { requiresLogin: true },
      getAllCommands: () => [
        { name: 'publish', description: 'Publish', scope: 'page', parameters: z.object({ title: z.string() }) },
        { name: 'login', description: 'Login', scope: 'page', parameters: z.object({}) },
      ],
    });

    expect(contract.commands.find(command => command.name === 'publish')).toMatchObject({
      requiresLogin: true,
      capabilities: ['browser.page', 'auth.login'],
    });
    expect(contract.commands.find(command => command.name === 'login')).toMatchObject({
      requiresLogin: false,
    });
  });
});
