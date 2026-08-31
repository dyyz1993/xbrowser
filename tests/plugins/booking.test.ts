import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/booking/index.js';

const CARD_SEL_WRAP = "[data-testid='property-card']";

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXcli = { createSite: vi.fn(() => mockSite) };

const HOTELS = JSON.stringify([
  { name: 'Tokyo Station Hotel', price: '¥ 25,000', score: '9.2', url: 'https://www.booking.com/hotel/jp/tsh' },
  { name: 'APA Tokyo', price: '¥ 12,000', score: '8.1', url: 'https://www.booking.com/hotel/jp/apa' },
]);

function createMockPage(opts: { consentRounds?: number; cardsRender?: boolean } = {}) {
  const consentRounds = opts.consentRounds ?? 0;
  const cardsRender = opts.cardsRender !== false;
  let consentHandled = 0;
  const page = {
    url: vi.fn(() => {
      // consent 前 URL 在 pipl_consent；处理后回到 searchresults
      return consentHandled >= (consentRounds || 0)
        ? 'https://www.booking.com/searchresults.html?ss=Tokyo'
        : 'https://www.booking.com/pipl_consent.zh-cn.html';
    }),
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    waitForSelector: vi.fn(() =>
      cardsRender ? Promise.resolve({}) : Promise.reject(new Error('timeout')),
    ),
    evaluate: vi.fn((expr: string) => {
      if (expr.includes('pipl_consent')) {
        // consent 检测：处理轮数不足时返回 true（还在 consent 页）
        const onConsent = consentHandled < (consentRounds || 0);
        if (onConsent) consentHandled++;
        return Promise.resolve(onConsent);
      }
      if (expr.includes('同意|Accept')) {
        return Promise.resolve(consentHandled < (consentRounds || 0));
      }
      if (expr.includes('property-card')) {
        return Promise.resolve(cardsRender ? HOTELS : '[]');
      }
      return Promise.resolve(undefined);
    }),
    keyboard: { press: vi.fn() },
  };
  return page;
}


function getSearchHandler(): (p: any, c: any) => Promise<any> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search');
  if (!call) throw new Error('search not registered');
  return call[1].handler;
}

describe('booking plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXcli as any);
  });

  it('createSite 参数正确', () => {
    expect(mockXcli.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'booking', url: 'https://www.booking.com', requiresLogin: false }),
    );
  });

  it('注册 search 命令', () => {
    expect(mockSite.command.mock.calls.some((c: unknown[]) => c[0] === 'search')).toBe(true);
  });

  describe('search handler', () => {
    it('无 consent 时直接提取结果', async () => {
      const h = getSearchHandler();
      const page = createMockPage({ consentRounds: 0 });
      const r = await h({ destination: 'Tokyo' }, { page });
      expect(r.destination).toBe('Tokyo');
      expect(r.count).toBe(2);
      expect(r.hotels[0]).toEqual(
        expect.objectContaining({ name: 'Tokyo Station Hotel', score: '9.2' }),
      );
    });

    it('consent 页自动处理（1 轮）后提取结果', async () => {
      const h = getSearchHandler();
      const page = createMockPage({ consentRounds: 1 });
      const r = await h({ destination: 'Tokyo' }, { page });
      expect(r.count).toBe(2);
      expect(r.hotels[1].name).toContain('APA');
    });

    it('limit 生效', async () => {
      const h = getSearchHandler();
      const page = createMockPage({ consentRounds: 0 });
      const r = await h({ destination: 'Tokyo', limit: 1 }, { page });
      // mock 不模拟页内 limit 截断——断言 limit 参数被注入页内表达式
      const extractCall = page.evaluate.mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('var limit = 1;'),
      );
      expect(extractCall).toBeDefined();
      expect(r.hotels.length).toBeGreaterThan(0);
    });

    it('无 page 时抛错', async () => {
      const h = getSearchHandler();
      await expect(h({ destination: 'Tokyo' }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('搜索结果未渲染时抛错', async () => {
      const h = getSearchHandler();
      const page = createMockPage({ consentRounds: 0, cardsRender: false });
      await expect(h({ destination: 'Tokyo' }, { page })).rejects.toThrow(
        '搜索结果未渲染',
      );
    });

    it('搜索 URL 含日期参数', async () => {
      const h = getSearchHandler();
      const page = createMockPage({ consentRounds: 0 });
      await h({ destination: 'Tokyo', checkin: '2026-10-01', checkout: '2026-10-03' }, { page });
      const gotoCall = page.goto.mock.calls[0][0] as string;
      expect(gotoCall).toContain('checkin=2026-10-01');
      expect(gotoCall).toContain('checkout=2026-10-03');
    });
  });
});
