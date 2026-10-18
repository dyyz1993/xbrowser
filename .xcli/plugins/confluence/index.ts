import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';

const pageResult = z.array(z.object({
  id: z.string(),
  title: z.string(),
  space: z.string(),
  url: z.string(),
}));

const searchResult = z.array(z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  url: z.string(),
  excerpt: z.string(),
}));

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'confluence',
    url: 'https://xxx.atlassian.net/wiki',
    description: 'Confluence - 团队文档',
    requiresLogin: true,
  });

  function baseUrl(ctx: Record<string, unknown>): string {
    const domain = (ctx.domain as string) || (ctx.cdpEndpoint as string) || 'xxx.atlassian.net';
    return `https://${domain}/wiki`;
  }

  site.command('pages', {
    description: '列出 Confluence 页面',
    scope: 'project',
    loginRequired: 'required',
    result: pageResult,
    parameters: z.object({
      space: z.string().optional().describe('空间 key'),
      limit: z.coerce.number().optional().default(10).describe('返回数量'),
    }),
    handler: async (p, ctx) => {
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const auth = ctxAny.authorization as string | undefined;
      if (!auth) return fail('需要 Authorization header（Bearer token 或 Basic auth）');
      const base = baseUrl(ctxAny);
      const cql = p.space ? `space="${p.space}" AND type=page` : 'type=page';
      const url = `${base}/rest/api/content?cql=${encodeURIComponent(cql)}&limit=${p.limit ?? 10}`;
      try {
        const data = await fetchJson(url, { headers: { Authorization: auth } }) as JsonObject;
        const results = ((data?.results as Record<string, unknown>[]) ?? []).map((r: Record<string, unknown>) => ({
          id: String(r.id ?? ''),
          title: String(r.title ?? ''),
          space: String((r.space as Record<string, unknown>)?.key ?? ''),
          url: `${base}/pages/viewpage.action?pageId=${r.id}`,
        }));
        if (!results.length) return fail('未找到页面');
        return ok(results.map((r, i) => ({ ...r, rank: i + 1 })));
      } catch (e) { return fail(`API 请求失败: ${e instanceof Error ? e.message : String(e)}`); }
    },
  });

  site.command('search', {
    description: '搜索 Confluence 内容',
    scope: 'project',
    loginRequired: 'required',
    result: searchResult,
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.coerce.number().optional().default(10).describe('返回数量'),
    }),
    handler: async (p, ctx) => {
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const auth = ctxAny.authorization as string | undefined;
      if (!auth) return fail('需要 Authorization header');
      const base = baseUrl(ctxAny);
      const url = `${base}/rest/api/content/search?cql=${encodeURIComponent(`text~"${p.query}"`)}&limit=${p.limit ?? 10}`;
      try {
        const data = await fetchJson(url, { headers: { Authorization: auth } }) as JsonObject;
        const results = ((data?.results as Record<string, unknown>[]) ?? []).map((r: Record<string, unknown>) => ({
          id: String(r.id ?? ''),
          title: String(r.title ?? ''),
          type: String(r.type ?? ''),
          url: `${base}${r._links ? (r._links as Record<string, unknown>).webui : ''}`,
          excerpt: String(r.excerpt ?? '').slice(0, 200),
        }));
        if (!results.length) return fail(`未找到匹配 "${p.query}" 的内容`);
        return ok(results.map((r, i) => ({ ...r, rank: i + 1 })));
      } catch (e) { return fail(`API 请求失败: ${e instanceof Error ? e.message : String(e)}`); }
    },
  });
}
