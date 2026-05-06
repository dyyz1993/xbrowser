import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'taobao',
    url: 'https://www.taobao.com',
    description: '淘宝 - 商品搜索与采集',
    requiresLogin: false,
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
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      const sortMap: Record<string, string> = {
        'default': '',
        'price-asc': '&sort=price-asc',
        'price-desc': '&sort=price-desc',
        'sales': '&sort=sale-desc',
      };
      const url = `https://s.taobao.com/search?q=${encodeURIComponent(params.query)}${sortMap[params.sort]}`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      const results = await page.evaluate((limit) => {
        const items: Array<{title: string; price: string; shop: string; sales: string; link: string}> = [];
        const cards = document.querySelectorAll('[class*="ContentItem"], .items .item, [class*="Card"]');
        cards.forEach((card, i) => {
          if (i >= limit) return;
          const titleEl = card.querySelector('[class*="Title"] span, .title, a[title]');
          const priceEl = card.querySelector('[class*="price"], .price');
          const shopEl = card.querySelector('[class*="shopName"], .shop, .shopName');
          const salesEl = card.querySelector('[class*="sellCount"], [class*="sales"]');
          const linkEl = card.querySelector('a[href*="item"], a[href*="detail"]');
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
        tips: [`找到 ${results.length} 个商品`],
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
      { cmd: 'xbrowser taobao detail --url "https://item.taobao.com/xxx"', description: '获取商品详情' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      await page.goto(params.url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      const data = await page.evaluate(() => {
        const title = document.querySelector('[class*="Title"] span, .tb-detail-hd h1, .item-title')?.textContent?.trim() || '';
        const price = document.querySelector('[class*="price"], .tb-rmb-num')?.textContent?.trim() || '';
        const sales = document.querySelector('[class*="sellCount"], [class*="sales"]')?.textContent?.trim() || '';
        const shop = document.querySelector('[class*="shopName"], .shop-name')?.textContent?.trim() || '';

        const images: string[] = [];
        document.querySelectorAll('[class*="mainPic"] img, .tb-pic img, #J_ImgBooth').forEach((img) => {
          const src = (img as HTMLImageElement).src || (img as HTMLImageElement).dataset.src || '';
          if (src) images.push(src);
        });

        const specs: Record<string, string> = {};
        document.querySelectorAll('[class*="skuItem"], .tb-sku-item, [class*="attribute"]').forEach((el) => {
          const label = el.querySelector('[class*="label"], .name')?.textContent?.trim() || '';
          const value = el.querySelector('[class*="value"], .val')?.textContent?.trim() || '';
          if (label && value) specs[label] = value;
        });

        return { title, price, sales, shop, images, specs };
      });

      return {
        data,
        tips: [`商品: ${data.title}`, `价格: ${data.price}`],
      };
    },
  });
}
