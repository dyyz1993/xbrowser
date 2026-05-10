import { z } from 'zod';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import type { Page } from 'playwright';

interface BrowserCtx extends CommandContext {
  page?: Page;
  cdpEndpoint?: string;
  sessionId?: string;
}

function getPage(ctx: CommandContext): Page {
  const browserCtx = ctx as BrowserCtx;
  const page = browserCtx.page;
  if (!page) throw new Error('需要浏览器页面');
  return page;
}

function buildCtxTips(ctx: CommandContext): { tips: string[]; hasCdp: boolean } {
  const browserCtx = ctx as BrowserCtx;
  const tips: string[] = [];
  const hasCdp = !!browserCtx.cdpEndpoint;
  if (!hasCdp) {
    tips.push('建议使用 --cdp 9221 参数连接到 Chrome 浏览器');
  }
  tips.push(`Session: ${browserCtx.sessionId || 'default'}`);
  return { tips, hasCdp };
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'taobao',
    url: 'https://www.taobao.com',
    description: '淘宝 - 商品搜索、店铺信息与评价采集',
    requiresLogin: false,
  });

  site.command('login', {
    description: '登录淘宝（扫码 / 账号密码）',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser taobao login', description: '登录淘宝' }],
    handler: async (_params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips } = buildCtxTips(ctx);

      await page.goto('https://login.taobao.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      await ctx.waitForHuman?.({
        reason: '完成淘宝登录（扫码或账号密码）',
        timeout: 300,
      });

      await page.goto('https://www.taobao.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const loggedIn = await page
        .locator(
          '.site-nav-login-info-nick, [class*="nick"], [class*="userName"], a[href*="i.taobao.com"], .site-nav-user'
        )
        .first()
        .isVisible()
        .catch(() => false);

      await ctx.storage.set('taobao_login', { loggedIn, at: Date.now() });

      return {
        data: { loggedIn, url: page.url() },
        tips: [...ctxTips, loggedIn ? '淘宝登录成功' : '登录可能未完成，请检查页面'],
      };
    },
  });

  site.command('search', {
    description: '搜索淘宝商品',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().default(20),
      sort: z.enum(['default', 'price-asc', 'price-desc', 'sales']).optional().default('default'),
    }),
    examples: [
      { cmd: 'xbrowser taobao search --query "机械键盘"', description: '搜索机械键盘' },
    ],
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips } = buildCtxTips(ctx);

      const sortMap: Record<string, string> = {
        default: '',
        'price-asc': '&sort=price-asc',
        'price-desc': '&sort=price-desc',
        sales: '&sort=sale-desc',
      };
      const url = `https://s.taobao.com/search?q=${encodeURIComponent(params.query)}${sortMap[params.sort]}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);

      await page.evaluate(() => {
        document.querySelectorAll('[class*="overlay"], [class*="modal"], [class*="close"]').forEach((el) => {
          if (el instanceof HTMLElement && (el.className.includes('close') || el.className.includes('Close'))) {
            el.click();
          }
        });
      });

      const results = await page.evaluate((limit) => {
        const items: Array<{
          title: string;
          price: string;
          shop: string;
          sales: string;
          link: string;
        }> = [];
        const cards = document.querySelectorAll(
          '[class*="ContentItem"], .items .item, [class*="Card"], [class*="content--"] [class*="item--"], [class*="feedItem"]'
        );
        cards.forEach((card, i) => {
          if (i >= limit) return;
          const titleEl = card.querySelector(
            '[class*="Title"] span, .title, a[title], [class*="title--"] span, [class*="title--"] a'
          );
          const priceEl = card.querySelector(
            '[class*="price"], .price, [class*="price--"], [class*="Price--"]'
          );
          const shopEl = card.querySelector(
            '[class*="shopName"], .shop, .shopName, [class*="shop--"], [class*="shopName--"]'
          );
          const salesEl = card.querySelector(
            '[class*="sellCount"], [class*="sales"], [class*="sellCount--"], [class*="Sales--"]'
          );
          const linkEl = card.querySelector(
            'a[href*="item"], a[href*="detail"], a[href*="taobao.com/item"]'
          );
          items.push({
            title: titleEl?.textContent?.trim() || '',
            price: priceEl?.textContent?.trim() || '',
            shop: shopEl?.textContent?.trim() || '',
            sales: salesEl?.textContent?.trim() || '',
            link: linkEl instanceof HTMLAnchorElement ? linkEl.href : '',
          });
        });
        return items;
      }, params.limit);

      return {
        data: { query: params.query, sort: params.sort, count: results.length, results },
        tips: [...ctxTips, `找到 ${results.length} 个商品`],
      };
    },
  });

  site.command('detail', {
    description: '获取淘宝商品详情',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('商品 URL'),
    }),
    examples: [
      {
        cmd: 'xbrowser taobao detail --url "https://item.taobao.com/xxx"',
        description: '获取商品详情',
      },
    ],
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips } = buildCtxTips(ctx);

      await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);

      const data = await page.evaluate(() => {
        const title =
          document.querySelector(
            '[class*="Title"] span, .tb-detail-hd h1, .item-title, [class*="title--"], h1[class*="title"]'
          )?.textContent?.trim() || '';
        const price =
          document.querySelector(
            '[class*="price"], .tb-rmb-num, [class*="Price--"], [class*="price--"]'
          )?.textContent?.trim() || '';
        const sales =
          document.querySelector(
            '[class*="sellCount"], [class*="sales"], [class*="sellCount--"], [class*="Sales--"]'
          )?.textContent?.trim() || '';
        const shop =
          document.querySelector(
            '[class*="shopName"], .shop-name, [class*="shop--"], [class*="shopName--"]'
          )?.textContent?.trim() || '';

        const images: string[] = [];
        document
          .querySelectorAll(
            '[class*="mainPic"] img, .tb-pic img, #J_ImgBooth, [class*="mainPic--"] img, [class*="image--"] img'
          )
          .forEach((img) => {
            const src =
              (img as HTMLImageElement).src || (img as HTMLImageElement).dataset.src || '';
            if (src) images.push(src);
          });

        const specs: Record<string, string> = {};
        document
          .querySelectorAll(
            '[class*="skuItem"], .tb-sku-item, [class*="attribute"], [class*="skuItem--"], [class*="Attr--"]'
          )
          .forEach((el) => {
            const label =
              el.querySelector('[class*="label"], .name, [class*="label--"]')?.textContent?.trim() ||
              '';
            const value =
              el.querySelector('[class*="value"], .val, [class*="value--"]')?.textContent?.trim() ||
              '';
            if (label && value) specs[label] = value;
          });

        return { title, price, sales, shop, images, specs };
      });

      return {
        data,
        tips: [...ctxTips, `商品: ${data.title}`, `价格: ${data.price}`],
      };
    },
  });

  site.command('update-profile', {
    description: '更新淘宝店铺信息',
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
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips } = buildCtxTips(ctx);

      await page.goto('https://shop.taobao.com/shop/set_shop_info.htm', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const loginCheck = await page
        .locator('text="登录", [class*="login"], a[href*="login"]')
        .first()
        .isVisible()
        .catch(() => false);
      if (loginCheck) {
        return {
          data: { updated: false },
          tips: [...ctxTips, '需要先登录淘宝，请使用 login 命令'],
        };
      }

      if (params.shopName) {
        const nameInput = page.locator(
          '[name="shopName"], input[aria-label*="店铺名称"], input[placeholder*="店铺名"], #shop-name'
        ).first();
        if (await nameInput.isVisible().catch(() => false)) {
          await nameInput.fill(params.shopName);
        }
      }

      if (params.description) {
        const descInput = page.locator(
          '[name="description"], textarea[aria-label*="描述"], textarea[placeholder*="描述"], #shop-desc'
        ).first();
        if (await descInput.isVisible().catch(() => false)) {
          await descInput.fill(params.description);
        }
      }

      if (params.bulletin) {
        const bulletinInput = page.locator(
          '[name="bulletin"], textarea[aria-label*="公告"], textarea[placeholder*="公告"], #shop-bulletin'
        ).first();
        if (await bulletinInput.isVisible().catch(() => false)) {
          await bulletinInput.fill(params.bulletin);
        }
      }

      const submitBtn = page.locator(
        'button[type="submit"], button:has-text("保存"), button:has-text("提交"), input[type="submit"]'
      ).first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
      }

      return {
        data: {
          updated: true,
          shopName: params.shopName,
          url: page.url(),
        },
        tips: [...ctxTips, '店铺信息已更新'],
      };
    },
  });

  site.command('shop', {
    description: '获取淘宝店铺信息',
    scope: 'browser',
    parameters: z.object({
      shopUrl: z.string().optional().describe('店铺 URL，不填则获取自己的'),
    }),
    examples: [
      {
        cmd: 'xbrowser taobao shop --shopUrl "https://shop123456.taobao.com"',
        description: '获取店铺信息',
      },
    ],
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips } = buildCtxTips(ctx);

      const url = params.shopUrl || 'https://i.taobao.com/my_shop.htm';
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);

      const data = await page.evaluate(() => {
        const name =
          document.querySelector(
            '.shop-name, [class*="shopName"], [class*="shop-name"], h1[class*="shop"], .shop-title'
          )?.textContent?.trim() || '';
        const description =
          document.querySelector(
            '.shop-description, [class*="shopDesc"], [class*="shop-desc"], [class*="description"]'
          )?.textContent?.trim() || '';
        const rating =
          document.querySelector(
            '.shop-rate, [class*="rating"], [class*="score"], [class*="dsr"]'
          )?.textContent?.trim() || '';
        const fans =
          document.querySelector(
            '.shop-fans, [class*="fans"], [class*="follower"]'
          )?.textContent?.trim() || '';
        const items =
          document.querySelector(
            '.shop-items-count, [class*="itemCount"], [class*="items-count"]'
          )?.textContent?.trim() || '';
        const location =
          document.querySelector(
            '.shop-location, [class*="location"], [class*="area"]'
          )?.textContent?.trim() || '';
        const logo =
          document.querySelector(
            '.shop-logo img, [class*="logo"] img, [class*="avatar"] img'
          )?.getAttribute('src') || '';

        return { name, description, rating, fans, items, location, logo };
      });

      return {
        data,
        tips: [...ctxTips, `店铺: ${data.name}`, `商品数: ${data.items}`, `粉丝: ${data.fans}`],
      };
    },
  });

  site.command('reviews', {
    description: '获取淘宝商品评价',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('商品 URL'),
      limit: z.number().optional().default(20).describe('获取评价数量'),
      type: z.enum(['all', 'good', 'bad', 'media']).optional().default('all').describe('评价类型'),
    }),
    examples: [
      {
        cmd: 'xbrowser taobao reviews --url "https://item.taobao.com/xxx" --limit 10 --type good',
        description: '获取商品好评',
      },
    ],
    handler: async (params, ctx) => {
      const page = getPage(ctx);
      const { tips: ctxTips } = buildCtxTips(ctx);

      await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);

      const reviewTab = page.locator(
        'a:has-text("评价"), [class*="rate"], [class*="review"], a[href*="review"], [data-spm*="rate"]'
      ).first();
      if (await reviewTab.isVisible().catch(() => false)) {
        await reviewTab.click();
        await page.waitForTimeout(2000);
      }

      if (params.type !== 'all') {
        const typeMap: Record<string, string> = {
          good: '好评',
          bad: '差评',
          media: '有图',
        };
        const filterBtn = page.locator(
          `a:has-text("${typeMap[params.type]}"), [class*="filter"]:has-text("${typeMap[params.type]}"), [data-value*="${params.type}"]`
        ).first();
        if (await filterBtn.isVisible().catch(() => false)) {
          await filterBtn.click();
          await page.waitForTimeout(1500);
        }
      }

      const reviews = await page.evaluate((limit) => {
        const items: Array<{
          user: string;
          content: string;
          time: string;
          rating: string;
          images: string[];
          sku: string;
        }> = [];
        const cards = document.querySelectorAll(
          '[class*="rate-item"], [class*="review-item"], [class*="comment"], .tb-rate-item, [class*="Comment--"], [class*="comment--"]'
        );
        cards.forEach((card, i) => {
          if (i >= limit) return;
          const userEl = card.querySelector(
            '[class*="user"], [class*="nick"], .rate-user-info, [class*="author"]'
          );
          const contentEl = card.querySelector(
            '[class*="content"], .rate-content, [class*="text"], [class*="review-text"], .tb-rate-content'
          );
          const timeEl = card.querySelector(
            '[class*="date"], [class*="time"], .rate-date, [class*="publish"]'
          );
          const ratingEl = card.querySelector(
            '[class*="star"], [class*="score"], [class*="rate-score"]'
          );
          const skuEl = card.querySelector(
            '[class*="sku"], [class*="attr"], .rate-sku, [class*="spec"]'
          );

          const images: string[] = [];
          card.querySelectorAll('img[src*="img"], img[src*="callback"], [class*="image"] img').forEach((img) => {
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
          });
        });
        return items;
      }, params.limit);

      return {
        data: {
          url: params.url,
          type: params.type,
          count: reviews.length,
          reviews,
        },
        tips: [...ctxTips, `获取 ${reviews.length} 条评价`],
      };
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
    if (!page) return;
    await page.goto('https://login.taobao.com/');
    await ctx.storage.set('taobao_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('taobao_login');
  });
}
