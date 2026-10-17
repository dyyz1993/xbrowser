import { beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../.xcli/plugins/goofish/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function createPage(itemsHtml = true) {
  const page = {
    goto: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    url: vi.fn(() => 'https://www.goofish.com/search?q=iphone'),
    evaluate: vi.fn(async (expression: string) => {
      if (expression.includes('target')) {
        return itemsHtml ? { x: 100, y: 80 } : null;
      }
      if (expression.includes('item?id=')) {
        return [{
          index: 1,
          itemId: '123',
          title: 'iPhone 15',
          img: 'https://img/example.jpg',
          href: 'https://www.goofish.com/item?id=123',
        }];
      }
      if (expression.includes('price')) {
        return { pageTitle: 'Item', price: '¥100' };
      }
      return 'Order Page';
    }),
    mouse: {
      move: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
    },
  };
  return page;
}

function handlerOf(name: string): (params: unknown, ctx: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return call[1].handler;
}

describe('goofish plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
  });

  it('registers search/detail/order and login hooks', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'goofish',
      requiresLogin: false,
    }));
    expect(mockSite.command.mock.calls.map((item: unknown[]) => item[0])).toEqual(['search', 'detail', 'order']);
    expect(mockSite.login).toHaveBeenCalledTimes(1);
    expect(mockSite.logout).toHaveBeenCalledTimes(1);
  });

  it('extracts items without changing sort by default', async () => {
    const page = createPage();
    const result = await handlerOf('search')({ keyword: 'iPhone', sort: 'default', limit: 5 }, { page });
    expect(page.mouse.move).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      keyword: 'iPhone',
      sortLabel: '综合',
      total: 1,
      items: [{ index: 1, itemId: '123', title: 'iPhone 15' }],
    });
  });

  it('hovers sort trigger then clicks the option', async () => {
    const page = createPage();
    const result = await handlerOf('search')({ keyword: 'iPhone', sort: 'latest', limit: 5 }, { page });
    expect(page.mouse.move).toHaveBeenCalledTimes(3);
    expect(page.mouse.click).toHaveBeenCalledWith(100, 80);
    expect(result.data).toMatchObject({ sortLabel: '最新', total: 1 });
  });

  it('fails clearly when sort trigger cannot be found', async () => {
    const page = createPage(false);
    const result = await handlerOf('search')({ keyword: 'iPhone', sort: 'latest', limit: 5 }, { page });
    expect(result.success).toBe(false);
    expect(result.message).toBe('找不到排序触发器「新发布」');
  });

  it('opens detail and reads price/title', async () => {
    const page = createPage();
    const result = await handlerOf('detail')({ itemId: '123' }, { page });
    expect(page.goto).toHaveBeenCalledWith('https://www.goofish.com/item?id=123', expect.anything());
    expect(result.data).toMatchObject({ itemId: '123', pageTitle: 'Item', price: '¥100' });
  });

  it('opens the order page without paying', async () => {
    const page = createPage();
    const result = await handlerOf('order')({ itemId: '123' }, { page });
    expect(page.goto).toHaveBeenCalledWith('https://www.goofish.com/create-order?itemId=123', expect.anything());
    expect(result.data).toMatchObject({ status: 'order_page_opened' });
  });
});
