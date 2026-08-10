import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/hackernews/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

const ALL_COMMANDS = ['top', 'new', 'best', 'ask', 'show', 'jobs', 'search', 'read'];

/** A single HN Firebase item fixture. */
function hnItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    title: 'Test Story',
    score: 42,
    by: 'alice',
    descendants: 5,
    url: 'https://example.com',
    type: 'story',
    ...overrides,
  };
}

/**
 * Mock globalThis.fetch for HN Firebase-style endpoints.
 * - /<endpoint>stories.json → number[]
 * - /item/<id>.json → item object
 * Returns the same item fixture for every ID (callers customize via itemFactory).
 */
function mockFetch(opts: {
  ids?: number[];
  itemFactory?: (id: number) => Record<string, unknown> | null;
  itemById?: Record<number, Record<string, unknown> | null>;
}): { calls: string[] } {
  const calls: string[] = [];
  const defaultItem = hnItem();
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    calls.push(u);

    // ID list endpoints: *stories.json
    if (/stories\.json$/.test(u)) {
      return { json: async () => opts.ids ?? [1, 2, 3] } as unknown as Response;
    }
    // Single item: /item/<id>.json
    const itemMatch = u.match(/\/item\/(\d+)\.json$/);
    if (itemMatch) {
      const id = Number(itemMatch[1]);
      let item: Record<string, unknown> | null;
      if (opts.itemById && id in opts.itemById) {
        item = opts.itemById[id];
      } else if (opts.itemFactory) {
        item = opts.itemFactory(id);
      } else {
        item = { ...defaultItem, id };
      }
      return { json: async () => item } as unknown as Response;
    }

    // Algolia search endpoint
    if (u.includes('hn.algolia.com')) {
      return {
        json: async () => ({
          hits: [
            { objectID: '10', title: 'Algolia Hit', points: 7, author: 'bob', num_comments: 2, url: 'https://ex.com', story_url: '' },
          ],
        }),
      } as unknown as Response;
    }

    return { json: async () => null } as unknown as Response;
  }) as unknown as typeof fetch;

  return { calls };
}

describe('hackernews plugin', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─── 注册测试 ───
  it('should create site with name hackernews', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'hackernews' }));
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://news.ycombinator.com' }));
  });

  it('should create site with requiresLogin false', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ requiresLogin: false }));
  });

  it('should register 8 commands', () => {
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
      const config = call[1] as Record<string, unknown>;
      expect(config.scope).toBe('project');
    }
  });

  // ─── top/new/best/ask/show/jobs 共享测试（结构相同）───
  // 每个命令打不同的 endpoint，但 fetch/id-list/item 逻辑一致。
  const LIST_COMMANDS: Array<{ name: string; endpoint: string }> = [
    { name: 'top', endpoint: 'topstories' },
    { name: 'new', endpoint: 'newstories' },
    { name: 'best', endpoint: 'beststories' },
    { name: 'ask', endpoint: 'askstories' },
    { name: 'show', endpoint: 'showstories' },
    { name: 'jobs', endpoint: 'jobstories' },
  ];

  for (const { name, endpoint } of LIST_COMMANDS) {
    describe(`${name} command`, () => {
      it(`should fetch ${endpoint}.json and return formatted stories`, async () => {
        const handler = getHandler(name);
        mockFetch({ ids: [1, 2] });

        const result = await handler({ limit: 2 }, {}) as Record<string, unknown>;
        const data = result.data as unknown[];

        expect(result.success).toBe(true);
        expect(data).toHaveLength(2);
        expect(data[0]).toMatchObject({
          rank: 1,
          id: 1,
          title: 'Test Story',
          score: 42,
          author: 'alice',
          comments: 5,
        });
      });

      it('should fetch the correct endpoint', async () => {
        const handler = getHandler(name);
        const { calls } = mockFetch({ ids: [1] });
        await handler({ limit: 1 }, {});

        expect(calls.some(u => u.includes(`${endpoint}.json`))).toBe(true);
      });

      it('should filter out deleted and dead items', async () => {
        const handler = getHandler(name);
        mockFetch({
          ids: [1, 2, 3],
          itemById: {
            1: hnItem({ id: 1, deleted: true }),
            2: hnItem({ id: 2, dead: true }),
            3: hnItem({ id: 3 }),
          },
        });

        const result = await handler({ limit: 5 }, {}) as Record<string, unknown>;
        const data = result.data as unknown[];
        expect(data).toHaveLength(1);
        expect((data[0] as Record<string, unknown>).id).toBe(3);
      });

      it('should respect the limit parameter', async () => {
        const handler = getHandler(name);
        mockFetch({ ids: [1, 2, 3, 4, 5] });

        const result = await handler({ limit: 2 }, {}) as Record<string, unknown>;
        expect((result.data as unknown[])).toHaveLength(2);
      });

      it('should generate HN URL when item.url is missing', async () => {
        const handler = getHandler(name);
        mockFetch({
          ids: [1],
          itemById: { 1: hnItem({ id: 99, url: undefined }) },
        });

        const result = await handler({ limit: 1 }, {}) as Record<string, unknown>;
        const first = (result.data as unknown[])[0] as Record<string, unknown>;
        expect(first.url).toBe('https://news.ycombinator.com/item?id=99');
      });

      // ask 命令特殊：始终用 HN URL（不读 item.url）
      if (name === 'ask') {
        it('ask should always use HN URL regardless of item.url', async () => {
          const handler = getHandler('ask');
          mockFetch({
            ids: [1],
            itemById: { 1: hnItem({ id: 7, url: 'https://external.com' }) },
          });

          const result = await handler({ limit: 1 }, {}) as Record<string, unknown>;
          const first = (result.data as unknown[])[0] as Record<string, unknown>;
          expect(first.url).toBe('https://news.ycombinator.com/item?id=7');
        });
      }
    });
  }

  // ─── search 命令（走 Algolia）───
  describe('search command', () => {
    it('should query Algolia and return formatted hits', async () => {
      const handler = getHandler('search');
      const { calls } = mockFetch({});

      const result = await handler({ query: 'rust', limit: 20 }, {}) as Record<string, unknown>;
      const data = result.data as unknown[];

      expect(result.success).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        rank: 1,
        id: '10',
        title: 'Algolia Hit',
        score: 7,
        author: 'bob',
        comments: 2,
      });
      // Should call Algolia with the query
      expect(calls.some(u => u.includes('hn.algolia.com') && u.includes('query=rust'))).toBe(true);
    });

    it('should URL-encode the query', async () => {
      const handler = getHandler('search');
      const { calls } = mockFetch({});
      await handler({ query: 'node js', limit: 5 }, {});
      expect(calls.some(u => u.includes('query=node%20js'))).toBe(true);
    });
  });

  // ─── read 命令（单 item 查询）───
  describe('read command', () => {
    it('should fetch item by ID and return full detail', async () => {
      const handler = getHandler('read');
      mockFetch({
        itemById: { 123: hnItem({ id: 123, title: 'Deep Dive', text: 'long body', score: 99, by: 'carol', descendants: 10, type: 'story' }) },
      });

      const result = await handler({ id: 123 }, {}) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        id: 123,
        title: 'Deep Dive',
        text: 'long body',
        score: 99,
        author: 'carol',
        comments: 10,
        type: 'story',
      });
    });

    it('should return fail when item not found', async () => {
      const handler = getHandler('read');
      mockFetch({ itemById: { 999: null } });

      const result = await handler({ id: 999 }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });

    it('should default text to "(no text)" when missing', async () => {
      const handler = getHandler('read');
      mockFetch({
        itemById: { 1: hnItem({ id: 1, text: undefined }) },
      });

      const result = await handler({ id: 1 }, {}) as Record<string, unknown>;
      expect((result.data as Record<string, unknown>).text).toBe('(no text)');
    });
  });
});
