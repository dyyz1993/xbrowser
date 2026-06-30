import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/eastmoney/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

function createMockPage(evaluateResult: unknown = {}) {
  return {
    url: vi.fn(() => 'https://www.eastmoney.com'),
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

const ALL_COMMANDS = ['stock', 'news'];

describe('eastmoney plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name eastmoney', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'eastmoney' }));
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

  describe('stock command', () => {
    it('should throw when no page', async () => {
      const handler = getHandler('stock');
      const ctx = createMockCtx(undefined);
      await expect(handler({ symbol: '600519' }, ctx)).rejects.toThrow('需要浏览器页面');
    });

    it('should return stock data from evaluate', async () => {
      const handler = getHandler('stock');
      const mockData = { symbol: '600519', name: '贵州茅台', current: '1800.00', changePercent: '+2.5%', high: '1810.00', low: '1790.00', open: '1795.00', volume: '10000', amount: '18亿' };
      const page = createMockPage(mockData);
      const ctx = createMockCtx(page);
      const result = await handler({ symbol: '600519' }, ctx) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      expect(data.name).toBe('贵州茅台');
      expect(data.current).toBe('1800.00');
      expect(page.goto).toHaveBeenCalled();
    });
  });

  describe('news command', () => {
    it('should throw when no page', async () => {
      const handler = getHandler('news');
      const ctx = createMockCtx(undefined);
      await expect(handler({ limit: 10 }, ctx)).rejects.toThrow('需要浏览器页面');
    });

    it('should return news from evaluate', async () => {
      const handler = getHandler('news');
      const page = createMockPage([
        { title: '财经新闻1', summary: '摘要', date: '2026-06-30', link: 'https://www.eastmoney.com/news/1' },
      ]);
      const ctx = createMockCtx(page);
      const result = await handler({ limit: 10 }, ctx) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      expect((data.results as unknown[])).toHaveLength(1);
      expect(page.goto).toHaveBeenCalled();
    });
  });
});
