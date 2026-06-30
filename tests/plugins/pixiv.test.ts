import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/pixiv/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

function createMockPage(evaluateResult: unknown = []) {
  return {
    url: vi.fn(() => 'https://www.pixiv.net'),
    goto: vi.fn(() => Promise.resolve()),
    waitForTimeout: vi.fn(() => Promise.resolve()),
    waitForLoadState: vi.fn(() => Promise.resolve()),
    evaluate: vi.fn(() => Promise.resolve(evaluateResult)),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(() => Promise.resolve()),
        fill: vi.fn(() => Promise.resolve()),
        count: vi.fn(() => Promise.resolve(0)),
        waitFor: vi.fn(() => Promise.resolve()),
      })),
      count: vi.fn(() => Promise.resolve(0)),
    })),
    keyboard: { type: vi.fn(() => Promise.resolve()), press: vi.fn(() => Promise.resolve()) },
    mouse: { wheel: vi.fn(() => Promise.resolve()), move: vi.fn() },
    close: vi.fn(),
  };
}

function createMockCtx(page?: ReturnType<typeof createMockPage>) {
  return {
    page,
    cdpEndpoint: 'http://localhost:9221',
    sessionId: 'test-session',
    storage: { set: vi.fn(), get: vi.fn(() => null), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() },
    waitForHuman: vi.fn(() => Promise.resolve({ solved: true })),
  };
}

const ALL_COMMANDS = ['search', 'trending'];

describe('pixiv plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name pixiv', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'pixiv' }));
  });

  it('should register 2 commands', () => {
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

  describe('search command', () => {
    it('should throw when no page', async () => {
      const handler = getHandler('search');
      const ctx = createMockCtx(undefined);
      await expect(handler({ query: 'test', limit: 10 }, ctx)).rejects.toThrow('需要浏览器页面');
    });

    it('should return results from evaluate', async () => {
      const handler = getHandler('search');
      const page = createMockPage([
        { title: 'イラスト', author: '作者', likes: '1000', link: 'https://www.pixiv.net/artworks/1', image: '', width: 800, height: 600 },
      ]);
      const ctx = createMockCtx(page);
      const result = await handler({ query: 'test', limit: 10 }, ctx) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      expect(data.query).toBe('test');
      expect((data.results as unknown[])).toHaveLength(1);
    });

    it('should return fail on error', async () => {
      const handler = getHandler('search');
      const page = createMockPage();
      page.goto = vi.fn(() => Promise.reject(new Error('navigate failed')));
      const ctx = createMockCtx(page);
      const result = await handler({ query: 'test', limit: 10 }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  describe('trending command', () => {
    it('should throw when no page', async () => {
      const handler = getHandler('trending');
      const ctx = createMockCtx(undefined);
      await expect(handler({ mode: 'daily', limit: 10 }, ctx)).rejects.toThrow('需要浏览器页面');
    });

    it('should return results from evaluate', async () => {
      const handler = getHandler('trending');
      const page = createMockPage([
        { title: '作品1', author: '画师', rank: 1, link: 'https://www.pixiv.net/artworks/1', image: '' },
      ]);
      const ctx = createMockCtx(page);
      const result = await handler({ mode: 'weekly', limit: 10 }, ctx) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      expect(data.mode).toBe('weekly');
      expect((data.results as unknown[])).toHaveLength(1);
      expect(page.goto).toHaveBeenCalled();
    });

    it('should return fail on error', async () => {
      const handler = getHandler('trending');
      const page = createMockPage();
      page.goto = vi.fn(() => Promise.reject(new Error('navigate failed')));
      const ctx = createMockCtx(page);
      const result = await handler({ mode: 'daily', limit: 10 }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });
});
