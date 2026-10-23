/**
 * 通用 draft / publish 命令注册器。
 *
 * 五个内容站（掘金 / CSDN / 51CTO / 博客园 / OSChina）共享同一套命令契约：
 *
 * ```bash
 * xbrowser <site> draft   --title "T" --file a.md [--images c1.png,c2.png]
 * xbrowser <site> publish --title "T" --file a.md [--category "..."] [--summary "..."]
 * ```
 *
 * 通道：chrome-bridge 优先（复用用户登录态），不可用时回退本地 `ctx.page`。
 */

import { z } from 'zod/v4';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { CommandContext } from '@dyyz1993/xcli-core';
import type { PageAdapter, SitePublisher } from './channel.js';
import {
  extractLocalImagePaths,
  replaceImagePaths,
  uploadImagesForSite,
} from './image-upload.js';
import { createHttpBridge } from './bridge.js';
import { resolveChannel, readMarkdownFile } from './channel.js';

export interface SiteRegistrar {
  command(name: string, config: unknown): void;
}

export interface DraftOptions {
  title: string;
  content?: string;
  file?: string;
  images?: string;
  category?: string;
  summary?: string;
  tags?: string;
  source?: string;
  uid?: string;
}

export interface RegisterPublishingOptions {
  /** 编辑器 URL（本地通道用） */
  editorUrl: string;
  /** 站点协议 */
  publisher: SitePublisher;
  /** 从 markdown 派生摘要（缺省用 deriveSummary） */
  deriveSummary?: (markdown: string) => string;
  /** 图片插入锚点：从 markdown 里找哪行后面插封面 */
  coverAnchor?: RegExp;
  /** 注册哪些命令（缺省 draft + publish 都注册） */
  commands?: Array<'draft' | 'publish'>;
  /** 命令名覆盖（缺省就是 draft / publish） */
  commandNames?: Partial<Record<'draft' | 'publish', string>>;
}

/** 横版裁剪（16:9）——图片一律横版 */
async function landscapeCrop(path: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path]);
    const w = Number((stdout.match(/pixelWidth:\s*(\d+)/) || [])[1] || 0);
    const h = Number((stdout.match(/pixelHeight:\s*(\d+)/) || [])[1] || 0);
    const targetH = Math.round((w * 9) / 16);
    if (!w || !h || h <= targetH) return;
    const offsetY = Math.round((h - targetH) / 2);
    await execFileAsync('sips', [
      '-c', String(targetH), String(w),
      '--cropOffset', String(offsetY), '0',
      path, '--out', path,
    ]);
  } catch {
    // sips 不可用（非 macOS）或裁剪失败：不阻塞主流程
  }
}

/** 读取正文 + 插图（本地路径占位——上传后在 channel 内换成 CDN URL） */
async function loadBody(params: DraftOptions, options: RegisterPublishingOptions): Promise<string> {
  const raw = params.content || (params.file ? await readMarkdownFile(params.file) : '');
  if (!raw) return '';

  const imagePaths = (params.images || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!imagePaths.length) return raw;

  const lines = raw.split('\n');
  const out: string[] = [];
  let inserted = 0;
  for (const line of lines) {
    out.push(line);
    if (options.coverAnchor && inserted === 0 && options.coverAnchor.test(line)) {
      out.push('', `![配图 1](${imagePaths[0]})`);
      inserted++;
    }
  }
  while (inserted < imagePaths.length) {
    out.push('', `![配图 ${inserted + 1}](${imagePaths[inserted]})`);
    inserted++;
  }
  return out.join('\n');
}

/**
 * 上传本地图片并替换 markdown 里的路径为 CDN URL。
 *
 * 在 channel 内（编辑器已打开）执行：51CTO 的 paste 上传需要本站编辑器
 * 上下文；博客园/OSChina 走 CSDN 通用图床（跨站引用，实战实证）。
 * markdown 里已是 http(s) 的图不动——只换本地路径。
 */
async function uploadAndInlineImages(
  markdown: string,
  site: string,
  adapter: PageAdapter,
): Promise<{ markdown: string; uploaded: string[] }> {
  const localPaths = extractLocalImagePaths(markdown);
  if (!localPaths.length) return { markdown, uploaded: [] };

  const fsp = await import('node:fs/promises');
  const payloads: Array<{ path: string; base64: string }> = [];
  for (const p of localPaths) {
    try {
      const buf = await fsp.readFile(p);
      payloads.push({ path: p, base64: buf.toString('base64') });
    } catch {
      // 本地文件不存在：保留原路径（后续 setBody 校验会暴露）
    }
  }
  if (!payloads.length) return { markdown, uploaded: [] };

  // bridge 通道才有 CSDN 图床直传；本地通道下 51CTO paste 仍可用
  const bridge = createHttpBridge();
  const mapping = await uploadImagesForSite(site, adapter, bridge, payloads);
  return {
    markdown: replaceImagePaths(markdown, mapping),
    uploaded: Array.from(mapping.values()),
  };
}

/** 注册 draft / publish 命令 */
export function registerPublishingCommands(
  site: SiteRegistrar,
  options: RegisterPublishingOptions,
): void {
  const { editorUrl, publisher } = options;
  const wantDraft = (options.commands ?? ['draft', 'publish']).includes('draft');
  const wantPublish = (options.commands ?? ['draft', 'publish']).includes('publish');

  const resolveMarkdown = async (params: DraftOptions): Promise<string | null> => {
    const body = await loadBody(params, options);
    if (!body) return null;
    return body;
  };

  const parseList = (value?: string): string[] =>
    (value || '').split(',').map((s) => s.trim()).filter(Boolean);

  /**
   * 通道包装。
   *
   * `keepTab` 语义：
   * - **draft**：保留任务分组 tab——草稿要留在编辑器里给用户确认，
   *   关闭 tab 会让页面重载，51CTO 的自动保存会把内容清成 0 字。
   * - **publish**：发布完可以关，但关 tab 也可能触发重载；保守起见同样保留。
   *
   * bridge 任务分组由扩展侧管理（同名 task-open 会复用 tab），
   * 不主动关闭就不会丢内容。
   */
  const withChannel = async <T>(
    ctx: CommandContext,
    fn: (adapter: PageAdapter, channel: string) => Promise<T>,
  ): Promise<T> => {
    const page = ctx.page as never;
    const resolution = await resolveChannel({
      page,
      taskName: `pub-${publisher.site}`,
      localUrl: editorUrl,
    });
    return fn(resolution.adapter, resolution.channel);
  };

  const draftName = options.commandNames?.draft ?? 'draft';
  const publishName = options.commandNames?.publish ?? 'publish';

  if (wantDraft) {
    site.command(draftName, {
      description: `在 ${publisher.site} 编辑器填入文章（自动保存草稿，不发布）`,
      loginRequired: 'required',
      scope: 'page',
      parameters: z.object({
        title: z.string().describe('文章标题'),
        content: z.string().optional().describe('正文 Markdown（与 file 二选一）'),
        file: z.string().optional().describe('Markdown 文件路径（与 content 二选一）'),
        images: z.string().optional().describe('配图路径，逗号分隔（自动横版 16:9 裁剪）'),
        uid: z.string().optional().describe('站点用户 ID（OSChina 需要，可从个人空间 URL 取）'),
      }),
      result: z
        .object({
          title: z.string(),
          channel: z.string(),
          url: z.string(),
          chars: z.number(),
        })
        .passthrough(),
      examples: [
        { cmd: `xbrowser ${publisher.site} ${draftName} --title "T" --file a.md`, description: '填入草稿' },
      ],
      handler: async (params: DraftOptions, ctx: CommandContext) => {
        const markdown = await resolveMarkdown(params);
        if (markdown === null) return fail('必须提供 --content 或 --file 参数');
        const imagePaths = parseList(params.images);
        for (const p of imagePaths) await landscapeCrop(p);

        return withChannel(ctx, async (adapter, channel) => {
          try {
            await publisher.open(adapter, { uid: params.uid });
            // 本地配图先上传换 CDN URL（51CTO 走本站 paste，其余走 CSDN 图床）
            const { markdown: withCdn } = await uploadAndInlineImages(markdown, publisher.site, adapter);
            await publisher.setTitle(adapter, params.title);
            await publisher.setBody(adapter, withCdn);
            const url = await adapter.url();
            return ok(
              { title: params.title, channel, url, chars: withCdn.length },
              [`已填入 ${publisher.site} 编辑器（通道：${channel}），请确认后发布`],
            );
          } catch (e) {
            return fail(String(e instanceof Error ? e.message : e));
          }
        });
      },
    });
  }

  if (wantPublish) {
    site.command(publishName, {
      description: `在 ${publisher.site} 发布文章（自动填标题正文 + 提交）`,
      loginRequired: 'required',
      scope: 'page',
      parameters: z.object({
        title: z.string().describe('文章标题'),
        content: z.string().optional().describe('正文 Markdown（与 file 二选一）'),
        file: z.string().optional().describe('Markdown 文件路径（与 content 二选一）'),
        images: z.string().optional().describe('配图路径，逗号分隔（自动横版 16:9 裁剪）'),
        category: z.string().optional().describe('站点分类'),
        summary: z.string().optional().describe('文章摘要（不填则从正文自动提取）'),
        tags: z.string().optional().describe('标签，逗号分隔'),
        source: z.string().optional().describe('文章来源（原创/转载）'),
        uid: z.string().optional().describe('站点用户 ID（OSChina 需要，可从个人空间 URL 取）'),
      }),
      result: z
        .object({
          title: z.string(),
          channel: z.string(),
          published: z.boolean(),
          url: z.string().optional(),
          note: z.string().optional(),
        })
        .passthrough(),
      examples: [
        { cmd: `xbrowser ${publisher.site} ${publishName} --title "T" --file a.md`, description: '发布文章' },
      ],
      handler: async (params: DraftOptions, ctx: CommandContext) => {
        const markdown = await resolveMarkdown(params);
        if (markdown === null) return fail('必须提供 --content 或 --file 参数');
        const imagePaths = parseList(params.images);
        for (const p of imagePaths) await landscapeCrop(p);

        const summary =
          params.summary || (options.deriveSummary ? options.deriveSummary(markdown) : '');

        return withChannel(ctx, async (adapter, channel) => {
          try {
            await publisher.open(adapter, { uid: params.uid });
            // 本地配图先上传换 CDN URL（51CTO 走本站 paste，其余走 CSDN 图床）
            const { markdown: withCdn } = await uploadAndInlineImages(markdown, publisher.site, adapter);
            await publisher.setTitle(adapter, params.title);
            await publisher.setBody(adapter, withCdn);
            const result = await publisher.publish(adapter, {
              category: params.category,
              summary,
              tags: parseList(params.tags),
              source: params.source,
              uid: params.uid,
            });
            if (!result.published) return fail(result.note || '发布未完成');
            return ok(
              {
                title: params.title,
                channel,
                published: result.published,
                url: result.url,
                note: result.note,
              },
              [result.note || `已在 ${publisher.site} 发布（通道：${channel}）`],
            );
          } catch (e) {
            // 协议层抛错 = 操作失败，转 fail 而非抛异常（链式命令才能 fallback）
            return fail(String(e instanceof Error ? e.message : e));
          }
        });
      },
    });
  }
}
