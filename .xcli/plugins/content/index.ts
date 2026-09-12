/**
 * content — 内容营销插件（xbrowser 自推广的第一等公民能力）。
 *
 * 定位：与 18 个平台发布插件正交组合——content 负责"写"（case 渲染 + 封面渲染），
 * 各站点插件负责"发"（devto publish / juejin draft / medium publish …）。
 *
 * 自举设计：cover 命令用 xbrowser 自己的浏览器渲染 HTML 封面再截图，
 * 全程不依赖任何绘图库——产品用自身能力完成自身推广的完整闭环。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CASES_DIR = path.join(PLUGIN_DIR, 'cases');
// 仓库根：content/ → plugins/ → .xcli/ → <root>
const REPO_ROOT = path.resolve(PLUGIN_DIR, '..', '..', '..');

/** case.json 元数据 */
interface CaseMeta {
  slug: string;
  title: Record<string, string>;
  description: Record<string, string>;
  langs: string[];
  platforms: Record<string, string[]>;
  tags: Record<string, string>;
}

/** 列出全部内置 case（读取 CASES_DIR 下含 case.json 的子目录） */
export function listCases(): CaseMeta[] {
  const out: CaseMeta[] = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(CASES_DIR);
  } catch {
    return out;
  }
  for (const name of entries) {
    const metaPath = path.join(CASES_DIR, name, 'case.json');
    try {
      const raw = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Partial<CaseMeta>;
      if (!raw.slug || !raw.title) continue;
      out.push({
        slug: raw.slug,
        title: raw.title,
        description: raw.description ?? {},
        langs: raw.langs ?? ['en'],
        platforms: raw.platforms ?? {},
        tags: raw.tags ?? {},
      });
    } catch {
      // 缺 case.json 或 JSON 损坏的目录直接跳过
    }
  }
  return out;
}

/** {{VAR}} 模板变量 */
export function buildVars(): Record<string, string> {
  let version = 'latest';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { version?: string };
    if (pkg.version) version = pkg.version;
  } catch {
    // 非仓库环境（如 marketplace 安装）时用 fallback
  }
  const now = new Date();
  return {
    VERSION: version,
    DATE: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    INSTALL_CMD: 'npm install -g @xbrowser/cli',
    GITHUB_URL: 'https://github.com/dyyz1993/xbrowser',
    NPM_URL: 'https://www.npmjs.com/package/@xbrowser/cli',
  };
}

/** 替换文章中的 {{VAR}} 占位符 */
export function renderTemplate(md: string, vars: Record<string, string>): string {
  return md.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key: string) => vars[key] ?? whole);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** OG 封面 HTML（1200×630 设计稿，暗色渐变 + 终端窗口装饰） */
export function renderCoverHtml(title: string, subtitle: string): string {
  const sub = subtitle ? `\n  <div class="sub">${escapeHtml(subtitle)}</div>` : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:100vw; height:100vh; overflow:hidden;
    font-family:-apple-system,'SF Pro Display','PingFang SC','Microsoft YaHei',sans-serif;
    background:linear-gradient(135deg,#0f172a 0%,#1e293b 55%,#312e81 100%);
    color:#f8fafc; display:flex; flex-direction:column; justify-content:center;
    padding:72px 80px; position:relative; }
  .badge { display:inline-flex; align-items:center; gap:12px; color:#7dd3fc;
    font-size:22px; font-weight:700; letter-spacing:3px; margin-bottom:30px; }
  .badge::before { content:''; width:34px; height:34px; border-radius:8px;
    background:linear-gradient(135deg,#38bdf8,#6366f1); }
  h1 { font-size:62px; line-height:1.15; font-weight:800; max-width:980px;
    text-wrap:balance; }
  .sub { margin-top:26px; font-size:28px; color:#cbd5e1; max-width:900px; line-height:1.45; }
  .term { position:absolute; right:64px; bottom:56px; background:rgba(2,6,23,.8);
    border:1px solid #334155; border-radius:10px; padding:14px 22px;
    font-family:'SF Mono',Menlo,Consolas,monospace; font-size:19px; color:#86efac; }
  .term::before { content:'$ '; color:#64748b; }
</style></head>
<body>
  <div class="badge">XBROWSER</div>
  <h1>${escapeHtml(title)}</h1>${sub}
  <div class="term">npm install -g @xbrowser/cli</div>
</body></html>`;
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'content',
    url: 'https://xbrowser.dev',
    description: '内容营销：把内置推广 case 渲染成平台就绪的文章 + 浏览器自渲染封面（自推广闭环）',
    requiresLogin: false,
  });

  site.command('cases', {
    description: '列出内置推广 case（标题/语言/平台/建议命令）',
    scope: 'project',
    loginRequired: 'none',
    parameters: z.object({}),
    result: z.object({
      total: z.number(),
      cases: z.array(z.object({
        slug: z.string(),
        title: z.record(z.string(), z.string()),
        description: z.record(z.string(), z.string()),
        langs: z.array(z.string()),
        platforms: z.record(z.string(), z.array(z.string())),
        tags: z.record(z.string(), z.string()),
      })),
    }),
    examples: [{ cmd: 'xbrowser content cases', description: '列出所有内置推广 case' }],
    handler: async () => {
      const cases = listCases();
      if (cases.length === 0) {
        return fail('未找到内置 case', ['cases 目录缺失或为空：' + CASES_DIR]);
      }
      const tips: string[] = [`共 ${cases.length} 个 case，用 xbrowser content draft --case <slug> 渲染成文`];
      return ok({ total: cases.length, cases }, tips);
    },
  });

  site.command('draft', {
    description: '把内置 case 渲染成可发布的 Markdown 文章（替换 {{VAR}}，输出平台建议命令）',
    scope: 'project',
    loginRequired: 'none',
    parameters: z.object({
      case: z.string().describe('Case 名称（见 xbrowser content cases）'),
      lang: z.enum(['en', 'zh']).optional().default('en').describe('语言版本'),
      output: z.string().optional().describe('输出路径（默认 output/content/<slug>-<lang>.md）'),
    }),
    result: z.object({
      case: z.string(),
      lang: z.string(),
      title: z.string(),
      file: z.string(),
      chars: z.number(),
      suggestedCommands: z.array(z.string()),
    }),
    examples: [
      { cmd: 'xbrowser content draft --case self-healing-replay --lang zh', description: '渲染中文版文章' },
      { cmd: 'xbrowser content draft --case cli-for-ai-agents --output /tmp/a.md', description: '指定输出路径' },
    ],
    handler: async (params) => {
      const meta = listCases().find((c) => c.slug === params.case);
      if (!meta) {
        const known = listCases().map((c) => c.slug).join(', ');
        return fail(`未知 case：${params.case}`, [`可用 case：${known || '（无）'}`]);
      }
      if (!meta.langs.includes(params.lang)) {
        return fail(`case ${meta.slug} 没有 ${params.lang} 版本`, [`可用语言：${meta.langs.join(', ')}`]);
      }
      const articlePath = path.join(CASES_DIR, meta.slug, `${params.lang}.md`);
      if (!fs.existsSync(articlePath)) {
        return fail(`文章源文件缺失：${articlePath}`);
      }
      const rendered = renderTemplate(fs.readFileSync(articlePath, 'utf8'), buildVars());

      const outPath = path.resolve(params.output ?? path.join('output', 'content', `${meta.slug}-${params.lang}.md`));
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, rendered, 'utf8');

      const title = meta.title[params.lang] ?? meta.title.en ?? meta.slug;
      const platformHints = meta.platforms[params.lang] ?? [];
      const tags = meta.tags[params.lang] ?? '';
      const suggested = platformHints.map((p) => `xbrowser ${p} publish --file "${outPath}" --tags "${tags}"`);
      const tips: string[] = [
        `已写出 ${outPath}（${rendered.length} 字符）`,
        ...suggested.slice(0, 3),
      ];
      return ok({
        case: meta.slug,
        lang: params.lang,
        title,
        file: outPath,
        chars: rendered.length,
        suggestedCommands: suggested,
      }, tips);
    },
  });

  site.command('cover', {
    description: '用浏览器自渲染 OG 封面图（自举演示：xbrowser 自己给自己画封面）',
    scope: 'page',
    loginRequired: 'none',
    parameters: z.object({
      title: z.string().describe('封面主标题'),
      subtitle: z.string().optional().describe('封面副标题'),
      output: z.string().optional().describe('输出 PNG 路径（默认 output/content/cover-<时间戳>.png）'),
      width: z.number().optional().default(1200).describe('封面宽度（默认 1200，OG 标准）'),
      height: z.number().optional().default(630).describe('封面高度（默认 630，OG 标准）'),
    }),
    result: z.object({
      file: z.string(),
      width: z.number(),
      height: z.number(),
    }),
    examples: [
      { cmd: 'xbrowser "set-viewport 1200 630 && content cover --title \\"Self-Healing Replay\\" --output cover.png"', description: '链式设定视口后生成封面' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
      if (!page) throw new Error('需要浏览器页面');

      const width = params.width ?? 1200;
      const height = params.height ?? 630;
      // 默认路径锚定 ~/.xbrowser：daemon 常驻在它首次启动的目录，相对路径会
      // 落进无关项目（实测踩坑）。显式 --output 的相对路径同样按家目录解析。
      const outPath = path.resolve(
        params.output ?? path.join(os.homedir(), '.xbrowser', 'output', 'content', `cover-${Date.now()}.png`)
      );
      fs.mkdirSync(path.dirname(outPath), { recursive: true });

      // 视口若可编程设置则直接设；否则靠命令链前置 set-viewport
      const vp = page as unknown as { setViewportSize?: (size: { width: number; height: number }) => Promise<void> };
      if (typeof vp.setViewportSize === 'function') {
        await vp.setViewportSize({ width, height });
      }

      const htmlPath = path.join(os.tmpdir(), `xbrowser-cover-${Date.now()}.html`);
      fs.writeFileSync(htmlPath, renderCoverHtml(params.title, params.subtitle ?? ''), 'utf8');

      await page.goto(`file://${htmlPath}`);
      // 自研 CDP 驱动的 screenshot() 只返回 Buffer、忽略 path 选项（与 Playwright
      // 语义不同）——必须自己写文件，否则返回了路径但文件不存在（实测踩坑）。
      const png = (await page.screenshot({ type: 'png' })) as Buffer;
      fs.writeFileSync(outPath, png);

      const tips: string[] = [`封面已保存：${outPath}（${width}×${height}）`];
      if (typeof vp.setViewportSize !== 'function') {
        tips.push('当前驱动不支持编程设视口，请用链式前置：set-viewport 1200 630 && content cover …');
      }
      return ok({ file: outPath, width, height }, tips);
    },
  });
}
