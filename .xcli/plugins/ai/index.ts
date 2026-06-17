import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { z } from 'zod/v4';
import { execSync } from 'child_process';

/**
 * ai 聚合插件 — 统一入口，多站点并行对比。
 *
 * 不操作 DOM，只调度站点插件：
 *   xbrowser ai chat "问题" --providers deepseek,doubao,yuanbao
 *   xbrowser ai chat "问题" --provider deepseek --think --search
 *   xbrowser ai list-providers
 */
export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'ai',
    url: 'about:blank',
    description: 'AI 聚合 — 多站点并行对比、统一参数',
    requiresLogin: false,
  });

  /** 可用的后端站点（有 chat 命令的） */
  const PROVIDERS = ['deepseek', 'doubao', 'qianwen', 'yuanbao', 'chatgpt', 'gemini', 'qwen'];

  // ── list-providers ──
  site.command('list-providers', {
    description: '列出可用的 AI 后端站点',
    scope: 'project',
    parameters: z.object({}),
    result: z.array(z.object({ name: z.string(), available: z.boolean() }).passthrough()),
    handler: async () => {
      return ok(
        PROVIDERS.map(name => ({ name, available: true })),
        [`共 ${PROVIDERS.length} 个后端: ${PROVIDERS.join(', ')}`],
      );
    },
  });

  // ── chat ──
  const chatResultSchema = z.object({
    results: z.array(z.object({
      provider: z.string(),
      response: z.string(),
      duration: z.string().optional(),
      error: z.string().optional(),
    }).passthrough()),
  }).passthrough();

  site.command('chat', {
    description: '统一 AI 对话 — 支持多站点并行对比',
    scope: 'project',
    parameters: z.object({
      message: z.string().describe('消息内容'),
      provider: z.string().optional().describe('单站点（如 deepseek）'),
      providers: z.string().optional().describe('多站点 CSV（如 deepseek,doubao）— 并行对比'),
      think: z.boolean().optional().describe('开启深度思考（转发给支持的站点）'),
      search: z.boolean().optional().describe('开启联网搜索（转发给支持的站点）'),
      showSources: z.boolean().optional().describe('显示搜索来源（转发给支持的站点）'),
      path: z.string().optional().describe('附件路径（单文件）'),
      paths: z.string().optional().describe('附件路径（多文件 CSV）'),
      cdp: z.string().optional().describe('CDP endpoint（如 http://localhost:9221）'),
      timeout: z.number().optional().describe('每个站点超时秒数（默认 90）'),
    }).refine(d => d.provider || d.providers, {
      message: '需要 --provider 或 --providers',
    }),
    result: chatResultSchema,
    examples: [
      { cmd: 'xbrowser ai chat "你好" --provider deepseek', description: '单站点对话' },
      { cmd: 'xbrowser ai chat "1加1" --providers deepseek,doubao,yuanbao', description: '三站点对比' },
      { cmd: 'xbrowser ai chat "分析React" --provider deepseek --think', description: '深度思考' },
      { cmd: 'xbrowser ai list-providers', description: '查看可用后端' },
    ],
    handler: async (params) => {
      // 解析目标站点
      const targets = params.providers
        ? params.providers.split(',').map(s => s.trim()).filter(Boolean)
        : params.provider ? [params.provider] : [];

      if (targets.length === 0) return fail('未指定站点', ['--provider 或 --providers 至少一个']);

      // 校验站点
      const invalid = targets.filter(t => !PROVIDERS.includes(t));
      if (invalid.length > 0) return fail(`不支持的站点: ${invalid.join(',')}`, [`可用: ${PROVIDERS.join(', ')}`]);

      const cdpFlag = params.cdp ? `--cdp ${params.cdp}` : '--cdp http://localhost:9221';
      const timeoutSec = params.timeout ?? 90;

      // 构造透传参数
      const extraFlags: string[] = [];
      if (params.think) extraFlags.push('--think');
      if (params.search) extraFlags.push('--search');
      if (params.showSources) extraFlags.push('--showSources');
      if (params.path) extraFlags.push(`--path ${JSON.stringify(params.path)}`);
      if (params.paths) extraFlags.push(`--paths ${JSON.stringify(params.paths)}`);
      const extraStr = extraFlags.length > 0 ? ' ' + extraFlags.join(' ') : '';

      // 并行调用各站点
      const results = await Promise.allSettled(
        targets.map(async (provider) => {
          const escaped = params.message.replace(/'/g, "'\\''");
          const cmd = `node dist/cli.js ${cdpFlag} ${provider} chat '${escaped}'${extraStr} --json 2>/dev/null`;
          try {
            const output = execSync(cmd, {
              cwd: process.cwd(),
              timeout: timeoutSec * 1000,
              encoding: 'utf-8',
              maxBuffer: 10 * 1024 * 1024,
            });
            // 从 JSON 输出提取 response + duration
            let response = '';
            let duration = '';
            for (const line of output.split('\n')) {
              const respMatch = line.match(/"response"\s*:\s*"(.+?)"/);
              if (respMatch && !response) response = respMatch[1];
              const durMatch = line.match(/"duration"\s*:\s*"(.+?)"/);
              if (durMatch) duration = durMatch[1];
            }
            // 兜底：非 JSON 格式找 response:
            if (!response) {
              const m = output.match(/response[:\s]+(.+)/i);
              if (m) response = m[1].trim();
            }
            return { provider, response, duration: duration || undefined, error: response ? undefined : '未提取到回复' };
          } catch (e) {
            return { provider, response: '', error: (e as Error).message.slice(0, 100) };
          }
        }),
      );

      // 汇总
      const formatted = results.map(r => {
        if (r.status === 'fulfilled') return r.value;
        return { provider: '?', response: '', error: r.reason?.message || '失败' };
      });

      // tips 格式化——对齐表格对比
      const rows = formatted.map(r => {
        if (r.error) return { provider: r.provider, status: '❌', text: r.error.slice(0, 40), time: '' };
        return { provider: r.provider, status: '✅', text: (r.response || '').replace(/\n/g, ' ').slice(0, 40), time: r.duration || '' };
      });
      const colP = Math.max(8, ...rows.map(r => r.provider.length));
      const colT = Math.max(8, ...rows.map(r => [...r.text].length));
      const lines: string[] = [];
      lines.push(['Provider'.padEnd(colP), 'Response'.padEnd(colT), 'Time'].join('  '));
      lines.push('-'.repeat(colP + colT + 8));
      for (const r of rows) {
        lines.push([r.provider.padEnd(colP), r.text.padEnd(colT), r.time].join('  '));
      }
      const tips = [lines.join('\n')];

      return ok({ results: formatted }, tips);
    },
  });
}
