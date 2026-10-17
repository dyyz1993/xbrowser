import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';
import { fetchJson } from '../shared/api-fetch.js';

const issueResult = z.array(z.object({
  key: z.string(),
  summary: z.string(),
  status: z.string(),
  assignee: z.string(),
  priority: z.string(),
  type: z.string(),
  url: z.string(),
}));

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'jira',
    url: 'https://xxx.atlassian.net',
    description: 'Jira - 项目管理',
    requiresLogin: true,
  });

  function baseUrl(ctx: Record<string, unknown>): string {
    const domain = (ctx.domain as string) || (ctx.cdpEndpoint as string) || 'xxx.atlassian.net';
    return `https://${domain}`;
  }

  site.command('issues', {
    description: '搜索 Jira Issues (JQL)',
    scope: 'project',
    loginRequired: 'required',
    result: issueResult,
    parameters: z.object({
      jql: z.string().optional().describe('JQL 查询语句，默认按创建时间倒序'),
      limit: z.coerce.number().optional().default(10).describe('返回数量'),
    }),
    handler: async (p, ctx) => {
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const auth = ctxAny.authorization as string | undefined;
      if (!auth) return fail('需要 Authorization header（Bearer token 或 Basic auth）');
      const base = baseUrl(ctxAny);
      const jql = p.jql || 'ORDER BY created DESC';
      const url = `${base}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${p.limit ?? 10}`;
      try {
        const data = await fetchJson(url, { headers: { Authorization: auth } }) as JsonObject;
        const issues = ((data?.issues as Record<string, unknown>[]) ?? []).map((issue: Record<string, unknown>) => {
          const fields = issue.fields as Record<string, unknown> | undefined;
          return {
            key: String(issue.key ?? ''),
            summary: String(fields?.summary ?? ''),
            status: String((fields?.status as Record<string, unknown>)?.name ?? ''),
            assignee: String((fields?.assignee as Record<string, unknown>)?.displayName ?? 'Unassigned'),
            priority: String((fields?.priority as Record<string, unknown>)?.name ?? ''),
            type: String((fields?.issuetype as Record<string, unknown>)?.name ?? ''),
            url: `${base}/browse/${issue.key}`,
          };
        });
        if (!issues.length) return fail('未找到 Issue');
        return ok(issues.map((r, i) => ({ ...r, rank: i + 1 })));
      } catch (e) { return fail(`API 请求失败: ${e instanceof Error ? e.message : String(e)}`); }
    },
  });

  site.command('issue', {
    description: '获取单个 Jira Issue 详情',
    scope: 'project',
    loginRequired: 'required',
    result: z.object({
      key: z.string(),
      summary: z.string(),
      description: z.string(),
      status: z.string(),
      assignee: z.string(),
      reporter: z.string(),
      type: z.string(),
      priority: z.string(),
      labels: z.array(z.string()),
      url: z.string(),
    }),
    parameters: z.object({
      key: z.string().describe('Issue key，如 PROJ-123'),
    }),
    handler: async (p, ctx) => {
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const auth = ctxAny.authorization as string | undefined;
      if (!auth) return fail('需要 Authorization header');
      const base = baseUrl(ctxAny);
      const url = `${base}/rest/api/3/issue/${p.key}`;
      try {
        const data = await fetchJson(url, { headers: { Authorization: auth } }) as JsonObject;
        const fields = data?.fields as Record<string, unknown> | undefined;
        return ok({
          key: String(data?.key ?? p.key),
          summary: String(fields?.summary ?? ''),
          description: String((fields?.description as Record<string, unknown>)?.text ?? '').slice(0, 500),
          status: String((fields?.status as Record<string, unknown>)?.name ?? ''),
          assignee: String((fields?.assignee as Record<string, unknown>)?.displayName ?? 'Unassigned'),
          reporter: String((fields?.reporter as Record<string, unknown>)?.displayName ?? ''),
          type: String((fields?.issuetype as Record<string, unknown>)?.name ?? ''),
          priority: String((fields?.priority as Record<string, unknown>)?.name ?? ''),
          labels: (fields?.labels as string[]) ?? [],
          url: `${base}/browse/${p.key}`,
        });
      } catch (e) { return fail(`API 请求失败: ${e instanceof Error ? e.message : String(e)}`); }
    },
  });
}
