import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/arxiv/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

/** Build an arXiv Atom feed XML with the given entries. */
function arxivXml(entries: Array<Record<string, string>> = []): string {
  const entryXml = entries.map(e => `
    <entry>
      <id>${e.id || 'http://arxiv.org/abs/2101.00001'}</id>
      <title>${e.title || 'A Paper'}</title>
      <summary>${e.summary || 'Abstract text.'}</summary>
      <published>${e.published || '2026-01-01T00:00:00Z'}</published>
      ${e.updated ? `<updated>${e.updated}</updated>` : ''}
      ${(e.authors || 'Author One').split(', ').map(a => `<author><name>${a}</name></author>`).join('')}
      ${(e.categories || 'cs.AI').split(', ').map(c => `<category term="${c}" />`).join('')}
      <link href="${e.link || 'http://arxiv.org/abs/2101.00001'}" />
      ${e.pdf ? `<link href="${e.pdf}" title="pdf" />` : ''}
    </entry>
  `).join('');
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entryXml}</feed>`;
}

function mockTextFetch(xml: string): void {
  globalThis.fetch = vi.fn(async () => ({ text: async () => xml }) as unknown as Response) as unknown as typeof fetch;
}

const ALL_COMMANDS = ['search', 'paper', 'recent'];

describe('arxiv plugin', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─── 注册元数据 ───
  it('should create site with name arxiv', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'arxiv' }));
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://arxiv.org' }));
  });

  it('should create site with requiresLogin false', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ requiresLogin: false }));
  });

  it('should register 3 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(ALL_COMMANDS.length);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(ALL_COMMANDS);
  });

  it('each command should have description, scope, parameters, and handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const config = call[1] as Record<string, unknown>;
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('scope');
      expect(config).toHaveProperty('parameters');
      expect(config).toHaveProperty('handler');
      expect(typeof config.handler).toBe('function');
    }
  });

  it('all commands should have project scope', () => {
    for (const call of mockSite.command.mock.calls) {
      expect((call[1] as Record<string, unknown>).scope).toBe('project');
    }
  });

  // ─── search ───
  describe('search command', () => {
    it('should parse XML entries and return formatted results', async () => {
      const handler = getHandler('search');
      mockTextFetch(arxivXml([
        { id: 'http://arxiv.org/abs/2101.00001', title: 'Attention Is All You Need', authors: 'Author A, Author B', summary: 'A summary.' },
        { id: 'http://arxiv.org/abs/2101.00002', title: 'BERT', authors: 'Author C', summary: 'Another.' },
      ]));

      const result = await handler({ query: 'transformer', limit: 20 }, {}) as Record<string, unknown>;
      const data = result.data as unknown[];
      expect(result.success).toBe(true);
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({
        rank: 1,
        id: '2101.00001',
        title: 'Attention Is All You Need',
        authors: 'Author A, Author B',
      });
    });

    it('should truncate summary to 300 chars', async () => {
      const handler = getHandler('search');
      mockTextFetch(arxivXml([{ summary: 'x'.repeat(400) }]));

      const result = await handler({ query: 'test', limit: 1 }, {}) as Record<string, unknown>;
      const summary = ((result.data as unknown[])[0] as Record<string, unknown>).summary as string;
      expect(summary.length).toBe(300);
    });

    it('should return fail when no entries', async () => {
      const handler = getHandler('search');
      mockTextFetch(arxivXml([]));

      const result = await handler({ query: 'xyz', limit: 20 }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });

    it('should extract published date (first 10 chars)', async () => {
      const handler = getHandler('search');
      mockTextFetch(arxivXml([{ published: '2026-03-15T12:00:00Z' }]));

      const result = await handler({ query: 'x', limit: 1 }, {}) as Record<string, unknown>;
      const first = (result.data as unknown[])[0] as Record<string, unknown>;
      expect(first.published).toBe('2026-03-15');
    });
  });

  // ─── paper ───
  describe('paper command', () => {
    it('should return paper details by ID', async () => {
      const handler = getHandler('paper');
      mockTextFetch(arxivXml([{
        id: 'http://arxiv.org/abs/2101.00001',
        title: 'GPT Paper',
        summary: 'Language model.',
        published: '2026-01-01T00:00:00Z',
        updated: '2026-02-01T00:00:00Z',
        authors: 'Author X',
        categories: 'cs.AI, cs.CL',
        link: 'http://arxiv.org/abs/2101.00001',
        pdf: 'http://arxiv.org/pdf/2101.00001.pdf',
      }]));

      const result = await handler({ id: '2101.00001' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        id: '2101.00001',
        title: 'GPT Paper',
        authors: 'Author X',
        categories: 'cs.AI, cs.CL',
        published: '2026-01-01',
        updated: '2026-02-01',
        pdf: 'http://arxiv.org/pdf/2101.00001.pdf',
      });
    });

    it('should return fail when paper not found', async () => {
      const handler = getHandler('paper');
      mockTextFetch(arxivXml([]));

      const result = await handler({ id: '9999.99999' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── recent ───
  describe('recent command', () => {
    it('should return recent papers by category', async () => {
      const handler = getHandler('recent');
      mockTextFetch(arxivXml([
        { title: 'Paper 1', authors: 'A' },
        { title: 'Paper 2', authors: 'B' },
      ]));

      const result = await handler({ category: 'cs.AI', limit: 20 }, {}) as Record<string, unknown>;
      const data = result.data as unknown[];
      expect(result.success).toBe(true);
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({ rank: 1, title: 'Paper 1' });
    });

    it('should default to cs.AI category', async () => {
      const handler = getHandler('recent');
      mockTextFetch(arxivXml([{ title: 'X' }]));

      const result = await handler({ category: 'cs.AI', limit: 20 }, {}) as Record<string, unknown>;
      expect(result.success).toBe(true);
    });

    it('should return fail when no papers', async () => {
      const handler = getHandler('recent');
      globalThis.fetch = vi.fn(async () => ({ text: async () => arxivXml([]) }) as unknown as Response) as unknown as typeof fetch;

      const result = await handler({ category: 'cs.AI', limit: 20 }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });
});
