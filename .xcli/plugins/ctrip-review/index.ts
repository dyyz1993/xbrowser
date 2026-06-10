/**
 * ctrip-review — 携程景点评论爬取插件
 *
 * 用法：
 *   xbrowser ctrip-review reviews --url "https://you.ctrip.com/sight/XXX/123.html" --cdp 9221
 *   xbrowser ctrip-review reviews --businessId 131888 --cdp 9221
 *
 * 参数：
 *   --url         完整携程景点URL
 *   --businessId  景点 ID（自动拼 URL）
 *   --maxPages    最大翻页数，默认 69
 *   --yearsOnly   只返回近 N 年，0=全部
 *   --format      json / text，默认 json
 *   --verbose     显示进度信息
 */

import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function extractReviews(page: Page): Promise<Array<Record<string, string>>> {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.commentItem')).map(el => {
      const g = (s: string) => (el.querySelector(s) as HTMLElement)?.textContent?.trim() || '';
      return {
        userName: g('.userName'),
        content: g('.commentDetail'),
        score: g('.averageScore').replace(/\s+/g, ' ').trim(),
        time: g('.commentTime'),
        ipLocation: g('.commentIp'),
      };
    });
  });
}

export default function (api: XCLIAPI): void {
  const site = api.createSite({
    name: 'ctrip-review',
    url: 'https://you.ctrip.com',
    description: '携程景点评论爬取',
    requiresLogin: true,
  });

  site.command('reviews', {
    description: '爬取携程景点评论，自动翻页（Ant Design 分页）',
    scope: 'browser',
    parameters: z.object({
      businessId: z.string().optional().describe('景点 businessId，如 131888'),
      url: z.string().optional().describe('景点完整 URL'),
      maxPages: z.number().optional().default(69).describe('最大翻页数'),
      yearsOnly: z.number().optional().default(0).describe('近 N 年，0=全部'),
      format: z.enum(['json', 'text']).optional().default('json').describe('输出格式'),
      verbose: z.boolean().optional().default(false).describe('显示进度信息'),
    }),
    result: z.object({
      total: z.number(),
      filtered: z.number(),
      pages: z.number(),
      reviews: z.array(z.object({
        userName: z.string(),
        content: z.string(),
        score: z.string(),
        time: z.string(),
        ipLocation: z.string(),
      })),
    }).passthrough(),
    handler: async (params, ctx) => {
      const p = params as Record<string, unknown>;
      const page = (ctx as unknown as Record<string, unknown>).page as Page | null;
      if (!page) return fail('需要浏览器会话，请使用 --cdp 连接');

      // ─── 确定目标 URL ───
      let targetUrl = String(p.url || '');
      if (!targetUrl) {
        const bizId = String(p.businessId || '');
        if (!bizId) return fail('请提供 --url 或 --businessId');
        targetUrl = `https://you.ctrip.com/sight/${bizId}.html`;
      }

      // ─── 导航 ───
      try {
        await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 });
      } catch (e) {
        return fail(`页面加载失败: ${(e as Error).message}`);
      }
      await sleep(5000);

      // ─── 确认评论区域已加载 ───
      const hasItems = await page.evaluate(() => document.querySelectorAll('.commentItem').length > 0);
      if (!hasItems) {
        return fail(`未在 ${page.url()} 找到评论区域，请提供正确的景点 URL 或检查 --cdp`);
      }

      // ─── 翻页爬取 ───
      const allReviews: Array<Record<string, string>> = [];
      const seen = new Set<string>();
      const maxPages = Math.min(Number(p.maxPages) || 69, 200);
      const verbose = Boolean(p.verbose);
      let consecEmpty = 0;

      if (verbose) process.stderr.write(`📄 共 ${maxPages} 页\n`);

      for (let pg = 1; pg <= maxPages; pg++) {
        if (verbose) process.stderr.write(`  📖 第 ${pg}/${maxPages} 页...`);
        await sleep(2000);
        const reviews = await extractReviews(page);

        let newCount = 0;
        for (const r of reviews) {
          const key = (r.userName || '') + '|' + (r.content || '').slice(0, 80);
          if (!seen.has(key)) { seen.add(key); allReviews.push(r); newCount++; }
        }

        if (verbose) process.stderr.write(` ${reviews.length} 条, 新增 ${newCount}, 累计 ${allReviews.length}\n`);

        if (newCount === 0 && pg > 1) { consecEmpty++; if (consecEmpty >= 3) { if (verbose) process.stderr.write('  ⏹️  连续空页，停止\n'); break; } }
        else consecEmpty = 0;

        if (pg >= maxPages) break;

        try {
          if (verbose) process.stderr.write('  ⏩ 翻页中...\n');
          await page.locator('li[title="下一页"]').click();
          await sleep(2500);
        } catch {
          if (verbose) process.stderr.write('  ⏹️  无更多页\n');
          break;
        }
      }

      if (verbose) process.stderr.write(`✅ 完成！共 ${allReviews.length} 条\n`);

      // ─── 过滤近 N 年 ───
      let filtered = allReviews;
      const yearsOnly = Number(p.yearsOnly) || 0;
      if (yearsOnly > 0) {
        const cutoff = new Date().getFullYear() - yearsOnly;
        filtered = allReviews.filter(r => {
          const m = (r.time || '').match(/(\d{4})/);
          return m && parseInt(m[1]) >= cutoff;
        });
      }

      // ─── 排序（最新在前） ───
      filtered.sort((a, b) => (b.time || '').localeCompare(a.time || ''));

      // ─── 输出 ───
      const pagesRead = Math.min(maxPages, Math.ceil(allReviews.length / 10) + 1);

      if (String(p.format) === 'text') {
        const lines = filtered.slice(0, 50).map((r, i) =>
          `${i + 1}. [${r.score || 'N/A'}] ${r.userName || '匿名'} | ${r.time || ''}\n   ${(r.content || '').slice(0, 200)}`);
        return ok({
          total: allReviews.length,
          filtered: filtered.length,
          pages: pagesRead,
          reviews: lines.join('\n\n'),
        }, [`共爬取 ${pagesRead} 页，获取 ${allReviews.length} 条评论，筛选后 ${filtered.length} 条`]);
      }

      return ok({
        total: allReviews.length,
        filtered: filtered.length,
        pages: pagesRead,
        reviews: filtered,
      }, [`共爬取 ${pagesRead} 页，获取 ${allReviews.length} 条评论，筛选后 ${filtered.length} 条`]);
    },
  });
}
