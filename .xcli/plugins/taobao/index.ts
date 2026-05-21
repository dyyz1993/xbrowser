import { z } from 'zod';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page, Response } from 'playwright';

interface BrowserCtx extends CommandContext {
  page?: Page;
  cdpEndpoint?: string;
  sessionId?: string;
}

interface Interceptor {
  items: () => Record<string, unknown>[];
  dispose: () => void;
}

function getPage(ctx: CommandContext): Page {
  const page = (ctx as BrowserCtx).page;
  if (!page) throw new Error('需要浏览器页面');
  return page;
}

function requireCdp(ctx: CommandContext): string | null {
  const browserCtx = ctx as BrowserCtx;
  return browserCtx.cdpEndpoint || null;
}

function buildCtxTips(ctx: CommandContext): { tips: string[]; hasCdp: boolean } {
  const browserCtx = ctx as BrowserCtx;
  const tips: string[] = [];
  const hasCdp = !!browserCtx.cdpEndpoint;
  tips.push(`Session: ${browserCtx.sessionId || 'default'}`);
  return { tips, hasCdp };
}

function cdpRequiredResponse(missingTips: string[]): {
  data: null;
  tips: string[];
  message: string;
} {
  return fail('未检测到 CDP 连接，淘宝功能需要登录态才能使用', [
      ...missingTips,
      '请使用 --cdp 9221 连接到已登录的 Chrome 浏览器',
      '确保 Chrome 浏览器已打开并登录淘宝',
    ]);
}

function interceptApi(
  page: Page,
  urlPattern: string,
  dataKey: string,
  idKey: string,
): Interceptor {
  const collected: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();

  const handler = async (response: Response) => {
    if (!response.url().includes(urlPattern)) return;
    try {
      const json = await response.json();
      const data = (json as Record<string, unknown>)?.data;
      const container = data ? (data as Record<string, unknown>)[dataKey] : (json as Record<string, unknown>)?.[dataKey];
      const list = Array.isArray(container) ? container : [];
      for (const item of list) {
        const id = String((item as Record<string, unknown>)?.[idKey] ?? '');
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        collected.push(item as Record<string, unknown>);
      }
    } catch {
      if (process.env.DEBUG) {
        console.warn('[taobao] Failed to parse API response');
      }
    }
  };

  page.on('response', handler);
  return {
    items: () => collected,
    dispose: () => page.off('response', handler),
  };
}

async function interceptFirstMatch(
  page: Page,
  urlPattern: string,
  timeout = 10000,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      page.off('response', handler);
      resolve(null);
    }, timeout);

    const handler = async (response: Response) => {
      if (!response.url().includes(urlPattern)) return;
      try {
        const json = await response.json();
        clearTimeout(timer);
        page.off('response', handler);
        resolve(json as Record<string, unknown>);
      } catch {
        // ignore parse errors
      }
    };

    page.on('response', handler);
  });
}

async function checkLoginState(page: Page): Promise<boolean> {
  try {
    const cookies = await page.context().cookies(['.taobao.com']);
    const loginCookies = ['_m_h5_tk', 'cookie2', 'sgcookie', '_tb_token_'];
    const hasCookie = loginCookies.some((name) =>
      cookies.some((c) => c.name === name && c.value.length > 5),
    );
    if (hasCookie) return true;

    const nickVisible = await page
      .locator(
        '.site-nav-login-info-nick, [class*="nick"], [class*="userName"], a[href*="i.taobao.com"], .site-nav-user, [class*="member"]',
      )
      .first()
      .isVisible()
      .catch(() => false);
    return nickVisible;
  } catch {
    return false;
  }
}

async function dismissPopups(page: Page): Promise<void> {
  await page.evaluate(() => {
    document
      .querySelectorAll(
        '[class*="overlay"], [class*="modal"], [class*="close"], [class*="dialog"]',
      )
      .forEach((el) => {
        if (
          el instanceof HTMLElement &&
          (el.className.includes('close') ||
            el.className.includes('Close') ||
            el.className.includes('dialog-close'))
        ) {
          el.click();
        }
      });
  });
}

async function scrollAndCollect(
  page: Page,
  maxScrolls: number,
  getItemCount: () => number,
  opts: { delay?: number; staleThreshold?: number } = {},
): Promise<void> {
  const { delay = 2500, staleThreshold = 3 } = opts;
  let lastCount = getItemCount();
  let staleCount = 0;

  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(delay);
    const currentCount = getItemCount();
    if (currentCount === lastCount) {
      staleCount++;
      if (staleCount >= staleThreshold) break;
    } else {
      staleCount = 0;
      lastCount = currentCount;
    }
  }
}

const SORT_MAP: Record<string, string> = {
  default: '',
  'price-asc': '&sort=price-asc',
  'price-desc': '&sort=price-desc',
  sales: '&sort=sale-desc',
  rating: '&sort=credit',
  new: '&sort=newY',
};

const TB_SEARCH_API = 'h5api.m.taobao.com/h5/mtop.relationrecommend';
const TB_DETAIL_API = 'h5api.m.taobao.com/h5/mtop.taobao.detail';
const TB_RATE_API = 'h5api.m.taobao.com/h5/mtop.taobao.rate.detaillist';
const TB_SHOP_API = 'h5api.m.taobao.com/h5/mtop.taobao.shop';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'taobao',
    url: 'https://www.taobao.com',
    description: '淘宝 - 商品搜索、详情、店铺、评价与优惠券采集（需登录态）',
    requiresLogin: true,
  });

  site.command('login', {
    description: '登录淘宝（扫码 / 账号密码），支持登录态检测与状态保存',
    scope: 'browser',
    parameters: z.object({
      method: z
        .enum(['qrcode', 'password'])
        .optional()
        .default('qrcode')
        .describe('登录方式：qrcode=扫码, password=账号密码'),
    }),
    result: z.any(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips } = buildCtxTips(ctx);
      const cdp = requireCdp(ctx);

      if (!cdp) {
        return cdpRequiredResponse([
          '淘宝登录需要 CDP 连接',
          '请先用 --cdp 9221 连接到已打开淘宝的 Chrome',
        ]);
      }

      const alreadyLoggedIn = await checkLoginState(page);
      if (alreadyLoggedIn) {
        await ctx.storage.set('taobao_login', {
          loggedIn: true,
          at: Date.now(),
          method: params.method,
        });
        return ok({ loggedIn: true, message: '已经处于登录状态，无需重复登录' }, [...ctxTips, '淘宝已登录']);
      }

      await page.goto('https://login.taobao.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      if (params.method === 'password') {
        const loginTab = page.locator('text="密码登录", [class*="password-login"], a[href*="loginType=3"]').first();
        if (await loginTab.isVisible().catch(() => false)) {
          await loginTab.click();
          await page.waitForTimeout(1000);
        }
      }

      await ctx.waitForHuman?.({
        reason: `完成淘宝${params.method === 'qrcode' ? '扫码' : '账号密码'}登录`,
        timeout: 300,
      });

      await page.goto('https://www.taobao.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const loggedIn = await checkLoginState(page);

      if (loggedIn) {
        await ctx.storage.set('taobao_login', {
          loggedIn: true,
          at: Date.now(),
          method: params.method,
        });
      }

      return ok({ loggedIn, url: page.url() }, [
          ...ctxTips,
          loggedIn ? '淘宝登录成功' : '登录可能未完成，请检查页面',
        ]);
    },
  });

  site.command('search', {
    description: '搜索淘宝商品（DOM + 网络拦截双模式）',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().default(20),
      sort: z
        .enum(['default', 'price-asc', 'price-desc', 'sales', 'rating'])
        .optional()
        .default('default'),
      useApi: z
        .boolean()
        .optional()
        .default(true)
        .describe('启用网络拦截获取结构化数据'),
    }),
    examples: [
      {
        cmd: 'xbrowser taobao search --query "机械键盘"',
        description: '搜索机械键盘',
      },
      {
        cmd: 'xbrowser taobao search --query "机械键盘" --sort sales --limit 30',
        description: '按销量排序搜索',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips, hasCdp } = buildCtxTips(ctx);

      if (!hasCdp) {
        return cdpRequiredResponse([
          '淘宝搜索需要登录态',
          'CDP 连接可获取更完整的商品数据',
        ]);
      }

      let interceptor: Interceptor | null = null;
      try {
        if (params.useApi) {
          interceptor = interceptApi(page, TB_SEARCH_API, 'resultList', 'itemId');
        }

        const sortParam = SORT_MAP[params.sort] || '';
        const url = `https://s.taobao.com/search?q=${encodeURIComponent(params.query)}${sortParam}`;
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        await scrollAndCollect(page, 3, () =>
          interceptor ? interceptor.items().length : 0,
        );

        if (interceptor && interceptor.items().length > 0) {
          const apiItems = interceptor.items().slice(0, params.limit).map((raw) => ({
            itemId: String(raw.itemId || raw.id || ''),
            title: String(raw.title || raw.raw_title || ''),
            price: String(raw.view_price || raw.price || ''),
            sales: String(raw.view_sales || raw.sales || ''),
            shop: String(raw.shop_name || raw.nick || ''),
            location: String(raw.item_loc || raw.location || ''),
            link: String(raw.detail_url || raw.item_url || ''),
            imageUrl: String(raw.pic_url || ''),
          }));

          return ok({
              query: params.query,
              sort: params.sort,
              count: apiItems.length,
              source: 'api',
              results: apiItems,
            }, [...ctxTips, `[API]);
        }

        const results = await page.evaluate((limit) => {
          const items: Array<{
            title: string;
            price: string;
            shop: string;
            sales: string;
            location: string;
            link: string;
            imageUrl: string;
          }> = [];
          const cards = document.querySelectorAll(
            '[class*="ContentItem"], .items .item, [class*="Card"], [class*="content--"] [class*="item--"], [class*="feedItem"]',
          );
          cards.forEach((card, i) => {
            if (i >= limit) return;
            const titleEl = card.querySelector(
              '[class*="Title"] span, .title, a[title], [class*="title--"] span, [class*="title--"] a',
            );
            const priceEl = card.querySelector(
              '[class*="price"], .price, [class*="price--"], [class*="Price--"]',
            );
            const shopEl = card.querySelector(
              '[class*="shopName"], .shop, .shopName, [class*="shop--"], [class*="shopName--"]',
            );
            const salesEl = card.querySelector(
              '[class*="sellCount"], [class*="sales"], [class*="sellCount--"], [class*="Sales--"]',
            );
            const locationEl = card.querySelector(
              '[class*="location"], [class*="area"], [class*="itemLoc"]',
            );
            const linkEl = card.querySelector(
              'a[href*="item"], a[href*="detail"], a[href*="taobao.com/item"]',
            );
            const imgEl = card.querySelector(
              'img[class*="mainPic"], img[src*="img.alicdn"], [class*="image--"] img',
            );
            items.push({
              title: titleEl?.textContent?.trim() || '',
              price: priceEl?.textContent?.trim() || '',
              shop: shopEl?.textContent?.trim() || '',
              sales: salesEl?.textContent?.trim() || '',
              location: locationEl?.textContent?.trim() || '',
              link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
              imageUrl:
                imgEl instanceof HTMLImageElement
                  ? imgEl.src || imgEl.dataset.src || ''
                  : '',
            });
          });
          return items;
        }, params.limit);

        return ok({
            query: params.query,
            sort: params.sort,
            count: results.length,
            source: 'dom',
            results,
          }, [...ctxTips, `[DOM] 找到 ${results.length} 个商品`]);
      } finally {
        interceptor?.dispose();
      }
    },
  });

  site.command('search-advanced', {
    description: '淘宝高级搜索（支持价格区间、发货地等筛选）',
    scope: 'browser',
    parameters: z.object({
      keyword: z.string().describe('搜索关键词'),
      sort: z
        .enum(['default', 'price-asc', 'price-desc', 'sales', 'rating', 'new'])
        .optional()
        .default('default'),
      priceMin: z.number().optional().describe('最低价格'),
      priceMax: z.number().optional().describe('最高价格'),
      location: z.string().optional().describe('发货地筛选'),
      limit: z.number().optional().default(20),
      useApi: z.boolean().optional().default(true),
    }),
    examples: [
      {
        cmd: 'xbrowser taobao search-advanced --keyword "机械键盘" --priceMin 100 --priceMax 500 --sort sales',
        description: '搜索100-500元销量最高的机械键盘',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips, hasCdp } = buildCtxTips(ctx);

      if (!hasCdp) {
        return cdpRequiredResponse(['淘宝高级搜索需要登录态']);
      }

      let interceptor: Interceptor | null = null;
      try {
        if (params.useApi) {
          interceptor = interceptApi(page, TB_SEARCH_API, 'resultList', 'itemId');
        }

        const sortParam = SORT_MAP[params.sort] || '';
        const filterParts: string[] = [];
        if (params.priceMin !== undefined)
          filterParts.push(`filter_price_from=${params.priceMin}`);
        if (params.priceMax !== undefined)
          filterParts.push(`filter_price_to=${params.priceMax}`);
        if (params.location)
          filterParts.push(`filter_loc=${encodeURIComponent(params.location)}`);

        const filterStr = filterParts.length > 0 ? `&${filterParts.join('&')}` : '';
        const url = `https://s.taobao.com/search?q=${encodeURIComponent(params.keyword)}${sortParam}${filterStr}`;

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        await scrollAndCollect(page, 3, () =>
          interceptor ? interceptor.items().length : 0,
        );

        if (interceptor && interceptor.items().length > 0) {
          const apiItems = interceptor.items().slice(0, params.limit).map((raw) => ({
            itemId: String(raw.itemId || raw.id || ''),
            title: String(raw.title || raw.raw_title || ''),
            price: String(raw.view_price || raw.price || ''),
            sales: String(raw.view_sales || raw.sales || ''),
            shop: String(raw.shop_name || raw.nick || ''),
            location: String(raw.item_loc || raw.location || ''),
            link: String(raw.detail_url || raw.item_url || ''),
            imageUrl: String(raw.pic_url || ''),
          }));

          return ok({
              keyword: params.keyword,
              filters: {
                sort: params.sort,
                priceMin: params.priceMin,
                priceMax: params.priceMax,
                location: params.location,
              }, [
              ...ctxTips,
              `[API]);
        }

        const results = await page.evaluate((limit) => {
          const items: Array<Record<string, string>> = [];
          const cards = document.querySelectorAll(
            '[class*="ContentItem"], .items .item, [class*="Card"], [class*="content--"] [class*="item--"], [class*="feedItem"]',
          );
          cards.forEach((card, i) => {
            if (i >= limit) return;
            const titleEl = card.querySelector(
              '[class*="Title"] span, .title, a[title], [class*="title--"] span',
            );
            const priceEl = card.querySelector(
              '[class*="price"], .price, [class*="price--"]',
            );
            const shopEl = card.querySelector(
              '[class*="shopName"], .shop, .shopName, [class*="shopName--"]',
            );
            const salesEl = card.querySelector(
              '[class*="sellCount"], [class*="sales"], [class*="Sales--"]',
            );
            const locationEl = card.querySelector(
              '[class*="location"], [class*="area"], [class*="itemLoc"]',
            );
            const linkEl = card.querySelector(
              'a[href*="item"], a[href*="detail"]',
            );
            const imgEl = card.querySelector(
              'img[class*="mainPic"], img[src*="img.alicdn"]',
            );
            items.push({
              title: titleEl?.textContent?.trim() || '',
              price: priceEl?.textContent?.trim() || '',
              shop: shopEl?.textContent?.trim() || '',
              sales: salesEl?.textContent?.trim() || '',
              location: locationEl?.textContent?.trim() || '',
              link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
              imageUrl:
                imgEl instanceof HTMLImageElement
                  ? imgEl.src || imgEl.dataset.src || ''
                  : '',
            });
          });
          return items;
        }, params.limit);

        return ok({
            keyword: params.keyword,
            filters: {
              sort: params.sort,
              priceMin: params.priceMin,
              priceMax: params.priceMax,
              location: params.location,
            }, [
            ...ctxTips,
            `[DOM] 高级搜索找到 ${results.length} 个商品`,      } finally {
        interceptor?.dispose();
      }
    },
  });

  site.command('detail', {
    description: '获取淘宝商品详情（支持 URL 或商品 ID）',
    scope: 'browser',
    parameters: z.object({
      url: z.string().optional().describe('商品 URL'),
      itemId: z.string().optional().describe('商品 ID（与 url 二选一）'),
    }),
    examples: [
      {
        cmd: 'xbrowser taobao detail --url "https://item.taobao.com/xxx"',
        description: '通过 URL 获取商品详情',
      },
      {
        cmd: 'xbrowser taobao detail --itemId "12345678"',
        description: '通过商品 ID 获取详情',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips, hasCdp } = buildCtxTips(ctx);

      if (!hasCdp) {
        return cdpRequiredResponse(['商品详情需要登录态']);
      }

      const targetUrl =
        params.url ||
        (params.itemId
          ? `https://item.taobao.com/item.htm?id=${params.itemId}`
          : '');
      if (!targetUrl) {
        return ok(null, [...ctxTips, '请提供 url 或 itemId 参数']);
      }

      const interceptor = interceptApi(page, TB_DETAIL_API, 'detail', 'itemId');
      try {
        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        const apiData = interceptor.items()[0];
        if (apiData) {
          const detail = apiData as Record<string, unknown>;
          const skuBase = detail.skuBase as Record<string, unknown> | undefined;
          const skus = Array.isArray(skuBase?.skus)
            ? (skuBase!.skus as Record<string, unknown>[]).map((s) => ({
                skuId: String(s.skuId || ''),
                text: String(s.name || s.text || ''),
                price: String(s.price || ''),
              }))
            : [];
          const props = Array.isArray(detail.props)
            ? (detail.props as Record<string, unknown>[]).map((p) => ({
                name: String(p.name || ''),
                value: String(p.value || ''),
              }))
            : [];

          return ok({
              source: 'api',
              itemId: String(detail.itemId || params.itemId || ''),
              title: String(detail.title || ''),
              price: String(detail.price || ''),
              originalPrice: String(detail.originalPrice || detail.reservePrice || ''),
              sales: String(detail.totalSold || detail.sales || ''),
              shop: {
                name: String((detail.seller as Record<string, unknown>)?.shopName || ''),
                shopId: String((detail.seller as Record<string, unknown>)?.shopId || ''),
                rating: String((detail.seller as Record<string, unknown>)?.evaluates || ''),
              }, [
              ...ctxTips,
              `[API]);
        }

        const data = await page.evaluate(() => {
          const title =
            document.querySelector(
              '[class*="Title"] span, .tb-detail-hd h1, .item-title, [class*="title--"], h1[class*="title"]',
            )?.textContent?.trim() || '';
          const price =
            document.querySelector(
              '[class*="price"], .tb-rmb-num, [class*="Price--"], [class*="price--"]',
            )?.textContent?.trim() || '';
          const originalPrice =
            document.querySelector(
              '[class*="originalPrice"], [class*="del"], [class*="original--"]',
            )?.textContent?.trim() || '';
          const sales =
            document.querySelector(
              '[class*="sellCount"], [class*="sales"], [class*="sellCount--"], [class*="Sales--"]',
            )?.textContent?.trim() || '';
          const shop =
            document.querySelector(
              '[class*="shopName"], .shop-name, [class*="shop--"], [class*="shopName--"]',
            )?.textContent?.trim() || '';
          const location =
            document.querySelector(
              '[class*="location"], [class*="area"], [class*="ship"]',
            )?.textContent?.trim() || '';

          const images: string[] = [];
          document
            .querySelectorAll(
              '[class*="mainPic"] img, .tb-pic img, #J_ImgBooth, [class*="mainPic--"] img, [class*="image--"] img',
            )
            .forEach((img) => {
              const src =
                (img as HTMLImageElement).src ||
                (img as HTMLImageElement).dataset.src ||
                '';
              if (src) images.push(src);
            });

          const skus: Array<{ name: string; values: string[] }> = [];
          document
            .querySelectorAll(
              '[class*="skuItem"], .tb-sku-item, [class*="skuItem--"]',
            )
            .forEach((el) => {
              const name =
                el.querySelector('[class*="label"]')?.textContent?.trim() || '';
              const values = Array.from(
                el.querySelectorAll('[class*="value"], [class*="text"]'),
              ).map((v) => v.textContent?.trim() || '');
              if (name) skus.push({ name, values });
            });

          const specs: Record<string, string> = {};
          document
            .querySelectorAll(
              '[class*="attribute"], [class*="Attr--"], [class*="attributes-list"] li',
            )
            .forEach((el) => {
              const label =
                el.querySelector('[class*="label"], .name, [class*="label--"]')
                  ?.textContent?.trim() || '';
              const value =
                el.querySelector('[class*="value"], .val, [class*="value--"]')
                  ?.textContent?.trim() || '';
              if (label && value) specs[label] = value;
            });

          const promotions: string[] = [];
          document
            .querySelectorAll(
              '[class*="coupon"], [class*="promotion"], [class*="discount"], [class*="benefit"]',
            )
            .forEach((el) => {
              const text = el.textContent?.trim();
              if (text) promotions.push(text);
            });

          return {
            title,
            price,
            originalPrice,
            sales,
            shop,
            location,
            images,
            skus,
            specs,
            promotions,
          };
        });

        return ok({ source: 'dom', ...data }, [...ctxTips, `[DOM] 商品: ${data.title}`, `价格: ${data.price}`]);
      } finally {
        interceptor.dispose();
      }
    },
  });

  site.command('item-detail', {
    description: '获取商品完整详情（包含 SKU、评价统计、优惠信息）',
    scope: 'browser',
    parameters: z.object({
      itemId: z.string().describe('商品 ID'),
    }),
    examples: [
      {
        cmd: 'xbrowser taobao item-detail --itemId "12345678"',
        description: '获取商品完整详情',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips, hasCdp } = buildCtxTips(ctx);

      if (!hasCdp) {
        return cdpRequiredResponse(['商品完整详情需要登录态']);
      }

      const detailUrl = `https://item.taobao.com/item.htm?id=${params.itemId}`;
      const interceptor = interceptApi(page, TB_DETAIL_API, 'detail', 'itemId');

      try {
        await page.goto(detailUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForTimeout(4000);
        await dismissPopups(page);

        const apiRaw = interceptor.items()[0];
        if (apiRaw) {
          const d = apiRaw as Record<string, unknown>;
          const seller = (d.seller || {}) as Record<string, unknown>;
          const skuBase = (d.skuBase || {}) as Record<string, unknown>;
          const rateInfo = (d.rateInfo || {}) as Record<string, unknown>;

          const skuList = Array.isArray(skuBase.skus)
            ? (skuBase.skus as Record<string, unknown>[]).map((s) => ({
                skuId: String(s.skuId || ''),
                text: String(s.name || s.text || ''),
                price: String(s.price || ''),
                stock: String(s.stock || ''),
              }))
            : [];

          const propsList = Array.isArray(d.props)
            ? (d.props as Record<string, unknown>[]).map((p) => ({
                name: String(p.name || ''),
                value: String(p.value || ''),
              }))
            : [];

          const coupons: Array<{ title: string; amount: string; condition: string }> = [];
          const couponList = (d.couponInfo as Record<string, unknown>)?.coupons;
          if (Array.isArray(couponList)) {
            for (const c of couponList as Record<string, unknown>[]) {
              coupons.push({
                title: String(c.title || ''),
                amount: String(c.amount || ''),
                condition: String(c.condition || ''),
              });
            }
          }

          return ok({
              source: 'api',
              itemId: params.itemId,
              title: String(d.title || ''),
              price: String(d.price || ''),
              originalPrice: String(d.originalPrice || d.reservePrice || ''),
              sales: String(d.totalSold || ''),
              images: Array.isArray(d.images) ? (d.images as string[]) : [],
              skus: skuList,
              props: propsList,
              seller: {
                shopName: String(seller.shopName || ''),
                shopId: String(seller.shopId || ''),
                shopUrl: String(seller.shopUrl || ''),
                rating: String(seller.evaluates || ''),
                location: String(seller.location || ''),
              }, [
              ...ctxTips,
              `[API]);
        }

        const data = await page.evaluate(() => {
          const title =
            document.querySelector(
              '[class*="Title"] span, [class*="title--"], h1',
            )?.textContent?.trim() || '';
          const price =
            document.querySelector(
              '[class*="price"], [class*="Price--"]',
            )?.textContent?.trim() || '';
          const originalPrice =
            document.querySelector(
              '[class*="original"], [class*="del"], del',
            )?.textContent?.trim() || '';
          const sales =
            document.querySelector(
              '[class*="sellCount"], [class*="Sales--"]',
            )?.textContent?.trim() || '';
          const shopName =
            document.querySelector(
              '[class*="shopName"], [class*="shopName--"]',
            )?.textContent?.trim() || '';
          const location =
            document.querySelector(
              '[class*="location"], [class*="area"]',
            )?.textContent?.trim() || '';

          const images: string[] = [];
          document
            .querySelectorAll(
              '[class*="mainPic"] img, [class*="image--"] img, [class*="pic"] img',
            )
            .forEach((img) => {
              const src =
                (img as HTMLImageElement).src ||
                (img as HTMLImageElement).dataset.src ||
                '';
              if (src && src.includes('alicdn')) images.push(src);
            });

          const skus: Array<{ name: string; values: string[] }> = [];
          document
            .querySelectorAll(
              '[class*="skuItem"], [class*="skuItem--"], [class*="SKU"]',
            )
            .forEach((el) => {
              const name =
                el.querySelector('[class*="label"]')?.textContent?.trim() || '';
              const values = Array.from(
                el.querySelectorAll('[class*="value"] span, [class*="text"]'),
              ).map((v) => v.textContent?.trim() || '');
              if (name) skus.push({ name, values });
            });

          const rateCount =
            document.querySelector(
              '[class*="rateCount"], [class*="reviewCount"], [class*="Comment--"] span',
            )?.textContent?.trim() || '';

          const coupons: string[] = [];
          document
            .querySelectorAll(
              '[class*="coupon"], [class*="promotion"], [class*="benefit"], [class*="discount"]',
            )
            .forEach((el) => {
              const text = el.textContent?.trim();
              if (text && text.length < 100) coupons.push(text);
            });

          return {
            title,
            price,
            originalPrice,
            sales,
            shopName,
            location,
            images,
            skus,
            rateCount,
            coupons,
          };
        });

        return ok({ source: 'dom', itemId: params.itemId, ...data }, [
            ...ctxTips,
            `[DOM] 商品: ${data.title}`,      } finally {
        interceptor.dispose();
      }
    },
  });

  site.command('reviews', {
    description: '获取淘宝商品评价（支持类型筛选、追评、媒体筛选）',
    scope: 'browser',
    parameters: z.object({
      url: z.string().optional().describe('商品 URL'),
      itemId: z.string().optional().describe('商品 ID（与 url 二选一）'),
      limit: z.number().optional().default(20).describe('获取评价数量'),
      type: z
        .enum(['all', 'good', 'mid', 'bad', 'media', 'append'])
        .optional()
        .default('all')
        .describe('评价类型: all=全部, good=好评, mid=中评, bad=差评, media=有图/视频, append=追评'),
      sort: z
        .enum(['default', 'time'])
        .optional()
        .default('default')
        .describe('排序: default=推荐, time=按时间'),
    }),
    examples: [
      {
        cmd: 'xbrowser taobao reviews --itemId "12345678" --type bad --sort time --limit 10',
        description: '获取商品最新差评',
      },
      {
        cmd: 'xbrowser taobao reviews --url "https://item.taobao.com/xxx" --type media',
        description: '获取有图评价',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips, hasCdp } = buildCtxTips(ctx);

      if (!hasCdp) {
        return cdpRequiredResponse(['商品评价需要登录态']);
      }

      const targetUrl =
        params.url ||
        (params.itemId
          ? `https://item.taobao.com/item.htm?id=${params.itemId}`
          : '');
      if (!targetUrl) {
        return ok(null, [...ctxTips, '请提供 url 或 itemId 参数']);
      }

      const interceptor = interceptApi(page, TB_RATE_API, 'rateList', 'rateId');

      try {
        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForTimeout(3000);

        const reviewTab = page
          .locator(
            'a:has-text("评价"), [class*="rate"], [class*="review"], a[href*="review"], [data-spm*="rate"]',
          )
          .first();
        if (await reviewTab.isVisible().catch(() => false)) {
          await reviewTab.click();
          await page.waitForTimeout(2000);
        }

        if (params.type !== 'all') {
          const typeMap: Record<string, string> = {
            good: '好评',
            mid: '中评',
            bad: '差评',
            media: '有图',
            append: '追评',
          };
          const filterBtn = page
            .locator(
              `a:has-text("${typeMap[params.type]}"), [class*="filter"]:has-text("${typeMap[params.type]}"), [data-value*="${params.type}"], [class*="tag"]:has-text("${typeMap[params.type]}")`,
            )
            .first();
          if (await filterBtn.isVisible().catch(() => false)) {
            await filterBtn.click();
            await page.waitForTimeout(1500);
          }
        }

        await scrollAndCollect(page, 3, () => interceptor.items().length);

        if (interceptor.items().length > 0) {
          const apiReviews = interceptor.items().slice(0, params.limit).map((raw) => {
            const r = raw as Record<string, unknown>;
            const appendContent = r.appendContent as Record<string, unknown> | undefined;
            const images: string[] = [];
            const rawImages = r.images as unknown;
            if (Array.isArray(rawImages)) {
              for (const img of rawImages) {
                const url = typeof img === 'string' ? img : String((img as Record<string, unknown>)?.url || '');
                if (url) images.push(url);
              }
            }
            return {
              user: String(r.displayUserNick || r.userNick || ''),
              content: String(r.rateContent || r.content || ''),
              time: String(r.rateDate || r.createTime || ''),
              rating: String(r.auctionSku || ''),
              sku: String(r.skuInfo || ''),
              images,
              isAppend: !!appendContent,
              appendContent: appendContent
                ? String(appendContent.content || appendContent.appendContent || '')
                : '',
              appendTime: appendContent
                ? String(appendContent.appendTime || appendContent.createTime || '')
                : '',
            };
          });

          return ok({
              url: targetUrl,
              type: params.type,
              sort: params.sort,
              count: apiReviews.length,
              source: 'api',
              reviews: apiReviews,
            }, [...ctxTips, `[API]);
        }

        const reviews = await page.evaluate((limit) => {
          const items: Array<{
            user: string;
            content: string;
            time: string;
            rating: string;
            images: string[];
            sku: string;
            appendContent: string;
          }> = [];
          const cards = document.querySelectorAll(
            '[class*="rate-item"], [class*="review-item"], [class*="comment"], .tb-rate-item, [class*="Comment--"], [class*="comment--"]',
          );
          cards.forEach((card, i) => {
            if (i >= limit) return;
            const userEl = card.querySelector(
              '[class*="user"], [class*="nick"], .rate-user-info, [class*="author"]',
            );
            const contentEl = card.querySelector(
              '[class*="content"], .rate-content, [class*="text"], [class*="review-text"], .tb-rate-content',
            );
            const timeEl = card.querySelector(
              '[class*="date"], [class*="time"], .rate-date, [class*="publish"]',
            );
            const ratingEl = card.querySelector(
              '[class*="star"], [class*="score"], [class*="rate-score"]',
            );
            const skuEl = card.querySelector(
              '[class*="sku"], [class*="attr"], .rate-sku, [class*="spec"]',
            );
            const appendEl = card.querySelector(
              '[class*="append"], [class*="追加"]',
            );

            const images: string[] = [];
            card
              .querySelectorAll(
                'img[src*="img"], img[src*="callback"], [class*="image"] img',
              )
              .forEach((img) => {
                const src = (img as HTMLImageElement).src || '';
                if (src && !src.includes('avatar')) images.push(src);
              });

            items.push({
              user: userEl?.textContent?.trim() || '',
              content: contentEl?.textContent?.trim() || '',
              time: timeEl?.textContent?.trim() || '',
              rating: ratingEl?.textContent?.trim() || '',
              images,
              sku: skuEl?.textContent?.trim() || '',
              appendContent: appendEl?.textContent?.trim() || '',
            });
          });
          return items;
        }, params.limit);

        return ok({
            url: targetUrl,
            type: params.type,
            sort: params.sort,
            count: reviews.length,
            source: 'dom',
            reviews,
          }, [...ctxTips, `[DOM] 获取 ${reviews.length} 条评价`]);
      } finally {
        interceptor.dispose();
      }
    },
  });

  site.command('shop', {
    description: '获取淘宝店铺信息（支持店铺 URL 或 ID）',
    scope: 'browser',
    parameters: z.object({
      shopUrl: z.string().optional().describe('店铺 URL'),
      shopId: z.string().optional().describe('店铺 ID'),
    }),
    examples: [
      {
        cmd: 'xbrowser taobao shop --shopUrl "https://shop123456.taobao.com"',
        description: '获取店铺信息',
      },
      {
        cmd: 'xbrowser taobao shop --shopId "123456"',
        description: '通过店铺 ID 获取信息',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips, hasCdp } = buildCtxTips(ctx);

      if (!hasCdp) {
        return cdpRequiredResponse(['店铺信息需要登录态']);
      }

      const url =
        params.shopUrl ||
        (params.shopId
          ? `https://shop${params.shopId}.taobao.com`
          : 'https://i.taobao.com/my_shop.htm');

      const interceptor = interceptApi(page, TB_SHOP_API, 'shop', 'shopId');

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);

        const apiShop = interceptor.items()[0];
        if (apiShop) {
          const s = apiShop as Record<string, unknown>;
          return ok({
              source: 'api',
              name: String(s.shopName || s.title || ''),
              shopId: String(s.shopId || params.shopId || ''),
              description: String(s.shopDesc || s.description || ''),
              rating: String(s.shopScore || s.evaluates || ''),
              fans: String(s.fansCount || s.fans || ''),
              itemCount: String(s.itemCount || s.allItemCount || ''),
              location: String(s.shopLocation || s.location || ''),
              logo: String(s.shopLogo || s.picUrl || ''),
            }, [...ctxTips, `[API]);
        }

        const data = await page.evaluate(() => {
          const name =
            document.querySelector(
              '.shop-name, [class*="shopName"], [class*="shop-name"], h1[class*="shop"], .shop-title',
            )?.textContent?.trim() || '';
          const description =
            document.querySelector(
              '.shop-description, [class*="shopDesc"], [class*="shop-desc"], [class*="description"]',
            )?.textContent?.trim() || '';
          const rating =
            document.querySelector(
              '.shop-rate, [class*="rating"], [class*="score"], [class*="dsr"]',
            )?.textContent?.trim() || '';
          const fans =
            document.querySelector(
              '.shop-fans, [class*="fans"], [class*="follower"]',
            )?.textContent?.trim() || '';
          const items =
            document.querySelector(
              '.shop-items-count, [class*="itemCount"], [class*="items-count"]',
            )?.textContent?.trim() || '';
          const location =
            document.querySelector(
              '.shop-location, [class*="location"], [class*="area"]',
            )?.textContent?.trim() || '';
          const logo =
            document.querySelector(
              '.shop-logo img, [class*="logo"] img, [class*="avatar"] img',
            )?.getAttribute('src') || '';
          const categories: string[] = [];
          document
            .querySelectorAll(
              '[class*="category"] a, [class*="cat"] a, .shop-cate a',
            )
            .forEach((el) => {
              const text = el.textContent?.trim();
              if (text) categories.push(text);
            });

          return {
            name,
            description,
            rating,
            fans,
            items,
            location,
            logo,
            categories,
          };
        });

        return ok({ source: 'dom', ...data }, [
            ...ctxTips,
            `[DOM] 店铺: ${data.name}`,      } finally {
        interceptor.dispose();
      }
    },
  });

  site.command('seller-items', {
    description: '获取店铺商品列表',
    scope: 'browser',
    parameters: z.object({
      shopId: z.string().describe('店铺 ID'),
      category: z.string().optional().describe('分类名称'),
      sort: z
        .enum(['default', 'sales', 'price-asc', 'price-desc', 'new'])
        .optional()
        .default('default'),
      limit: z.number().optional().default(20),
    }),
    examples: [
      {
        cmd: 'xbrowser taobao seller-items --shopId "123456" --sort sales --limit 30',
        description: '获取店铺销量排序商品',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips, hasCdp } = buildCtxTips(ctx);

      if (!hasCdp) {
        return cdpRequiredResponse(['店铺商品列表需要登录态']);
      }

      const sortMap: Record<string, string> = {
        default: '',
        sales: '&sort=fs',
        'price-asc': '&sort=price-asc',
        'price-desc': '&sort=price-desc',
        new: '&sort=new',
      };

      let url = `https://shop${params.shopId}.taobao.com/search.htm${sortMap[params.sort] ? '?' + sortMap[params.sort].slice(1) : ''}`;
      if (params.category) {
        url += (url.includes('?') ? '&' : '?') + `keyword=${encodeURIComponent(params.category)}`;
      }

      let interceptor: Interceptor | null = null;
      try {
        interceptor = interceptApi(page, 'h5api.m.taobao.com/h5/mtop.taobao.shop', 'items', 'itemId');

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        await scrollAndCollect(page, 5, () =>
          interceptor ? interceptor.items().length : 0,
        );

        if (interceptor && interceptor.items().length > 0) {
          const apiItems = interceptor.items().slice(0, params.limit).map((raw) => ({
            itemId: String(raw.itemId || raw.id || ''),
            title: String(raw.title || ''),
            price: String(raw.price || ''),
            sales: String(raw.sold || raw.sales || ''),
            imageUrl: String(raw.picUrl || raw.image || ''),
          }));

          return ok({
              shopId: params.shopId,
              sort: params.sort,
              count: apiItems.length,
              source: 'api',
              results: apiItems,
            }, [...ctxTips, `[API]);
        }

        const results = await page.evaluate((limit) => {
          const items: Array<Record<string, string>> = [];
          const cards = document.querySelectorAll(
            '[class*="item"], .item, [class*="Item--"], [class*="goods"], [class*="product"]',
          );
          cards.forEach((card, i) => {
            if (i >= limit) return;
            const titleEl = card.querySelector(
              '[class*="title"], .title, a[title], [class*="name"]',
            );
            const priceEl = card.querySelector(
              '[class*="price"], .price, [class*="Price"]',
            );
            const salesEl = card.querySelector(
              '[class*="sales"], [class*="sold"], [class*="sellCount"]',
            );
            const linkEl = card.querySelector('a[href*="item"], a[href*="detail"]');
            const imgEl = card.querySelector('img');

            items.push({
              title: titleEl?.textContent?.trim() || '',
              price: priceEl?.textContent?.trim() || '',
              sales: salesEl?.textContent?.trim() || '',
              link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
              imageUrl:
                imgEl instanceof HTMLImageElement
                  ? imgEl.src || imgEl.dataset.src || ''
                  : '',
            });
          });
          return items;
        }, params.limit);

        return ok({
            shopId: params.shopId,
            sort: params.sort,
            count: results.length,
            source: 'dom',
            results,
          }, [...ctxTips, `[DOM] 店铺商品 ${results.length} 个`]);
      } finally {
        interceptor?.dispose();
      }
    },
  });

  site.command('coupons', {
    description: '获取商品优惠券信息',
    scope: 'browser',
    parameters: z.object({
      itemId: z.string().describe('商品 ID'),
    }),
    examples: [
      {
        cmd: 'xbrowser taobao coupons --itemId "12345678"',
        description: '获取商品优惠券',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips, hasCdp } = buildCtxTips(ctx);

      if (!hasCdp) {
        return cdpRequiredResponse(['优惠券信息需要登录态']);
      }

      const detailUrl = `https://item.taobao.com/item.htm?id=${params.itemId}`;
      const interceptor = interceptApi(page, TB_DETAIL_API, 'detail', 'itemId');

      try {
        await page.goto(detailUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForTimeout(4000);
        await dismissPopups(page);

        const apiRaw = interceptor.items()[0];
        if (apiRaw) {
          const d = apiRaw as Record<string, unknown>;
          const couponInfo = d.couponInfo as Record<string, unknown> | undefined;
          const coupons = Array.isArray(couponInfo?.coupons)
            ? (couponInfo!.coupons as Record<string, unknown>[]).map((c) => ({
                title: String(c.title || ''),
                amount: String(c.amount || ''),
                condition: String(c.condition || ''),
                startTime: String(c.startTime || ''),
                endTime: String(c.endTime || ''),
                link: String(c.link || ''),
              }))
            : [];

          const promotions: Array<{ title: string; type: string }> = [];
          const promoData = d.promotionInfo as Record<string, unknown> | undefined;
          if (Array.isArray(promoData?.promotions)) {
            for (const p of promoData!.promotions as Record<string, unknown>[]) {
              promotions.push({
                title: String(p.title || p.name || ''),
                type: String(p.type || ''),
              });
            }
          }

          return ok({
              source: 'api',
              itemId: params.itemId,
              coupons,
              promotions,
              title: String(d.title || ''),
            }, [
              ...ctxTips,
              `[API]);
        }

        await page.evaluate(() => {
          const couponTab = document.querySelector(
            '[class*="coupon"], [class*="promotions"], [class*="benefit"], a:has-text("优惠")',
          );
          if (couponTab instanceof HTMLElement) couponTab.click();
        });
        await page.waitForTimeout(1500);

        const data = await page.evaluate(() => {
          const coupons: Array<{ title: string; amount: string; condition: string }> = [];
          document
            .querySelectorAll(
              '[class*="coupon"], [class*="Coupon"], [class*="voucher"]',
            )
            .forEach((el) => {
              const amountEl = el.querySelector(
                '[class*="amount"], [class*="value"], [class*="price"]',
              );
              const conditionEl = el.querySelector(
                '[class*="condition"], [class*="threshold"], [class*="limit"]',
              );
              const titleEl = el.querySelector('[class*="title"], [class*="name"]');
              coupons.push({
                title: titleEl?.textContent?.trim() || '',
                amount: amountEl?.textContent?.trim() || '',
                condition: conditionEl?.textContent?.trim() || '',
              });
            });

          const promotions: string[] = [];
          document
            .querySelectorAll(
              '[class*="promotion"], [class*="benefit"], [class*="discount"], [class*="activity"]',
            )
            .forEach((el) => {
              const text = el.textContent?.trim();
              if (text && text.length < 100) promotions.push(text);
            });

          return { coupons, promotions };
        });

        return ok({ source: 'dom', itemId: params.itemId, ...data }, [
            ...ctxTips,
            `[DOM] 优惠券 ${data.coupons.length} 张`,      } finally {
        interceptor.dispose();
      }
    },
  });

  site.command('update-profile', {
    description: '更新淘宝店铺信息（卖家功能）',
    scope: 'browser',
    parameters: z.object({
      shopName: z.string().optional().describe('店铺名称'),
      description: z.string().optional().describe('店铺描述'),
      bulletin: z.string().optional().describe('店铺公告'),
    }),
    examples: [
      {
        cmd: 'xbrowser taobao update-profile --shopName "我的店铺" --description "优质商品"',
        description: '更新店铺信息',
      },
    ],
    result: z.any(),
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips, hasCdp } = buildCtxTips(ctx);

      if (!hasCdp) {
        return cdpRequiredResponse(['店铺管理需要登录态']);
      }

      const loggedIn = await checkLoginState(page);
      if (!loggedIn) {
        return ok({ updated: false }, [...ctxTips, '需要先登录淘宝，请使用 login 命令']);
      }

      await page.goto('https://shop.taobao.com/shop/set_shop_info.htm', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      if (params.shopName) {
        const nameInput = page
          .locator(
            '[name="shopName"], input[aria-label*="店铺名称"], input[placeholder*="店铺名"], #shop-name',
          )
          .first();
        if (await nameInput.isVisible().catch(() => false)) {
          await nameInput.fill(params.shopName);
        }
      }

      if (params.description) {
        const descInput = page
          .locator(
            '[name="description"], textarea[aria-label*="描述"], textarea[placeholder*="描述"], #shop-desc',
          )
          .first();
        if (await descInput.isVisible().catch(() => false)) {
          await descInput.fill(params.description);
        }
      }

      if (params.bulletin) {
        const bulletinInput = page
          .locator(
            '[name="bulletin"], textarea[aria-label*="公告"], textarea[placeholder*="公告"], #shop-bulletin',
          )
          .first();
        if (await bulletinInput.isVisible().catch(() => false)) {
          await bulletinInput.fill(params.bulletin);
        }
      }

      const submitBtn = page
        .locator(
          'button[type="submit"], button:has-text("保存"), button:has-text("提交"), input[type="submit"]',
        )
        .first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
      }

      return ok({ updated: true, shopName: params.shopName, url: page.url() }, [...ctxTips, '店铺信息已更新']);
    },
  });

  site.command('search-image', {
    description: '淘宝图片搜索',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().default(10),
      page: z.any().optional(),
      timeout: z.number().optional().default(20000),
    }),
    result: z.any(),
    handler: async (params, ctx) => {
      const page = (params.page as import('playwright').Page) || (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        await page.goto('https://s.taobao.com/search?q=' + encodeURIComponent(params.query), { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 800)); await page.waitForTimeout(600); }
        const results = await page.evaluate((limit) => {
          const imgs: Array<Record<string, unknown>> = [];
          document.querySelectorAll('img').forEach((img) => {
            if (imgs.length >= limit) return;
            const el = img as HTMLImageElement;
            const src = el.src || '';
            if (el.width < 80) return;
            if (!src.includes('taobaocdn') && !src.includes('img.alicdn')) return;
            imgs.push({
              title: el.alt || '', thumbnailUrl: src, sourceUrl: el.closest('a')?.href || '',
              originalUrl: src, width: el.naturalWidth || 0,
              height: el.naturalHeight || 0, format: 'jpg', sourceSite: 'taobao',
            });
          });
          return imgs;
        }, params.limit);
        return ok({ query: params.query, engine: 'taobao', results, total: results.length, timestamp: Date.now() }, [`淘宝 "${params.query}"，共 ${results.length} 张`]);
      } catch (error) { return { data: null, message: error instanceof Error ? error.message : '未知错误' }; }
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as Record<string, unknown>).page as
      | import('playwright').Page
      | undefined;
    if (!page) return;
    await page.goto('https://login.taobao.com/');
    await ctx.storage.set('taobao_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('taobao_login');
  });
}
