/**
 * goofish plugin — 闲鱼（goofish.com）搜索与下单自动化
 *
 * 命令:
 *   goofish search --keyword "<词>" [--sort latest|price-asc|price-desc|default]
 *     搜索关键词并切换排序，返回搜索结果列表（含 itemId 用于后续 detail/order）
 *
 *   goofish detail --item-id <id>
 *     打开商品详情页
 *
 *   goofish order --item-id <id>
 *     触发下单流程（跳转到 create-order 页面）
 *
 * 用法:
 *   xbrowser goofish search --keyword "iPhone 15" --sort latest
 *   xbrowser goofish detail --item-id 123456
 *   xbrowser goofish order   --item-id 123456
 *
 * 实现要点（基于真实录制 session: hover-v6）:
 *   - 闲鱼排序区是 hover 触发的下拉菜单，需要先 hover 触发器（「新发布」）
 *     再点击下拉项（「最新」等）
 *   - 闲鱼的 data-spm-anchor-id 是动态生成的（每次刷新都变），不能写死
 *   - 用「文字定位」最稳（找 textContent === '最新' 的可见叶子元素）
 *   - 使用真实鼠标事件（mouse.move + mouse.click）避免 React 合成事件失效
 */
import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../../types.js';

/** 在页面上找文字匹配的可见叶子元素，返回中心坐标 */
async function findTextCenter(page: Page, text: string): Promise<{ x: number; y: number } | null> {
  // 用字符串表达式避免 page.evaluate(fn, args) 在 cdp-driver 下的参数传递坑
  const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const result = await page.evaluate<{ x: number; y: number } | null>(`
    (() => {
      const target = '${escaped}';
      const els = [...document.querySelectorAll('*')].filter((e) => {
        if (e.textContent?.trim() !== target) return false;
        if (e.offsetParent === null) return false;
        if (e.children.length > 0) return false;
        return true;
      });
      if (els.length === 0) return null;
      // 选最靠上靠左的（页面上方的排序 tab 优先）
      const sorted = els.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return (ra.y - rb.y) || (ra.x - rb.x);
      });
      const r = sorted[0].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()
  `);
  return result;
}

/** 用真实鼠标事件 hover 到指定坐标（CDP Firewall 友好）
 *
 * 注意：Chromium 的 Input.dispatchMouseEvent 在窗口失去焦点时可能不触发
 * React 的 onMouseEnter。如果调用方发现弹窗没浮现，可降级为 URL 参数排序
 *（闲鱼支持 ?sort= 等查询参数）或要求用户保持 Chrome 在前台。
 */
async function realHover(page: Page, x: number, y: number): Promise<void> {
  // 先移动到一个远离目标的位置，再移过来，确保触发 mouseenter
  await page.mouse.move(Math.max(0, x - 200), Math.max(0, y - 100));
  await page.waitForTimeout(200);
  // 分两步移动，模拟真实鼠标轨迹（React 的 onMouseEnter 会触发）
  await page.mouse.move(x - 30, y - 10);
  await page.waitForTimeout(100);
  await page.mouse.move(x, y);
  await page.waitForTimeout(800); // 等弹窗 CSS 过渡完成
}

/** 排序选项文字映射 */
const SORT_LABELS: Record<string, { trigger: string; option: string }> = {
  latest:    { trigger: '新发布', option: '最新' },
  '1d':      { trigger: '新发布', option: '1天内' },
  '3d':      { trigger: '新发布', option: '3天内' },
  '7d':      { trigger: '新发布', option: '7天内' },
  '14d':     { trigger: '新发布', option: '14天内' },
  'price-asc':  { trigger: '价格', option: '价格从低到高' },
  'price-desc': { trigger: '价格', option: '价格从高到低' },
};

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'goofish',
    url: 'https://www.goofish.com',
    description: '闲鱼（goofish.com）搜索与下单自动化',
    requiresLogin: false,
    // isLogin removed: 闲鱼的登录态检测复杂（cookie + 多种页面状态），
    // 让命令自己根据返回结果判断。未登录时页面会自动跳转到登录页。
  });

  /**
   * search — 搜索 + 切换排序
   */
  site.command('search', {
    description: '搜索闲鱼商品并切换排序',
    scope: 'page',
    loginRequired: 'none',
    parameters: z.object({
      keyword: z.string().min(1).describe('搜索关键词'),
      sort: z.enum(['default', 'latest', '1d', '3d', '7d', '14d', 'price-asc', 'price-desc'])
        .default('default')
        .describe('排序方式：default=综合, latest=最新, 1d/3d/7d/14d=时间内, price-asc/desc=价格'),
      limit: z.number().int().min(1).max(50).default(10).describe('返回结果数量'),
    }),
    result: z.object({
      keyword: z.string(),
      sort: z.string(),
      sortLabel: z.string(),
      url: z.string(),
      total: z.number(),
      items: z.array(z.object({
        index: z.number(),
        itemId: z.string(),
        title: z.string(),
        img: z.string(),
        href: z.string(),
      })),
    }).passthrough(),
    examples: [
      { cmd: 'xbrowser goofish search --keyword "iPhone 15"', description: '搜索 iPhone 15（综合排序）' },
      { cmd: 'xbrowser goofish search --keyword "iPhone 15" --sort latest', description: '搜索并按最新排序' },
      { cmd: 'xbrowser goofish search --keyword "相机" --sort price-asc', description: '搜索相机并按价格升序' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as Page | undefined;
      if (!page) return fail('需要浏览器页面');

      // 1. 打开搜索结果页
      const searchUrl = `https://www.goofish.com/search?q=${encodeURIComponent(params.keyword)}`;
      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {
        return fail(`打开搜索页失败: ${String(e)}`);
      }
      await page.waitForTimeout(3000); // 等结果渲染

      // 2. 切换排序（如果非 default）
      if (params.sort !== 'default') {
        const sortInfo = SORT_LABELS[params.sort];
        if (!sortInfo) {
          return fail(`不支持的排序方式: ${params.sort}`);
        }
        // 2a. 找触发器位置（「新发布」/「价格」），用真实 hover 触发下拉
        const triggerPos = await findTextCenter(page, sortInfo.trigger);
        if (!triggerPos) {
          return fail(`找不到排序触发器「${sortInfo.trigger}」`);
        }
        await realHover(page, triggerPos.x, triggerPos.y);

        // 2b. 找弹窗里的目标选项并点击
        const optionPos = await findTextCenter(page, sortInfo.option);
        if (!optionPos) {
          return fail(`排序弹窗里找不到「${sortInfo.option}」`);
        }
        await page.mouse.click(optionPos.x, optionPos.y);
        await page.waitForTimeout(2000); // 等结果刷新
      }

      // 3. 抓取搜索结果列表
      const limit = params.limit;
      let items: Array<{ index: number; itemId: string; title: string; img: string; href: string }> = [];
      try {
        // 用字符串表达式避免 page.evaluate(fn, args) 在 cdp-driver 下的参数传递坑
        const expr = `
          (() => {
            const limit = ${limit};
            const cards = [...document.querySelectorAll('a[href*="item?id="]')]
              .filter((el) => {
                const rect = el.getBoundingClientRect();
                return rect.width > 50 && rect.height > 50;
              })
              .filter((el, idx, arr) => {
                const href = el.getAttribute('href') || '';
                return arr.findIndex((e) => (e.getAttribute('href') || '') === href) === idx;
              });
            return cards.slice(0, limit).map((el, idx) => {
              const href = el.getAttribute('href') || '';
              const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
              const img = el.querySelector('img');
              const itemIdMatch = href.match(/item\\?id=(\\d+)/);
              return {
                index: idx + 1,
                itemId: itemIdMatch ? itemIdMatch[1] : '',
                title: text.slice(0, 120),
                img: img ? (img.getAttribute('src') || '').slice(0, 200) : '',
                href: href.startsWith('http') ? href : 'https://www.goofish.com' + href,
              };
            });
          })()
        `;
        const raw = await page.evaluate<unknown>(expr);
        if (Array.isArray(raw)) {
          items = raw as typeof items;
        }
      } catch (e) {
        return fail(`抓取搜索结果失败: ${String(e)}`);
      }

      const sortLabel = params.sort === 'default' ? '综合' : SORT_LABELS[params.sort].option;
      return ok(
        {
          keyword: params.keyword,
          sort: params.sort,
          sortLabel,
          url: page.url(),
          total: items.length,
          items,
        },
        [`已搜索「${params.keyword}」并按「${sortLabel}」排序，返回 ${items.length} 条结果`],
      );
    },
  });

  /**
   * detail — 打开商品详情页
   */
  site.command('detail', {
    description: '打开闲鱼商品详情页',
    scope: 'page',
    loginRequired: 'none',
    parameters: z.object({
      itemId: z.string().min(1).describe('商品 ID'),
    }),
    result: z.object({
      itemId: z.string(),
      url: z.string(),
      pageTitle: z.string(),
      price: z.string().optional(),
    }).passthrough(),
    examples: [
      { cmd: 'xbrowser goofish detail --item-id 123456789', description: '打开商品详情' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as Page | undefined;
      if (!page) return fail('需要浏览器页面');

      const url = `https://www.goofish.com/item?id=${encodeURIComponent(params.itemId)}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {
        return fail(`打开详情页失败: ${String(e)}`);
      }
      await page.waitForTimeout(3000);

      // 抓商品标题和价格
      const detail = await page.evaluate(`
        (() => {
          const priceEl = document.querySelector('[class*="price"]');
          return {
            pageTitle: document.title,
            price: priceEl ? (priceEl.textContent || '').trim().slice(0, 30) : '',
          };
        })()
      `);

      return ok(
        { itemId: params.itemId, url, ...detail },
        [`已打开商品 ${params.itemId} 的详情页`],
      );
    },
  });

  /**
   * order — 触发下单（打开 create-order 页面）
   *
   * 注意：实际付款需要人工干预（密码/指纹/扫码），本命令只负责跳转到下单页。
   */
  site.command('order', {
    description: '打开闲鱼下单页面（不含付款，需人工完成）',
    scope: 'page',
    loginRequired: 'none',
    parameters: z.object({
      itemId: z.string().min(1).describe('商品 ID'),
    }),
    result: z.object({
      itemId: z.string(),
      url: z.string(),
      pageTitle: z.string(),
      status: z.string(),
      hint: z.string(),
    }).passthrough(),
    examples: [
      { cmd: 'xbrowser goofish order --item-id 123456789', description: '打开商品下单页' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as Page | undefined;
      if (!page) return fail('需要浏览器页面');

      const url = `https://www.goofish.com/create-order?itemId=${encodeURIComponent(params.itemId)}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {
        return fail(`打开下单页失败: ${String(e)}`);
      }
      await page.waitForTimeout(3000);

      const pageTitle = await page.evaluate('document.title');

      return ok(
        {
          itemId: params.itemId,
          url,
          pageTitle,
          status: 'order_page_opened',
          hint: '下单页已打开，请在浏览器里完成付款（密码/指纹/扫码）',
        },
        [`已打开商品 ${params.itemId} 的下单页，请人工完成付款`],
      );
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as Record<string, unknown>).page as Page | undefined;
    if (!page) return;
    // 引导用户在 viewer 中扫码登录
    const waitForHuman = (ctx as Record<string, unknown>).waitForHuman as
      | ((opts: { reason: string; timeout?: number }) => Promise<{ solved: boolean }>)
      | undefined;
    if (waitForHuman) {
      await waitForHuman({ reason: '请在 viewer 中扫码或手动登录闲鱼', timeout: 120 });
    }
  });

  site.logout(async () => {
    // 闲鱼登出通过清 cookie 实现（不做复杂操作）
  });
}
