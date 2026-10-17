import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';

const jobResult = z.array(z.object({
  rank: z.number(),
  jobId: z.string(),
  title: z.string(),
  company: z.string(),
  salary: z.string(),
  location: z.string(),
  experience: z.string(),
  education: z.string(),
  tags: z.string(),
  url: z.string(),
})).describe('Job search results');

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'boss',
    url: 'https://www.zhipin.com',
    description: 'Boss直聘 - 职位搜索、公司信息',
    requiresLogin: true,
  });

  site.command('search', {
    description: '搜索 Boss直聘 职位',
    scope: 'page',
    loginRequired: 'required',
    result: jobResult,
    parameters: z.object({
      query: z.string().describe('职位关键词，如 "前端"'),
      city: z.string().optional().describe('城市代码，如 101010100（北京）'),
      limit: z.coerce.number().optional().default(10).describe('返回数量'),
    }),
    examples: [
      { cmd: 'xbrowser boss search --query "前端" --city 101010100', description: '搜索北京前端岗位' },
    ],
    handler: async (params, ctx) => {
      const page = ctx.page as Page | undefined;
      if (!page) return fail('需要浏览器页面');

      const url = `https://www.zhipin.com/web/geek/job?query=${encodeURIComponent(params.query)}&city=${params.city ?? ''}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000);

      const raw = await page.evaluate(`
        (() => {
          const cards = [...document.querySelectorAll('.job-card-wrapper')].slice(0, ${params.limit});
          return cards.map((card, index) => {
            const link = card.querySelector('a[href*="/job_detail/"]');
            const title = card.querySelector('.job-name');
            const company = card.querySelector('.company-name a');
            const salary = card.querySelector('.salary');
            const area = card.querySelector('.job-area-wrapper');
            const tags = [...card.querySelectorAll('.tag-list li, .job-card-footer .tag-list li')];
            const info = [...card.querySelectorAll('.job-info .filter-labels')];
            return {
              index,
              jobId: (link?.getAttribute('href') || '').match(/job_detail\\/([a-f0-9]+)\\.html/)?.[1] || '',
              title: title?.textContent?.replace(/\\s+/g, ' ').trim() || '',
              company: company?.textContent?.replace(/\\s+/g, ' ').trim() || '',
              salary: salary?.textContent?.replace(/\\s+/g, ' ').trim() || '',
              location: area?.textContent?.replace(/\\s+/g, ' ').trim() || '',
              experience: info[0]?.textContent?.replace(/\\s+/g, ' ').trim() || '',
              education: info[1]?.textContent?.replace(/\\s+/g, ' ').trim() || '',
              tags: tags.map(t => t.textContent?.replace(/\\s+/g, ' ').trim()).filter(Boolean).join(', '),
              href: link?.getAttribute('href') || '',
            };
          });
        })()
      `) as Array<Record<string, unknown>>;

      if (!raw.length) return fail(`未找到匹配 "${params.query}" 的职位，请确认已登录`);
      const limit = params.limit ?? 10;
      return ok(raw.slice(0, limit).map((item, i) => ({
        rank: i + 1,
        jobId: String(item.jobId ?? ''),
        title: String(item.title ?? ''),
        company: String(item.company ?? ''),
        salary: String(item.salary ?? ''),
        location: String(item.location ?? ''),
        experience: String(item.experience ?? ''),
        education: String(item.education ?? ''),
        tags: String(item.tags ?? ''),
        url: String(item.href ?? '').startsWith('http')
          ? String(item.href)
          : `https://www.zhipin.com${item.href ?? ''}`,
      })));
    },
  });

  site.command('detail', {
    description: '打开 Boss直聘 职位详情页',
    scope: 'page',
    loginRequired: 'required',
    result: z.object({
      jobId: z.string(),
      url: z.string(),
      pageTitle: z.string(),
    }),
    parameters: z.object({
      jobId: z.string().describe('职位 ID'),
    }),
    handler: async (params, ctx) => {
      const page = ctx.page as Page | undefined;
      if (!page) return fail('需要浏览器页面');
      const url = `https://www.zhipin.com/job_detail/${params.jobId}.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);
      const pageTitle = await page.evaluate('document.title') as string;
      return ok({ jobId: params.jobId, url, pageTitle });
    },
  });
}
