import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/apple-podcasts/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

function mockJsonFetch(responder: unknown): void {
  globalThis.fetch = vi.fn(async () => ({ json: async () => responder }) as unknown as Response) as unknown as typeof fetch;
}

const ALL_COMMANDS = ['search', 'top'];

describe('apple-podcasts plugin', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  // ─── 注册元数据 ───
  it('should create site with name apple-podcasts', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'apple-podcasts' }));
  });
  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://podcasts.apple.com' }));
  });
  it('should create site with requiresLogin false', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ requiresLogin: false }));
  });
  it('should register 2 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(ALL_COMMANDS.length);
  });
  it('should register expected command names', () => {
    expect(mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string)).toEqual(ALL_COMMANDS);
  });
  it('each command should have description, scope, parameters, handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const config = call[1] as Record<string, unknown>;
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('scope');
      expect(config).toHaveProperty('parameters');
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
    it('should return formatted podcast results', async () => {
      const handler = getHandler('search');
      mockJsonFetch({
        results: [
          { collectionId: 1, collectionName: 'Tech Talk', artistName: 'Alice', genres: ['Technology', 'News'], trackCount: 50, collectionViewUrl: 'https://apple.com/podcast/1', feedUrl: 'https://feed.xml' },
          { collectionId: 2, collectionName: 'CodeCast', artistName: 'Bob', genres: ['Tech'], trackCount: 30, collectionViewUrl: 'https://apple.com/podcast/2' },
        ],
      });

      const result = await handler({ query: 'tech', limit: 20 }, {}) as Record<string, unknown>;
      const data = result.data as unknown[];
      expect(result.success).toBe(true);
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({
        rank: 1, collectionId: 1, collectionName: 'Tech Talk', artistName: 'Alice',
        genres: 'Technology, News', trackCount: 50,
      });
    });

    it('should return fail when no results', async () => {
      const handler = getHandler('search');
      mockJsonFetch({ results: [] });

      const result = await handler({ query: 'xyz', limit: 20 }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── top ───
  describe('top command', () => {
    it('should return top podcasts from feed entries', async () => {
      const handler = getHandler('top');
      mockJsonFetch({
        feed: {
          entry: [
            {
              'id': { attributes: { 'im:id': '123' }, label: 'https://apple.com/123' },
              'im:name': { label: 'Top Podcast' },
              'im:artist': { label: 'Host Name' },
              'im:image': [{ label: 'https://img.example.com/100.jpg' }],
              'summary': { label: 'A great podcast.' },
            },
          ],
        },
      });

      const result = await handler({ country: 'us', genre: '0', limit: 20 }, {}) as Record<string, unknown>;
      const data = result.data as unknown[];
      expect(result.success).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        rank: 1, id: '123', name: 'Top Podcast', artist: 'Host Name',
        summary: 'A great podcast.',
      });
    });

    it('should return fail when feed has no entries', async () => {
      const handler = getHandler('top');
      mockJsonFetch({ feed: {} });

      const result = await handler({ country: 'us', genre: '0', limit: 20 }, {}) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });
});
