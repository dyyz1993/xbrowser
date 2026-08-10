import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/wikipedia/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

/** Mock globalThis.fetch to return JSON. URL → data mapping. */
function mockJsonFetch(map: Record<string, unknown>): void {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    for (const key of Object.keys(map)) {
      if (u.includes(key)) return { json: async () => map[key] } as unknown as Response;
    }
    return { json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
}

const ALL_COMMANDS = ['search', 'summary', 'page', 'random', 'trending'];

describe('wikipedia plugin', () => {
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
  it('should create site with name wikipedia', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'wikipedia' }));
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://en.wikipedia.org' }));
  });

  it('should create site with requiresLogin false', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ requiresLogin: false }));
  });

  it('should register 5 commands', () => {
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
    it('should return formatted search results', async () => {
      const handler = getHandler('search');
      mockJsonFetch({
        'api.php': {
          query: {
            search: [
              { title: 'TypeScript', snippet: 'A <b>programming</b> language', pageid: 1, wordcount: 500 },
              { title: 'JavaScript', snippet: 'Another language', pageid: 2, wordcount: 400 },
            ],
          },
        },
      });

      const result = await handler({ query: 'typescript', limit: 20 }, {}) as Record<string, unknown>;
      const data = result.data as unknown[];
      expect(result.success).toBe(true);
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({ rank: 1, title: 'TypeScript', pageId: 1, wordCount: 500 });
      // snippet should have HTML stripped
      expect((data[0] as Record<string, unknown>).snippet).toBe('A programming language');
    });

    it('should generate wiki URL with underscores', async () => {
      const handler = getHandler('search');
      mockJsonFetch({
        'api.php': { query: { search: [{ title: 'Node JS', snippet: '', pageid: 1, wordcount: 0 }] } },
      });

      const result = await handler({ query: 'node', limit: 5 }, {}) as Record<string, unknown>;
      const first = (result.data as unknown[])[0] as Record<string, unknown>;
      expect(first.url).toBe('https://en.wikipedia.org/wiki/Node_JS');
    });

    it('should return fail when no results', async () => {
      const handler = getHandler('search');
      mockJsonFetch({ 'api.php': { query: { search: [] } } });

      const result = await handler({ query: 'xyznomatch', limit: 20 }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── summary ───
  describe('summary command', () => {
    it('should return article summary', async () => {
      const handler = getHandler('summary');
      mockJsonFetch({
        'rest_v1/page/summary': {
          title: 'Python (language)',
          extract: 'Python is a programming language.',
          description: 'Programming language',
          thumbnail: { source: 'https://img.example.com/python.png' },
          pageid: 123,
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Python' } },
        },
      });

      const result = await handler({ title: 'Python' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        title: 'Python (language)',
        extract: 'Python is a programming language.',
        thumbnail: 'https://img.example.com/python.png',
        pageId: 123,
      });
    });

    it('should return fail on not_found error type', async () => {
      const handler = getHandler('summary');
      mockJsonFetch({
        'rest_v1/page/summary': { type: 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found' },
      });

      const result = await handler({ title: 'Nonexistent' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });

    it('should fallback URL when content_urls missing', async () => {
      const handler = getHandler('summary');
      mockJsonFetch({ 'rest_v1/page/summary': { title: 'Go', extract: '' } });

      const result = await handler({ title: 'Go' }, {}) as Record<string, unknown>;
      expect((result.data as Record<string, unknown>).url).toBe('https://en.wikipedia.org/wiki/Go');
    });
  });

  // ─── page ───
  describe('page command', () => {
    it('should return full page content with HTML stripped', async () => {
      const handler = getHandler('page');
      mockJsonFetch({
        'action=parse': {
          parse: { title: 'Rust', pageid: 456, text: { '*': '<p>Rust is <b>safe</b>.</p>' } },
        },
      });

      const result = await handler({ title: 'Rust' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>).text).toBe('Rust is safe.');
    });

    it('should truncate long text to 5000 chars', async () => {
      const handler = getHandler('page');
      const longText = 'x'.repeat(6000);
      mockJsonFetch({ 'action=parse': { parse: { title: 'Long', pageid: 1, text: { '*': longText } } } });

      const result = await handler({ title: 'Long' }, {}) as Record<string, unknown>;
      const text = (result.data as Record<string, unknown>).text as string;
      expect(text.endsWith('...')).toBe(true);
      expect(text.length).toBe(5003);
    });

    it('should return fail on API error', async () => {
      const handler = getHandler('page');
      mockJsonFetch({ 'action=parse': { error: { info: 'Page missing' } } });

      const result = await handler({ title: 'BadPage' }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── random ───
  describe('random command', () => {
    it('should return a random article summary', async () => {
      const handler = getHandler('random');
      mockJsonFetch({
        'page/random/summary': {
          title: 'Random Article',
          extract: 'A random article.',
          pageid: 789,
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Random_Article' } },
        },
      });

      const result = await handler({}, {}) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>).title).toBe('Random Article');
    });
  });

  // ─── trending ───
  describe('trending command', () => {
    it('should return trending articles', async () => {
      const handler = getHandler('trending');
      mockJsonFetch({
        'pageviews/top': {
          items: [{ articles: [
            { article: 'Top Article', views: 999999 },
            { article: 'Second Article', views: 888888 },
          ] }],
        },
      });

      const result = await handler({ year: 2026, month: 1, day: 1, limit: 20 }, {}) as Record<string, unknown>;
      const data = result.data as unknown[];
      expect(result.success).toBe(true);
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({ rank: 1, title: 'Top Article', views: 999999 });
    });

    it('should return fail when no trending articles', async () => {
      const handler = getHandler('trending');
      mockJsonFetch({ 'pageviews/top': { items: [{ articles: [] }] } });

      const result = await handler({ year: 2026, month: 1, day: 1, limit: 20 }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });
});
