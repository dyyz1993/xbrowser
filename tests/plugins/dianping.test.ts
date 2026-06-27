import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/dianping/index.ts';

// —— mock XCLIAPI 三件套（参考 devto.test.ts）——
const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): Function {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1].handler;
}

function createMockPage() {
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    waitForLoadState: vi.fn(),
    // search 命令依赖 evaluate 返回抓取结果数组
    evaluate: vi.fn(() =>
      Promise.resolve([
        { rank: 1, name: '海底捞(朝阳店)', reviews: '1.2万条评价', price: '¥150/人', url: '/shop/123' },
        { rank: 2, name: '小龙坎', reviews: '8000条评价', price: '¥90/人', url: '/shop/456' },
      ])
    ),
    locator: vi.fn(),
    fill: vi.fn(),
    click: vi.fn(),
    url: vi.fn(() => 'https://www.dianping.com/'),
    keyboard: { insertText: vi.fn(), press: vi.fn() },
    mouse: { wheel: vi.fn(() => Promise.resolve()), move: vi.fn(() => Promise.resolve()) },
  };
}

function createMockCtx(page?: ReturnType<typeof createMockPage>) {
  return {
    page,
    storage: {
      set: vi.fn(), get: vi.fn(() => null), delete: vi.fn(),
      keys: vi.fn(() => []), clear: vi.fn(),
    },
  };
}

describe('dianping plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  // ——— L1 注册 ———
  it('should create site with name dianping', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'dianping' })
    );
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://www.dianping.com' })
    );
  });

  it('should register 1 command', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(1);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(['search']);
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

  // ——— L2 无页防御 ———
  describe('search command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('search');
      const ctx = createMockCtx(); // 无 page
      await expect(
        handler({ keyword: '火锅', cityId: 10, limit: 20 }, ctx)
      ).rejects.toThrow('需要浏览器页面');
    });

    // ——— L3 关键路径 ———
    it('should navigate to dianping search url with keyword and cityId', async () => {
      const handler = getHandler('search');
      const page = createMockPage();
      await handler({ keyword: '火锅', cityId: 10, limit: 20 }, createMockCtx(page));
      expect(page.goto).toHaveBeenCalledWith(
        expect.stringContaining('dianping.com/search/keyword/10/0_'),
        expect.objectContaining({ waitUntil: 'networkidle' })
      );
      const gotoUrl = String(page.goto.mock.calls[0][0]);
      expect(gotoUrl).toContain(encodeURIComponent('火锅'));
    });

    it('should return mapped shop results from page.evaluate', async () => {
      const handler = getHandler('search');
      const page = createMockPage();
      const result = await handler(
        { keyword: '火锅', cityId: 10, limit: 20 },
        createMockCtx(page)
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toMatchObject({
        rank: 1,
        name: '海底捞(朝阳店)',
        reviews: '1.2万条评价',
        price: '¥150/人',
      });
    });

    it('should respect the limit parameter', async () => {
      const handler = getHandler('search');
      const page = createMockPage();
      const result = await handler(
        { keyword: '火锅', cityId: 10, limit: 1 },
        createMockCtx(page)
      );
      // evaluate 返回 2 条，limit=1 应截断到 1 条
      expect(result.data).toHaveLength(1);
    });

    it('should fail when no shops found', async () => {
      const handler = getHandler('search');
      const page = createMockPage();
      page.evaluate = vi.fn(() => Promise.resolve([]));
      const result = await handler(
        { keyword: '不存在的店', cityId: 10, limit: 20 },
        createMockCtx(page)
      );
      expect(result.success).toBe(false);
    });
  });
});
