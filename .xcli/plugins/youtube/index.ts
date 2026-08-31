import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { z } from 'zod';

/**
 * youtube 插件 — YouTube 搜索（S188 从 scaffold 实现）
 *
 * 提取方案：ytInitialData 递归收集 videoRenderer——
 * 不依赖 DOM 渲染（后台 tab 懒渲染只出 2 个，初始数据有 18 个全量）。
 * 结构探针于 2026-08-31，YouTube 内部结构改版需复测。
 */

const EXTRACT_SCRIPT = `(function(){
  var out = [];
  function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (o.videoRenderer) {
      var v = o.videoRenderer;
      out.push({
        videoId: v.videoId || '',
        title: v.title && v.title.runs ? v.title.runs[0].text : '',
        url: 'https://www.youtube.com/watch?v=' + (v.videoId || ''),
        channel: v.ownerText && v.ownerText.runs ? v.ownerText.runs[0].text : '',
        length: (v.lengthText && v.lengthText.simpleText) || ''
      });
      return;
    }
    for (var k in o) if (typeof o[k] === 'object') walk(o[k]);
  }
  walk(window.ytInitialData);
  return JSON.stringify(out);
})()`;

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'youtube',
    url: 'https://www.youtube.com',
    description: 'YouTube 搜索（ytInitialData 结构化提取，无需登录）',
    requiresLogin: false,
  });

  site.command('search', {
    description: '搜索 YouTube 视频，返回标题/链接/频道/时长',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().describe('返回条数上限（默认 10）'),
    }),
    examples: [
      { cmd: 'xbrowser youtube search --query "browser automation"', description: '搜索视频' },
    ],
    handler: async (params: { query: string; limit?: number }, ctx: { page?: any }) => {
      const page = ctx?.page;
      if (!page) throw new Error('需要浏览器页面');
      await page.goto(
        'https://www.youtube.com/results?search_query=' + encodeURIComponent(params.query),
      );
      await page.waitForTimeout(3000);
      const raw = await page.evaluate(EXTRACT_SCRIPT);
      let items: Array<{ videoId: string; title: string; url: string; channel: string; length: string }> = [];
      try { const parsed = JSON.parse(String(raw)); if (Array.isArray(parsed)) items = parsed; } catch { items = []; }
      const limit = params.limit ?? 10;
      return { query: params.query, count: Math.min(items.length, limit), videos: items.slice(0, limit) };
    },
  });
}
