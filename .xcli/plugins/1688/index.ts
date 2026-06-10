import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
/// <reference path="../types.d.ts" />
import type { Page, Response } from '../types.js';

interface BrowserCtx extends CommandContext {
  page?: Page;
  cdpEndpoint?: string;
  sessionId?: string;
}

function encodeURIComponentGBK(str: string): string {
   
  const iconv = require('iconv-lite') as { encode: (s: string, enc: string) => Buffer };
  const gbkBuf = iconv.encode(str, 'gbk');
  return Array.from(gbkBuf)
    .map((b: number) => '%' + b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

interface Interceptor {
  items: () => Record<string, unknown>[];
  dispose: () => void;
}

interface LoginState {
  isLoggedIn: boolean;
  loginId: string;
  userId: string;
  hasCdp: boolean;
}

interface ShopData {
  name: string;
  description: string;
  fansCount: string;
  founded: string;
  years: string;
  location: string;
  ratings: Array<{ label: string; score: string }>;
  mainProducts: string[];
  categories: Array<{ name: string; count: string; url: string }>;
  logo: string;
  returnRate: string;
  serviceScore: string;
  onTimeRate: string;
  goodRate: string;
  isFollowed: boolean;
  followBtnText: string;
  hasChat: boolean;
}

interface ProductDetailData {
  title: string;
  price: string;
  priceRange: string;
  minOrder: string;
  sales: string;
  specs: Array<{ name: string; values: string[] }>;
  images: string[];
  seller: string;
  sellerUrl: string;
  tags: string[];
  location: string;
  newPrice: string;
  estimatedPrice: string;
  wholesaleTiers: Array<{ range: string; price: string }>;
  skuInventory: Array<{ sku: string; price: string; stock: string }>;
  discountInfo: string[];
  deliveryPromise: string;
  shippingFee: string;
  returnPolicies: string[];
  repurchaseRate: string;
  aiScore: string;
  properties: Array<{ name: string; value: string }>;
  hasBuyBtn: boolean;
  hasCartBtn: boolean;
  hasCollectBtn: boolean;
  hasSampleBtn: boolean;
}

interface ProductItem {
  offerId: string;
  title: string;
  price: string;
  sales: string;
  imageUrl: string;
  detailUrl: string;
}

interface SearchProductItem extends ProductItem {
  seller: string;
}

interface CategoryItem {
  name: string;
  count: string;
  url: string;
  parentId: string;
  catId: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

async function detectLoginState(page: Page, hasCdp: boolean): Promise<LoginState> {
  try {
    const loginInfo = await page.evaluate(() => {
      const cookies = document.cookie;
      const isLoggedIn = cookies.includes('__cn_logon__=true');
      const loginId = (cookies.match(/__cn_logon_id__=([^;]+)/) || ['', ''])[1];
      const userId = (cookies.match(/unb=([^;]+)/) || ['', ''])[1];
      return { isLoggedIn, loginId, userId };
    }) as { isLoggedIn: boolean; loginId: string; userId: string };
    return { ...loginInfo, hasCdp };
  } catch {
    return { isLoggedIn: false, loginId: '', userId: '', hasCdp };
  }
}

function interceptApi(
  page: Page,
  urlPattern: string,
  dataKey: string,
  idKey: string,
  dataPath?: string,
): Interceptor {
  const collected: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();

  const handler = async (response: Response) => {
    const url = response.url();
    if (!url.includes(urlPattern)) return;

    if (process.env.DEBUG) {
      console.log('[1688] API response matched:', url.substring(0, 100));
    }

    try {
      const isJsonp = url.includes('dataType=jsonp');

      let json;
      if (isJsonp) {
        const text = await response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          if (process.env.DEBUG) {
            console.warn('[1688] No JSON found in JSONP response');
          }
          return;
        }
        json = JSON.parse(jsonMatch[0]);
      } else {
        json = await response.json();
      }

      let container;

      if (dataPath) {
        const pathParts = dataPath.split('.');
        container = json;
        for (const part of pathParts) {
          container = (container as Record<string, unknown>)?.[part];
        }
      } else {
        const data = (json as Record<string, unknown>)?.data;
        container = data
          ? (data as Record<string, unknown>)[dataKey]
          : (json as Record<string, unknown>)?.[dataKey];
      }

      if (process.env.DEBUG) {
        console.log('[1688] Container:', Array.isArray(container) ? `Array(${container.length})` : typeof container);
        if (!Array.isArray(container) && container) {
          console.log('[1688] Container keys:', Object.keys(container as Record<string, unknown>).join(', '));
        }
      }

      const list = Array.isArray(container) ? container : [];
      if (process.env.DEBUG && list.length > 0) {
        const firstItem = list[0] as Record<string, unknown>;
        console.log('[1688] First item keys:', Object.keys(firstItem).join(', '));
        console.log('[1688] Looking for idKey:', idKey);
      }
      for (const item of list) {
        const id = String((item as Record<string, unknown>)?.[idKey] ?? '');
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        collected.push(item as Record<string, unknown>);
      }

      if (process.env.DEBUG) {
        console.log('[1688] Collected items:', collected.length);
      }
    } catch (error) {
      if (process.env.DEBUG) {
        console.warn('[1688] Failed to parse API response:', error);
      }
    }
  };

  page.on('response', handler);
  return {
    items: () => collected,
    dispose: () => page.off('response', handler),
  };
}

async function dismissPopups(page: Page): Promise<void> {
  await page.evaluate(() => {
    document
      .querySelectorAll(
        '[class*="overlay"], [class*="modal"], [class*="close"], [class*="dialog"], [class*="login-guide"], [class*="download"]',
      )
      .forEach((el) => {
        if (
          el instanceof HTMLElement &&
          (el.className.includes('close') ||
            el.className.includes('Close') ||
            el.className.includes('dialog-close') ||
            el.className.includes('btn-close'))
        ) {
          el.click();
        }
      });
    const overlay = document.querySelector('[class*="mask"], [class*="overlay-bg"]');
    if (overlay instanceof HTMLElement) overlay.style.display = 'none';
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

function extractMemberId(url: string): string | null {
  const match = url.match(/https?:\/\/([a-zA-Z0-9_-]+)\.1688\.com/);
  return match ? match[1] : null;
}

function extractOfferId(url: string): string | null {
  const match = url.match(/\/offer\/(\d+)\.html/);
  return match ? match[1] : null;
}

const SORT_MAP: Record<string, string> = {
  default: '',
  sales: '&sortType=sale',
  'price-asc': '&sortType=price_asc',
  'price-desc': '&sortType=price_desc',
  new: '&sortType=new',
};

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: '1688',
    url: 'https://www.1688.com',
    description: '1688阿里巴巴 - 店铺信息、商品列表、商品详情、搜索采集',
    requiresLogin: true,
  });

  site.command('shop', {
    description: '获取1688店铺信息',
    scope: 'browser',
    result: z.object({
      source: z.string(), memberId: z.string(),
      name: z.string(), description: z.string(), fansCount: z.string(), founded: z.string(),
      years: z.string(), location: z.string(),
      ratings: z.array(z.object({ label: z.string(), score: z.string() })),
      mainProducts: z.array(z.string()), categories: z.array(z.object({
        name: z.string(), count: z.string(), url: z.string(),
      })), logo: z.string(),
      returnRate: z.string(), serviceScore: z.string(),
      onTimeRate: z.string(), goodRate: z.string(),
      isFollowed: z.boolean(), followBtnText: z.string(), hasChat: z.boolean(),
      loginState: z.object({ isLoggedIn: z.boolean(), loginId: z.string(), userId: z.string(), hasCdp: z.boolean() }).optional(),
      loginRequired: z.record(z.string(), z.boolean()).optional(),
    }).passthrough(),
    parameters: z.object({
      url: z.string().optional().describe('店铺 URL，如 https://ouyimei.1688.com/'),
      memberId: z.string().optional().describe('店铺 memberId（与 url 二选一）'),
    }),
    examples: [
      {
        cmd: 'xbrowser 1688 shop --url "https://ouyimei.1688.com/"',
        description: '获取欧艺美店铺信息',
      },
      {
        cmd: 'xbrowser 1688 shop --memberId "ouyimei"',
        description: '通过 memberId 获取店铺信息',
      },
    ],
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const { tips: ctxTips, hasCdp } = buildCtxTips(ctx);

      const memberId = params.memberId || (params.url ? extractMemberId(params.url) : null);
      if (!memberId) {
        return fail('参数错误', [...ctxTips, '请提供 url 或 memberId 参数']);
      }

      const shopUrl = `https://${memberId}.1688.com/`;

      try {
        await page.goto(shopUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForTimeout(8000);
        await dismissPopups(page);

        const data = await page.evaluate(() => {
          const bodyText = document.body.innerText || '';
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _bodyHtml = document.body.innerHTML || '';

          let name = '';
          const nameFromDom = document.querySelector('#pcMainCompanyNameV2, [id*="CompanyName"], [class*="company-name"], [class*="shop-name"]')?.textContent?.trim() || '';
          if (nameFromDom && nameFromDom.length > 2 && nameFromDom.length < 40) {
            name = nameFromDom;
          }
          if (!name) {
            const titleEl = document.querySelector('title');
            const titleText = titleEl?.textContent?.trim() || '';
            if (titleText && titleText !== '首页' && titleText.length > 2) {
              name = titleText.replace(/[-_|–\-].*/g, '').replace(/店铺推荐|全部商品|新品专区|店铺动态.*/g, '').trim();
            }
          }
          if (!name) {
            const nameMatch = bodyText.match(/([\u4e00-\u9fa5a-zA-Z0-9（）()]{4,40}?(?:工厂|公司|商行|经营部|工作室|(?:服装|贸易|科技|电子|五金|建材|食品|医药|机械|工贸)(?:厂|店)))(?:关注|·|\n|粉丝|$)/);
            name = nameMatch ? nameMatch[1].trim() : '';
          }

          const fansMatch = bodyText.match(/粉丝数[：:]\s*(\d+)\s*人/);
          const fansCount = fansMatch ? fansMatch[1] : '';

          const foundedMatch = bodyText.match(/成立时间[：:]\s*(\d{4}年\d{1,2}月\d{1,2}日)/);
          const founded = foundedMatch ? foundedMatch[1] : '';

          const locationMatch = bodyText.match(/地址[：:]\s*[中国\s]*([^\n\r]{5,50}?)(?:\n|$)/);
          const location = locationMatch ? locationMatch[1].trim() : '';

          const mainProductMatch = bodyText.match(/主营[：:]\s*([^\n\r]+)/);
          const mainProducts = mainProductMatch
            ? mainProductMatch[1].split(/[,，、]/).map((s: string) => s.trim()).filter(Boolean)
            : [];

          const ratings: Array<{ label: string; score: string }> = [];
          const ratingPatterns = [
            { label: '咨询体验', re: /咨询体验\s*([\d.]+)/ },
            { label: '物流体验', re: /物流体验\s*([\d.]+)/ },
            { label: '商品体验', re: /商品体验\s*([\d.]+)/ },
            { label: '售后体验', re: /售后体验\s*([\d.]+)/ },
          ];
          for (const { label, re } of ratingPatterns) {
            const m = bodyText.match(re);
            if (m) ratings.push({ label, score: m[1] });
          }

          const categories: Array<{ name: string; count: string; url: string }> = [];
          const seenCats = new Set<string>();
          const catBlacklist = ['查看', '更多', '推荐', '热销', 'TOP', '隐藏',
            '营业执照', '税务登记证', '组织机构代码证', '厂房外景', '常规设备',
            '办公', '营业', '税务', '厂房', '设备', '代码证', '登记证',
            '生产车间', '仓库实景', '质检报告', '资质证书', '荣誉证书'];
          function isCatBlacklisted(n: string): boolean {
            if (!n || n.length <= 1 || n.length >= 30) return true;
            if (/^[省市区县镇].{2,10}$/.test(n)) return true;
            return catBlacklist.some((b) => n.includes(b));
          }

          document.querySelectorAll('div[title]').forEach((el) => {
            const title = el.getAttribute('title') || '';
            const countMatch = title.match(/[（(](\d+)[）)]/);
            const catName = title.replace(/[（(]\d+[）)]/g, '').replace(/[>＞]/g, '').trim();
            if (!isCatBlacklisted(catName) && !seenCats.has(catName)) {
              seenCats.add(catName);
              const parentLink = el.closest('a');
              categories.push({
                name: catName,
                count: countMatch ? countMatch[1] : '',
                url: parentLink instanceof HTMLAnchorElement ? parentLink.href : '',
              });
            }
          });
          document.querySelectorAll('a').forEach((el) => {
            const anchor = el as HTMLAnchorElement;
            const href = anchor.href || '';
            if (!href.includes('offerlist')) return;
            let text = anchor.innerText?.trim() || anchor.getAttribute('title') || anchor.getAttribute('aria-label') || '';
            if (!text) {
              const img = anchor.querySelector('img');
              text = img?.getAttribute('alt') || '';
            }
            if (!text) return;
            const countMatch = text.match(/[（(](\d+)[）)]/);
            const catName = text.replace(/[（(]\d+[）)]/g, '').replace(/[>＞]/g, '').trim();
            if (!isCatBlacklisted(catName) && !seenCats.has(catName)) {
              seenCats.add(catName);
              categories.push({
                name: catName,
                count: countMatch ? countMatch[1] : '',
                url: href,
              });
            }
          });

          if (categories.length === 0) {
            const catRegex = /([^\n\r>]{2,25}?)[（(](\d+)[）)]/g;
            let catMatch;
            while ((catMatch = catRegex.exec(bodyText)) !== null) {
              const catName = catMatch[1].replace(/^[\s>]+/, '').trim();
              const catCount = catMatch[2];
              if (!isCatBlacklisted(catName) && !seenCats.has(catName)) {
                seenCats.add(catName);
                categories.push({ name: catName, count: catCount, url: '' });
              }
            }
          }

          const yearsMatch = bodyText.match(/(\d+)年/);
          const years = yearsMatch ? yearsMatch[1] : '';

          const descMatch = bodyText.match(/是.*?(?:企业|公司|工厂)[^\n\r]{10,200}/);
          const description = descMatch ? descMatch[0].trim() : '';

          const logo =
            document.querySelector('[class*="logo"] img, img[src*="img.alicdn.com"][width]')?.getAttribute('src') || '';

          const returnRateMatch = bodyText.match(/回头率\s*([\d.]+%)/);
          const returnRate = returnRateMatch ? returnRateMatch[1] : '';

          const serviceScoreMatch = bodyText.match(/服务分\s*([\d.]+)/);
          const serviceScore = serviceScoreMatch ? serviceScoreMatch[1] : '';

          const onTimeRateMatch = bodyText.match(/准时发货率\s*([\d.]+%)/);
          const onTimeRate = onTimeRateMatch ? onTimeRateMatch[1] : '';

          const goodRateMatch = bodyText.match(/好评率\s*([\d.]+%)/);
          const goodRate = goodRateMatch ? goodRateMatch[1] : '';

          const isFollowed = !!document.querySelector('[class*="followed"], [class*="已关注"]');
          const followBtnText = document.querySelector('[class*="follow"], [class*="关注"]')?.textContent?.trim() || '';

          const hasChat = !!document.querySelector('[class*="chat"], [class*="ww"], [class*="im"]');

          return {
            name,
            description,
            fansCount,
            founded,
            years,
            location,
            ratings,
            mainProducts,
            categories,
            logo,
            returnRate,
            serviceScore,
            onTimeRate,
            goodRate,
            isFollowed,
            followBtnText,
            hasChat,
          };
        }) as ShopData;

        const loginState = await detectLoginState(page, hasCdp);

        const loginRequired: Record<string, boolean> = {};
        if (loginState.isLoggedIn) {
          loginRequired.isFollowed = true;
          loginRequired.hasChat = true;
        }

        return ok({
            source: 'dom',
            memberId,
            ...data,
            ...(loginState.isLoggedIn ? { loginState, loginRequired } : {}),
          }, [
            ...ctxTips,
            `[DOM] 店铺: ${data.name}`,
            `粉丝: ${data.fansCount}`,
            `分类: ${data.categories.length} 个`,
            ...(loginState.isLoggedIn ? [`[登录] 用户: ${loginState.loginId}`] : ['[未登录] 部分数据需要登录获取']),
          ],
        );
      } catch (error) {
        return fail('参数错误', [
            ...ctxTips,
            `获取店铺信息失败: ${error instanceof Error ? error.message : '未知错误'}`,
          ]);
      }
    },
  });

  site.command('products', {
    description: '获取1688店铺商品列表',
    scope: 'browser',
    result: z.object({
      memberId: z.string(), sort: z.string(), count: z.number(), source: z.string(),
      results: z.array(z.object({
        offerId: z.string(), title: z.string(), price: z.string(),
        sales: z.string(), imageUrl: z.string(), detailUrl: z.string(),
      }).passthrough()),
    }),
    parameters: z.object({
      url: z.string().optional().describe('店铺 URL'),
      memberId: z.string().optional().describe('店铺 memberId（与 url 二选一）'),
      categoryId: z.string().optional().describe('分类 ID（格式: catId_parentCatId）'),
      limit: z.number().optional().default(20).describe('获取商品数量'),
      sort: z
        .enum(['default', 'sales', 'price-asc', 'price-desc', 'new'])
        .optional()
        .default('default')
        .describe('排序方式'),
    }),
    examples: [
      {
        cmd: 'xbrowser 1688 products --memberId "ouyimei" --limit 30',
        description: '获取欧艺美店铺商品列表',
      },
      {
        cmd: 'xbrowser 1688 products --memberId "ouyimei" --categoryId "205390121_205390120" --sort sales',
        description: '按销量获取分类商品',
      },
    ],
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const { tips: ctxTips } = buildCtxTips(ctx);

      const memberId = params.memberId || (params.url ? extractMemberId(params.url) : null);
      if (!memberId) {
        return fail('参数错误', [...ctxTips, '请提供 url 或 memberId 参数']);
      }

      let listUrl: string;
      if (params.categoryId) {
        listUrl = `https://${memberId}.1688.com/page/offerlist_${params.categoryId}.htm`;
      } else {
        listUrl = `https://${memberId}.1688.com/page/offerlist.htm`;
      }
      const sortParam = SORT_MAP[params.sort] || '';
      if (sortParam) {
        listUrl += (listUrl.includes('?') ? '&' : '?') + sortParam.slice(1);
      }

      let interceptor: Interceptor | null = null;
      try {
        interceptor = interceptApi(page, 'mtop.alibaba.alisite.cbu.server.moduleasyncservice', '', 'id', 'data.content.offerList');

        await page.goto(listUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForTimeout(3000);
        await dismissPopups(page);

        await scrollAndCollect(page, 5, () =>
          interceptor ? interceptor.items().length : 0,
        );

        if (interceptor && interceptor.items().length > 0) {
          const apiItems = interceptor.items().slice(0, params.limit).map((raw) => {
            const offerId = String(raw.id || raw.offerId || '');
            const offerImages = raw.offerImages as Array<{ imageURI?: string }> || [];
            const firstImage = offerImages[0]?.imageURI || '';

            return {
              offerId,
              title: String(raw.subject || raw.title || ''),
              price: String(raw.offerPrice || raw.price || ''),
              sales: String(raw.saleQuantity || raw.saleNum || raw.sales || ''),
              imageUrl: firstImage,
              detailUrl: offerId
                ? `https://detail.1688.com/offer/${offerId}.html`
                : '',
            };
          });

          return ok({
            memberId,
            sort: params.sort,
            count: apiItems.length,
            source: 'api',
            results: apiItems,
          }, [...ctxTips, `[API] 店铺商品 ${apiItems.length} 个`]);
        }

        const results = await page.evaluate((limit: number) => {
          const items: Array<{
            offerId: string;
            title: string;
            price: string;
            sales: string;
            imageUrl: string;
            detailUrl: string;
          }> = [];
          const cards = document.querySelectorAll(
            '[class*="offer-item"], [class*="offerItem"], [class*="item"], [class*="card"], [class*="product"], [class*="goods"]',
          );
          cards.forEach((card, i) => {
            if (i >= limit) return;

            const titleEl = card.querySelector(
              '[class*="title"], [class*="subject"], a[title], [class*="name"]',
            );
            const priceEl = card.querySelector(
              '[class*="price"], [class*="Price"]',
            );
            const salesEl = card.querySelector(
              '[class*="sale"], [class*="sold"], [class*="Sales"]',
            );
            const imgEl = card.querySelector(
              'img[src*="cbu"], img[src*="alicdn"], img[src*="1688"], [class*="image"] img, [class*="img"] img',
            );
            const linkEl = card.querySelector(
              'a[href*="detail.1688.com/offer"], a[href*="offer"]',
            );

            let offerId = '';
            let detailUrl = '';
            if (linkEl instanceof HTMLAnchorElement) {
              detailUrl = linkEl.href || '';
              const match = detailUrl.match(/\/offer\/(\d+)\.html/);
              if (match) offerId = match[1];
            }

            const title = titleEl?.textContent?.trim() || '';
            const price = priceEl?.textContent?.trim() || '';
            const sales = salesEl?.textContent?.trim() || '';
            const imageUrl =
              imgEl instanceof HTMLImageElement
                ? imgEl.src || imgEl.dataset.src || ''
                : '';

            if (title || price) {
              items.push({ offerId, title, price, sales, imageUrl, detailUrl });
            }
          });
          return items;
        }, params.limit) as ProductItem[];

        return ok({
          memberId,
          sort: params.sort,
          count: results.length,
          source: 'dom',
          results,
        }, [...ctxTips, '[DOM] 店铺商品 ' + results.length + ' 个']);
      } finally {
        interceptor?.dispose();
      }
    },
  });

  site.command('product-detail', {
    description: '获取1688商品详情',
    scope: 'browser',
    result: z.object({
      source: z.string(), offerId: z.string(),
      title: z.string(), price: z.string(), priceRange: z.string(),
      minOrder: z.string(), sales: z.string(),
      specs: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
      images: z.array(z.string()), seller: z.string(), sellerUrl: z.string(),
      tags: z.array(z.string()), location: z.string(),
      newPrice: z.string(), estimatedPrice: z.string(),
      wholesaleTiers: z.array(z.object({ range: z.string(), price: z.string() })),
      skuInventory: z.array(z.object({ sku: z.string(), price: z.string(), stock: z.string() })),
      discountInfo: z.array(z.string()), deliveryPromise: z.string(), shippingFee: z.string(),
      returnPolicies: z.array(z.string()), repurchaseRate: z.string(), aiScore: z.string(),
      properties: z.array(z.object({ name: z.string(), value: z.string() })),
      hasBuyBtn: z.boolean(), hasCartBtn: z.boolean(), hasCollectBtn: z.boolean(), hasSampleBtn: z.boolean(),
      loginState: z.object({ isLoggedIn: z.boolean(), loginId: z.string(), userId: z.string(), hasCdp: z.boolean() }).optional(),
      loginRequired: z.record(z.string(), z.boolean()).optional(),
    }).passthrough(),
    parameters: z.object({
      url: z.string().optional().describe('商品 URL'),
      offerId: z.string().optional().describe('商品 offerId（与 url 二选一）'),
    }),
    examples: [
      {
        cmd: 'xbrowser 1688 product-detail --offerId "1234567890"',
        description: '通过 offerId 获取商品详情',
      },
      {
        cmd: 'xbrowser 1688 product-detail --url "https://detail.1688.com/offer/1234567890.html"',
        description: '通过 URL 获取商品详情',
      },
    ],
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const { tips: ctxTips, hasCdp } = buildCtxTips(ctx);

      const targetUrl =
        params.url ||
        (params.offerId
          ? `https://detail.1688.com/offer/${params.offerId}.html`
          : '');
      if (!targetUrl) {
        return fail('参数错误', [...ctxTips, '请提供 url 或 offerId 参数']);
      }

      const offerId = params.offerId || extractOfferId(targetUrl) || '';

      try {
        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForTimeout(4000);
        await dismissPopups(page);

        const data = await page.evaluate(() => {
          const title =
            document.querySelector('[class*="offer-title"], [class*="detail-title"], h1[class*="title"]')?.textContent?.trim() ||
            document.querySelector('.offer-title, .d-title, .obj-title')?.textContent?.trim() ||
            document.querySelector('h1')?.textContent?.trim() || '';

          const priceRaw =
            document.querySelector('[class*="offer-price"], [class*="detail-price"], .price-value, .obj-price')?.textContent?.trim() ||
            document.querySelector('.price-current, .price-primary, [class*="price"][class*="current"]')?.textContent?.trim() ||
            '';
          const priceMatch = priceRaw.match(/¥\s*([\d.]+)/);
          const price = priceMatch ? `¥${priceMatch[1]}` : priceRaw;

          const priceRange = price;

          const minOrder =
            document.querySelector(
              '[class*="min-order"], [class*="moq"], [class*="minOrder"], [class*="start-order"]',
            )?.textContent?.trim() || '';

          const sales =
            document.querySelector(
              '[class*="sale"], [class*="sold"], [class*="Sales"], [class*="trade"]',
            )?.textContent?.trim() || '';

          const specs: Array<{ name: string; values: string[] }> = [];
          document
            .querySelectorAll(
              '[class*="spec"], [class*="sku"], [class*="attribute"], [class*="props"]',
            )
            .forEach((el) => {
              const name =
                el.querySelector('[class*="label"], [class*="name"], [class*="key"]')
                  ?.textContent?.trim() || '';
              const values = Array.from(
                el.querySelectorAll(
                  '[class*="value"], [class*="text"], [class*="option"]',
                ),
              )
                .map((v) => v.textContent?.trim() || '')
                .filter(Boolean);
              if (name && values.length > 0) specs.push({ name, values });
            });

          const images: string[] = [];
          document
            .querySelectorAll(
              '[class*="image"] img, [class*="pic"] img, [class*="slider"] img, [class*="gallery"] img, [class*="main-image"] img',
            )
            .forEach((img) => {
              const src =
                (img as HTMLImageElement).src ||
                (img as HTMLImageElement).dataset.src ||
                '';
              if (src && (src.includes('alicdn') || src.includes('1688'))) {
                images.push(src);
              }
            });

          const seller =
            document.querySelector(
              '[class*="shop-name"], [class*="company"], [class*="seller"], [class*="store"]',
            )?.textContent?.trim() || '';

          const sellerUrl =
            document.querySelector<HTMLAnchorElement>(
              'a[href*=".1688.com"]',
            )?.href || '';

          const tags: string[] = [];
          document
            .querySelectorAll(
              '[class*="tag"], [class*="badge"], [class*="label"]',
            )
            .forEach((el) => {
              const text = el.textContent?.trim();
              if (text && text.length < 30 && !tags.includes(text)) tags.push(text);
            });

          const location =
            document.querySelector(
              '[class*="address"], [class*="location"], [class*="ship"], [class*="send"]',
            )?.textContent?.trim() || '';

          const bodyText = document.body.innerText || '';

          const newPriceMatch = bodyText.match(/新人价[^\d]*¥\s*([\d.]+)/);
          const newPrice = newPriceMatch ? newPriceMatch[1] : '';

          const estimatedPriceMatch = bodyText.match(/预估到手价[^\d]*¥\s*([\d.]+)/);
          const estimatedPrice = estimatedPriceMatch ? estimatedPriceMatch[1] : '';

          const wholesaleTiers: Array<{ range: string; price: string }> = [];
          const tierRegex = /(\d+[-~]\d+套|≥\d+套|\d+套起批)[^\d]*¥\s*([\d.]+)/g;
          let tierMatch;
          while ((tierMatch = tierRegex.exec(bodyText)) !== null) {
            wholesaleTiers.push({ range: tierMatch[1], price: tierMatch[2] });
          }

          const skuInventory: Array<{ sku: string; price: string; stock: string }> = [];
          const skuMap = new Map<string, { price: string; stock: string }>();
          const skuRegex = /([\u4e00-\u9fa5A-Z]+)\n¥([\d.]+)\n库存(\d+)套/g;
          let skuMatch;
          while ((skuMatch = skuRegex.exec(bodyText)) !== null) {
            skuMap.set(skuMatch[1], { price: skuMatch[1 + 1], stock: skuMatch[2 + 1] });
          }
          const skuBlockRegex = /(S|M|L|XL|XXL|XXXL|[A-Z]+[\d]*)[\s]*¥([\d.]+)[\s]*库存(\d+)套/g;
          while ((skuMatch = skuBlockRegex.exec(bodyText)) !== null) {
            skuMap.set(skuMatch[1], { price: skuMatch[2], stock: skuMatch[3] });
          }
          skuMap.forEach((value, sku) => {
            skuInventory.push({ sku, price: value.price, stock: value.stock });
          });

          const discountText = document.querySelector(
            '[class*="discount"], [class*="coupon"], [class*="promotion"]',
          )?.textContent?.trim() || '';
          const discountInfo = discountText
            ? discountText.split(/[\n\r]+/).filter((s: string) => s.trim())
            : [];

          const deliveryMatch = bodyText.match(/承诺(\d+小时)发货/);
          const deliveryPromise = deliveryMatch ? deliveryMatch[1] : '';

          const shippingMatch = bodyText.match(/运费\s*¥\s*([\d.]+)/);
          const shippingFee = shippingMatch ? shippingMatch[1] : '';

          const returnPolicies: string[] = [];
          if (bodyText.includes('退货包运费')) returnPolicies.push('退货包运费');
          if (bodyText.includes('7天无理由退货')) returnPolicies.push('7天无理由退货');
          if (bodyText.includes('晚发必赔')) returnPolicies.push('晚发必赔');
          if (bodyText.includes('极速退款')) returnPolicies.push('极速退款');

          const repurchaseMatch = bodyText.match(/复购率\s*([\d.]+%)/);
          const repurchaseRate = repurchaseMatch ? repurchaseMatch[1] : '';

          const aiScoreMatch = bodyText.match(/AI严选指数\s*([\d.]+)/);
          const aiScore = aiScoreMatch ? aiScoreMatch[1] : '';

          const properties: Array<{ name: string; value: string }> = [];
          const propRegex = /([\u4e00-\u9fa5a-zA-Z]+)\t\n([^\t\n]+)\t?\n/g;
          let propMatch;
          while ((propMatch = propRegex.exec(bodyText)) !== null) {
            properties.push({ name: propMatch[1].trim(), value: propMatch[2].trim() });
          }

          const hasBuyBtn = !!document.querySelector('[class*="buy"], [class*="order"], [class*="purchase"]');
          const hasCartBtn = !!document.querySelector('[class*="cart"], [class*="purchase-car"]');
          const hasCollectBtn = !!document.querySelector('[class*="collect"], [class*="favor"]');
          const hasSampleBtn = !!document.querySelector('[class*="sample"], a[href*="sample"]');

          return {
            title,
            price,
            priceRange,
            minOrder,
            sales,
            specs,
            images,
            seller,
            sellerUrl,
            tags,
            location,
            newPrice,
            estimatedPrice,
            wholesaleTiers,
            skuInventory,
            discountInfo,
            deliveryPromise,
            shippingFee,
            returnPolicies,
            repurchaseRate,
            aiScore,
            properties,
            hasBuyBtn,
            hasCartBtn,
            hasCollectBtn,
            hasSampleBtn,
          };
        }) as ProductDetailData;

        const loginState = await detectLoginState(page, hasCdp);

        const loginRequired: Record<string, boolean> = {};
        if (loginState.isLoggedIn) {
          loginRequired.newPrice = true;
          loginRequired.estimatedPrice = true;
          loginRequired.discountInfo = true;
          loginRequired.skuInventory = true;
          loginRequired.hasBuyBtn = true;
          loginRequired.hasCartBtn = true;
          loginRequired.hasCollectBtn = true;
          loginRequired.hasSampleBtn = true;
        }

        return ok({
          source: 'dom',
          offerId,
          ...data,
          ...(loginState.isLoggedIn ? { loginState, loginRequired } : {}),
        }, [
          ...ctxTips,
          '[DOM] 商品: ' + data.title,
          '价格: ' + data.price,
          'SKU: ' + data.specs.length + ' 个',
          ...(loginState.isLoggedIn ? ['[登录] 用户: ' + loginState.loginId] : ['[未登录] 部分数据需要登录获取']),
        ]);
      } catch (error) {
        return fail('参数错误', [
            ...ctxTips,
            `获取商品详情失败: ${error instanceof Error ? error.message : '未知错误'}`,
            '1688详情页可能有反爬机制，建议重试',
          ]);
      }
    },
  });

  site.command('search', {
    description: '搜索1688商品',
    scope: 'browser',
    result: z.object({
      query: z.string(), sort: z.string(), count: z.number(), source: z.string(),
      results: z.array(z.object({
        offerId: z.string(), title: z.string(), price: z.string(),
        sales: z.string(), seller: z.string(), imageUrl: z.string(), detailUrl: z.string(),
      }).passthrough()),
    }),
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().default(20).describe('获取商品数量'),
      sort: z
        .enum(['default', 'sales', 'price-asc', 'price-desc', 'new'])
        .optional()
        .default('default')
        .describe('排序方式'),
    }),
    examples: [
      {
        cmd: 'xbrowser 1688 search --query "连衣裙"',
        description: '搜索连衣裙',
      },
      {
        cmd: 'xbrowser 1688 search --query "手机壳" --sort sales --limit 30',
        description: '按销量搜索手机壳',
      },
    ],
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const { tips: ctxTips } = buildCtxTips(ctx);

      const sortParam = SORT_MAP[params.sort] || '';
      const gbkKeywords = encodeURIComponentGBK(params.query);
      const searchUrl = `https://s.1688.com/selloffer/offer_search.htm?keywords=${gbkKeywords}${sortParam}`;

      let interceptor: Interceptor | null = null;
      try {
        interceptor = interceptApi(page, 's.1688.com', 'offerList', 'offerId');

        await page.goto(searchUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForTimeout(5000);
        await dismissPopups(page);

        await scrollAndCollect(page, 3, () =>
          interceptor ? interceptor.items().length : 0,
        );

        if (interceptor && interceptor.items().length > 0) {
          const apiItems = interceptor.items().slice(0, params.limit).map((raw) => ({
            offerId: String(raw.offerId || raw.id || ''),
            title: String(raw.subject || raw.title || ''),
            price: String(raw.price || ''),
            sales: String(raw.saleNum || raw.sales || ''),
            seller: String(raw.companyName || raw.seller || ''),
            imageUrl: String(raw.picUrl || raw.image || ''),
            detailUrl: raw.offerId
              ? `https://detail.1688.com/offer/${raw.offerId}.html`
              : '',
          }));

          return ok({
            query: params.query,
            sort: params.sort,
            count: apiItems.length,
            source: 'api',
            results: apiItems,
          }, [...ctxTips, '[API] 找到 ' + apiItems.length + ' 个商品']);
        }

        const results = await page.evaluate((limit: number) => {
          const items: Array<{
            offerId: string;
            title: string;
            price: string;
            sales: string;
            seller: string;
            imageUrl: string;
            detailUrl: string;
          }> = [];

          const feedsWrapper = document.querySelector('.feeds-wrapper');
          if (!feedsWrapper) return items;

          const cards = feedsWrapper.querySelectorAll('.search-offer-wrapper');
          cards.forEach((card, i) => {
            if (i >= limit) return;

            const titleEl = card.querySelector('.offer-title-row .title-text, .offer-title-row');
            const priceEl = card.querySelector('.offer-price-row, .price-wrapper .price-item');
            const shopEl = card.querySelector('.offer-shop-row');
            const imgEl = card.querySelector('.offer-img-wrapper img.main-img, .offer-img-inner img');

            let offerId = '';
            let detailUrl = '';
            const mainLink = card.closest('a[href*="offerId="]') || card.querySelector('a[href*="offerId="]');
            if (!mainLink) {
              const anyLink = card.querySelector('a[href*="detail.1688.com/offer"], a[href*="offerId="], a[href*="detail.m.1688.com"]');
              if (anyLink instanceof HTMLAnchorElement) {
                detailUrl = anyLink.href || '';
                const idMatch = detailUrl.match(/offerId=(\d+)/) || detailUrl.match(/\/offer\/(\d+)\.html/);
                if (idMatch) offerId = idMatch[1];
              }
            }
            if (mainLink instanceof HTMLAnchorElement) {
              detailUrl = mainLink.href || '';
              const idMatch = detailUrl.match(/offerId=(\d+)/) || detailUrl.match(/\/offer\/(\d+)\.html/);
              if (idMatch) offerId = idMatch[1];
            }

            if (!offerId) {
              const renderKey = card.getAttribute('data-renderkey') || '';
              const keyMatch = renderKey.match(/_(\d{10,})$/);
              if (keyMatch) offerId = keyMatch[1];
            }

            if (!detailUrl && offerId) {
              detailUrl = `https://detail.1688.com/offer/${offerId}.html`;
            }

            const title = titleEl?.textContent?.trim() || '';
            const priceText = priceEl?.textContent?.trim() || '';
            const priceMatch = priceText.match(/¥([\d.]+)/);
            const price = priceMatch ? priceMatch[1] : priceText;
            const seller = shopEl?.textContent?.trim().replace(/旺旺在线$/, '').trim() || '';
            const imageUrl = imgEl instanceof HTMLImageElement
              ? imgEl.src || imgEl.dataset.src || ''
              : '';

            const salesEl = card.querySelector('[class*="sale"], [class*="sold"]');
            const sales = salesEl?.textContent?.trim() || '';

            if (title || price) {
              items.push({ offerId, title, price, sales, seller, imageUrl, detailUrl });
            }
          });
          return items;
        }, params.limit) as SearchProductItem[];

        return ok({
          query: params.query,
          sort: params.sort,
          count: results.length,
          source: 'dom',
          results,
        }, [...ctxTips, '[DOM] 找到 ' + results.length + ' 个商品']);
      } finally {
        interceptor?.dispose();
      }
    },
  });

  site.command('categories', {
    description: '获取1688店铺分类列表',
    scope: 'browser',
    result: z.object({
      memberId: z.string(), count: z.number(),
      categories: z.array(z.object({
        name: z.string(), count: z.string(), url: z.string(),
        parentId: z.string(), catId: z.string(),
      })),
    }),
    parameters: z.object({
      url: z.string().optional().describe('店铺 URL'),
      memberId: z.string().optional().describe('店铺 memberId（与 url 二选一）'),
    }),
    examples: [
      {
        cmd: 'xbrowser 1688 categories --memberId "ouyimei"',
        description: '获取欧艺美店铺分类',
      },
      {
        cmd: 'xbrowser 1688 categories --url "https://ouyimei.1688.com/"',
        description: '通过 URL 获取店铺分类',
      },
    ],
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error("需要浏览器页面");
      const { tips: ctxTips } = buildCtxTips(ctx);

      const memberId = params.memberId || (params.url ? extractMemberId(params.url) : null);
      if (!memberId) {
        return fail('参数错误', [...ctxTips, '请提供 url 或 memberId 参数']);
      }

      const shopUrl = `https://${memberId}.1688.com/`;

      try {
        await page.goto(shopUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForTimeout(8000);
        await dismissPopups(page);

        const categories = await page.evaluate(() => {
          const items: Array<{
            name: string;
            count: string;
            url: string;
            parentId: string;
            catId: string;
          }> = [];
          const seen = new Set<string>();

          const blacklist = ['查看', '更多', '推荐', '热销', 'TOP', '隐藏',
            '营业执照', '税务登记证', '组织机构代码证', '厂房外景', '常规设备',
            '办公', '营业', '税务', '厂房', '设备', '代码证', '登记证',
            '生产车间', '仓库实景', '质检报告', '资质证书', '荣誉证书'];
          function isBlacklisted(n: string): boolean {
            if (!n || n.length > 30) return true;
            if (/^[省市区县镇].{2,10}$/.test(n)) return true;
            return blacklist.some((b) => n.includes(b));
          }

          document.querySelectorAll('div[title]').forEach((el) => {
            const title = (el.getAttribute('title') || '').trim();
            if (!title || title.length > 30 || isBlacklisted(title) || seen.has(title)) return;
            seen.add(title);
            const parentLink = el.closest('a');
            let url = '';
            let catId = '';
            let parentId = '';
            if (parentLink instanceof HTMLAnchorElement) {
              url = parentLink.href;
              const urlMatch = url.match(/offerlist_([^_]+)_(\d+)/);
              if (urlMatch) {
                catId = urlMatch[1];
                parentId = urlMatch[2];
              }
            }
            items.push({ name: title, count: '', url, parentId, catId });
          });

          document
            .querySelectorAll('a')
            .forEach((el) => {
              const anchor = el as HTMLAnchorElement;
              const href = anchor.href || '';
              if (!href.includes('offerlist')) return;
              let text = anchor.innerText?.trim() || anchor.getAttribute('title') || anchor.getAttribute('aria-label') || '';
              if (!text) {
                const img = anchor.querySelector('img');
                text = img?.getAttribute('alt') || '';
              }
              if (!text) return;
              const countMatch = text.match(/[（(](\d+)[）)]/);
              const name = text.replace(/[（(]\d+[）)]/g, '').replace(/[>＞]/g, '').trim();
              if (!name || name.length > 30 || name.includes('查看') || name.includes('更多')) return;
              if (seen.has(name)) return;
              seen.add(name);

              let catId = '';
              let parentId = '';
              const urlMatch = anchor.href.match(/offerlist_([^_]+)_(\d+)/);
              if (urlMatch) {
                catId = urlMatch[1];
                parentId = urlMatch[2];
              }

              items.push({
                name,
                count: countMatch ? countMatch[1] : '',
                url: anchor.href || '',
                parentId,
                catId,
              });
            });

          if (items.length === 0) {
            const bodyText = document.body.innerText || '';
            const catRegex = /([^\n\r>]{2,25}?)[（(](\d+)[）)]/g;
            let catMatch;
            const bodySeen = new Set<string>();
            while ((catMatch = catRegex.exec(bodyText)) !== null) {
              const catName = catMatch[1].replace(/^[\s>]+/, '').trim();
              const catCount = catMatch[2];
              if (catName && !bodySeen.has(catName) && !isBlacklisted(catName)) {
                bodySeen.add(catName);
                items.push({ name: catName, count: catCount, url: '', parentId: '', catId: '' });
              }
            }
          }

          return items;
        }) as CategoryItem[];

        return ok({
          memberId,
          count: categories.length,
          categories,
        }, [
          ...ctxTips,
          '[DOM] 分类: ' + categories.length + ' 个',
          categories.slice(0, 3).map((c: CategoryItem) => '' + c.name + '(' + c.count + ')').join(', '),
        ]);
      } catch (error) {
        return fail('参数错误', [
            ...ctxTips,
            `获取分类失败: ${error instanceof Error ? error.message : '未知错误'}`,
          ]);
      }
    },
  });
}
