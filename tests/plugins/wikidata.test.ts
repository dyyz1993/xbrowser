import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../.xcli/plugins/wikidata/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };
const originalFetch = globalThis.fetch;

function handlerOf(name: string): (params: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return call[1].handler;
}

describe('wikidata plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('registers both project commands', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'wikidata',
      requiresLogin: false,
    }));
    expect(mockSite.command).toHaveBeenCalledWith('search', expect.objectContaining({ scope: 'project' }));
    expect(mockSite.command).toHaveBeenCalledWith('entity', expect.objectContaining({ scope: 'project' }));
  });

  it('maps search entities and falls back to display labels', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        search: [
          { id: 'Q42', label: 'Douglas Adams', description: 'author' },
          { id: 'Q1', display: { label: { value: 'Universe' }, description: { value: 'everything' } } },
        ],
      }),
    })) as unknown as typeof fetch;

    const result = await handlerOf('search')({ query: 'douglas', limit: 2 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      { rank: 1, id: 'Q42', label: 'Douglas Adams', description: 'author', url: 'https://www.wikidata.org/wiki/Q42' },
      { rank: 2, id: 'Q1', label: 'Universe', description: 'everything', url: 'https://www.wikidata.org/wiki/Q1' },
    ]);
  });

  it('summarizes entity claims and sitelinks with English fallbacks', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        entities: {
          Q42: {
            type: 'item',
            modified: '2026-01-01T00:00:00Z',
            labels: { en: { value: 'Douglas Adams' }, fr: { value: 'Adams' } },
            descriptions: { fr: { value: 'ecrivain' } },
            claims: { P31: [], P106: [] },
            sitelinks: { enwiki: {}, frwiki: {} },
          },
        },
      }),
    })) as unknown as typeof fetch;

    const result = await handlerOf('entity')({ id: 'Q42' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      id: 'Q42',
      label: 'Douglas Adams',
      description: 'ecrivain',
      type: 'item',
      modified: '2026-01-01T00:00:00Z',
      propertyCount: 2,
      siteLinkCount: 2,
      url: 'https://www.wikidata.org/wiki/Q42',
    });
  });

  it('fails when entity is absent', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ entities: {} }),
    })) as unknown as typeof fetch;

    const result = await handlerOf('entity')({ id: 'Q999999' });
    expect(result.success).toBe(false);
    expect(result.message).toBe('Entity "Q999999" not found');
  });
});
