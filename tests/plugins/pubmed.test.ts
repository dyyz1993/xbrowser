import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../.xcli/plugins/pubmed/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };
const originalFetch = globalThis.fetch;

function handlerOf(name: string): (params: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return call[1].handler;
}

function jsonFetch(response: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => response,
  })) as unknown as typeof fetch;
}

describe('pubmed plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('registers a project search command', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'pubmed',
      url: 'https://pubmed.ncbi.nlm.nih.gov',
      requiresLogin: false,
    }));
    expect(mockSite.command).toHaveBeenCalledWith('search', expect.objectContaining({
      scope: 'project',
      result: expect.anything(),
    }));
  });

  it('maps ESearch IDs and ESummary records to ranked articles', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('esearch.fcgi')) {
        return { ok: true, status: 200, json: async () => ({ esearchresult: { idlist: ['111', '222'] } }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            111: {
              title: 'Cancer model',
              authors: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
              fulljournalname: 'Journal One',
              pubdate: '2026 Jan',
              elocationid: 'doi:10.1/a',
            },
            222: {
              title: 'Machine learning',
              authors: [],
              source: 'Journal Two',
              pubdate: '2026 Feb',
              elocationid: '',
            },
          },
        }),
      };
    }) as unknown as typeof fetch;

    const result = await handlerOf('search')({ query: 'cancer', limit: 2 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      {
        rank: 1,
        pmid: '111',
        title: 'Cancer model',
        authors: 'A, B, C',
        journal: 'Journal One',
        pubDate: '2026 Jan',
        doi: 'doi:10.1/a',
        url: 'https://pubmed.ncbi.nlm.nih.gov/111/',
      },
      {
        rank: 2,
        pmid: '222',
        title: 'Machine learning',
        authors: '',
        journal: 'Journal Two',
        pubDate: '2026 Feb',
        doi: '',
        url: 'https://pubmed.ncbi.nlm.nih.gov/222/',
      },
    ]);
  });

  it('fails clearly when ESearch has no IDs', async () => {
    globalThis.fetch = jsonFetch({ esearchresult: { idlist: [] } });
    const result = await handlerOf('search')({ query: 'none', limit: 5 });
    expect(result.success).toBe(false);
    expect(result.message).toBe('No articles matched "none"');
  });
});
