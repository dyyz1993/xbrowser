import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/taobao/index.ts';

const mockSite = {
  command: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

const mockXCLI = {
  createSite: vi.fn(() => mockSite),
};

function createMockPage(evaluateResult: unknown = {}) {
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    evaluate: vi.fn(() => evaluateResult),
    on: vi.fn(),
    off: vi.fn(),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(),
        fill: vi.fn(),
      })),
    })),
    context: vi.fn(() => ({
      cookies: vi.fn(() => Promise.resolve([])),
    })),
  };
}

describe('taobao plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'taobao',
        url: 'https://www.taobao.com',
        requiresLogin: true,
      })
    );
  });

  it('should register 10 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(11);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(
      expect.arrayContaining([
        'login',
        'search',
        'search-advanced',
        'detail',
        'item-detail',
        'reviews',
        'shop',
        'seller-items',
        'coupons',
        'update-profile',
      ])
    );
  });

  describe('search command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(
        handler({ query: 'keyboard', limit: 20, sort: 'default', useApi: true }, {})
      ).rejects.toThrow('需要浏览器页面');
    });

    it('should return cdp-required when no cdp endpoint', async () => {
      const items = [{ title: 'Keyboard', price: '¥99', shop: 'Shop1', sales: '1000', link: '' }];
      const mockPage = createMockPage(items);
      const result = await handler(
        { query: 'keyboard', limit: 20, sort: 'default', useApi: true },
        { page: mockPage }
      );
      expect(result.data).toBeNull();
      expect(result.message).toContain('CDP');
    });

    it('should return search results when cdp is available', async () => {
      const items = [{ title: 'Keyboard', price: '¥99', shop: 'Shop1', sales: '1000', link: '' }];
      const mockPage = createMockPage(items);
      const result = await handler(
        { query: 'keyboard', limit: 20, sort: 'default', useApi: true },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );
      expect(result.data.query).toBe('keyboard');
      expect(result.data.results).toHaveLength(1);
    });

    it('should construct correct URL with sort when cdp is available', async () => {
      const mockPage = createMockPage([]);
      await handler(
        { query: 'keyboard', limit: 20, sort: 'price-asc', useApi: false },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );
      expect(mockPage.goto).toHaveBeenCalledWith(
        expect.stringContaining('sort=price-asc'),
        expect.anything()
      );
    });
  });

  describe('detail command handler', () => {
    let handler: Function;
    beforeEach(() => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'detail');
      handler = call![1].handler;
    });

    it('should throw if no page', async () => {
      await expect(handler({ url: 'https://item.taobao.com/123' }, {})).rejects.toThrow(
        '需要浏览器页面'
      );
    });

    it('should return cdp-required when no cdp endpoint', async () => {
      const data = {
        title: 'Product',
        price: '¥99',
        sales: '1000',
        shop: 'Shop',
        images: ['img1'],
        specs: { color: 'red' },
      };
      const mockPage = createMockPage(data);
      const result = await handler({ url: 'https://item.taobao.com/123' }, { page: mockPage });
      expect(result.data).toBeNull();
      expect(result.message).toContain('CDP');
    });

    it('should return product detail when cdp is available', async () => {
      const data = {
        title: 'Product',
        price: '¥99',
        sales: '1000',
        shop: 'Shop',
        images: ['img1'],
        specs: { color: 'red' },
      };
      const mockPage = createMockPage(data);
      const result = await handler(
        { url: 'https://item.taobao.com/123' },
        { page: mockPage, cdpEndpoint: 'ws://localhost:9222' }
      );
      expect(result.data.title).toBe('Product');
      expect(result.data.images).toHaveLength(1);
    });
  });
});
