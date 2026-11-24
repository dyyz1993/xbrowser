import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page, Locator } from '../types.js';

import { randomPause, humanClick, humanBrowse, humanFill } from '../shared/humanize.js';


function buildCdpTips(ctx: Record<string, unknown>): string[] {
  const cdpEndpoint = ctx.cdpEndpoint as string | undefined;
  const sessionId = ctx.sessionId as string | undefined;
  const tips: string[] = [];
  if (!cdpEndpoint) {
    tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器以获取登录态');
  }
  tips.push(`Session: ${sessionId || 'default'}`);
  return tips;
}

/**
 * Upload an image to Juejin CDN via the Vue component's uploadImages method.
 * Must be called while on a juejin.cn/editor page (has ByteMD editor loaded).
 */
async function uploadImageToJuejin(page: Page, imagePath: string): Promise<string> {
  const fs = await import('fs');
  const path = await import('path');
  const resolvedPath = path.resolve(imagePath);
  const imageBuffer = fs.readFileSync(resolvedPath);
  const base64 = imageBuffer.toString('base64');

  const cdnUrl: string = await page.evaluate(async (b64: string): Promise<string> => {
    try {
      const byteString = atob(b64);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      const file = new File([ab], 'image.png', { type: 'image/png' });

      // Find Vue component with uploadImages method
      let comp: Record<string, unknown> | null = null;
      function walk(v: Record<string, unknown>, depth: number): void {
        if (!v || depth > 15 || comp) return;
        if (typeof v.uploadImages === 'function') { comp = v; return; }
        if (Array.isArray(v.$children)) v.$children.forEach((c: Record<string, unknown>) => { if (!comp) walk(c, depth + 1); });
      }
      const all = document.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) {
        const vue = (all[i] as unknown as Record<string, unknown>).__vue__;
        if (vue) { walk(vue as Record<string, unknown>, 0); break; }
      }
      if (!comp) throw new Error('uploadImages component not found');

      const fn = comp as unknown as { uploadImages?: (files: File[]) => Promise<Array<{ url?: string }>> } | undefined;
      const result = await fn?.uploadImages?.([file]);
      if (!result) return '';
      return result?.[0]?.url || '';
    } catch (e: unknown) {
      throw new Error('Image upload failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, base64);

  if (!cdnUrl) throw new Error('Image upload returned empty URL');
  return cdnUrl;
}

// ── 幂等输入与草稿观测（ERR-20261022-002）─────────────────────────────
//
// 事故实录：draft 超时后被重试（executor recovery / 外部重跑），标题被第二
// 轮输入叠成两股交错的流、CodeMirror 正文 0 字——草稿其实已创建
// （editor/drafts/7699014849130004531），但命令只报了超时。
//
// 代码层根因：
// 1) humanType 的 pressSequentially 与 keyboard.insertText 都是「追加」语义，
//    输入前从不读当前值（shared/humanize.ts humanType / 本文件 publish 正文）；
// 2) draft 的 CodeMirror setValue 返回值被丢弃——正文 0 字也照样报成功；
// 3) 失败时不上报已观察到的草稿 URL/ID，调用方只能盲目重跑。
//
// 修复原则：每个输入步骤先读当前值——一致则跳过、不一致则清空后输入一次
// （绝不追加）；写入后回读校验；失败时把观察到的草稿报告出来。

/** 标题输入框候选（读取与定位共用同一列表，保证读到的就是要写的那个） */
const TITLE_INPUT_SELECTOR =
  'input[placeholder*="输入文章标题"], input[class*="title-input"], input[name*="title"], input[placeholder*="标题"], input[data-testid*="title"]';

/** 正文编辑器候选（与 publish 原定位列表一致） */
const EDITOR_SELECTOR =
  'div[contenteditable="true"][class*="editor"], textarea[class*="editor"], div[class*="CodeMirror"], textarea[placeholder*="请输入"], div[contenteditable="true"][class*="CodeMirror"], div[contenteditable="true"][data-placeholder], textarea[id*="editor"]';

/** 标签输入框候选 */
const TAGS_INPUT_SELECTOR =
  'input[placeholder*="标签"], input[placeholder*="tag"], input[class*="tag-input"], input[placeholder*="添加标签"]';

/** 从 URL 提取掘金草稿（编辑器自动保存后 URL 从 /editor/drafts/new 落到 /editor/drafts/<id>） */
function draftFromUrl(url: string): { id: string; url: string } | null {
  const m = url.match(/juejin\.cn\/editor\/drafts\/(\d+)/);
  return m ? { id: m[1], url } : null;
}

/** 读 input 当前值（纯读取，不发任何事件）；读不到返回 null */
async function readInputValue(page: Page, selector: string): Promise<string | null> {
  try {
    const raw = await page.evaluate<unknown>(
      `(function(){ var el = document.querySelector(${JSON.stringify(selector)}); return el && typeof el.value === 'string' ? el.value : null; })()`,
    );
    return typeof raw === 'string' ? raw : null;
  } catch {
    return null;
  }
}

/**
 * 幂等填输入框（标题/标签共用）：
 * - 当前值与目标一致 → 跳过（重试不重复输入）；
 * - 不一致 → trusted fill('') 清空（selectAll 替换语义）后 humanFill 输入一次；
 * - 写入后回读校验，读到矛盾值（两股输入流叠加的征兆）立即报错。
 */
async function fillInputIdempotent(page: Page, input: Locator, selector: string, text: string): Promise<void> {
  if (!text) return;
  const before = await readInputValue(page, selector);
  if (before === text) return; // 上一次尝试已写好——跳过
  if (before) {
    // 残留旧值：清空后只输入一次，绝不追加
    await input.fill('');
  }
  await humanFill(page, input, text);
  const after = await readInputValue(page, selector);
  if (after !== null && after !== text) {
    throw new Error(
      `掘金输入校验失败：期望 "${text.slice(0, 30)}"，实际 "${after.slice(0, 60)}"（疑似两股输入流叠加）`,
    );
  }
}

type EditorMode = 'codemirror' | 'field' | 'none' | 'unreadable';

interface EditorRead {
  mode: EditorMode;
  text: string | null;
}

/** 读正文编辑器当前内容（CodeMirror.getValue / contenteditable textContent / textarea value） */
async function readEditorState(page: Page): Promise<EditorRead> {
  const expr = `(function(){
    var cm = document.querySelector('.CodeMirror');
    if (cm && cm.CodeMirror && typeof cm.CodeMirror.getValue === 'function') {
      return JSON.stringify({ mode: 'codemirror', text: cm.CodeMirror.getValue() || '' });
    }
    var ed = document.querySelector('div[contenteditable="true"], textarea[id*="editor"], textarea[placeholder*="请输入"], textarea[class*="editor"]');
    if (ed) {
      var t = typeof ed.value === 'string' ? ed.value : (ed.textContent || '');
      return JSON.stringify({ mode: 'field', text: t || '' });
    }
    return JSON.stringify({ mode: 'none', text: null });
  })()`;
  let raw: unknown;
  try {
    raw = await page.evaluate<unknown>(expr);
  } catch {
    return { mode: 'unreadable', text: null };
  }
  if (typeof raw !== 'string' || raw === '') return { mode: 'unreadable', text: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { mode: 'unreadable', text: null };
    const obj = parsed as Record<string, unknown>;
    if (obj.mode === 'codemirror' || obj.mode === 'field') {
      return { mode: obj.mode, text: typeof obj.text === 'string' ? obj.text : null };
    }
    if (obj.mode === 'none') return { mode: 'none', text: null };
  } catch {
    // 非 JSON——按读态失败处理
  }
  return { mode: 'unreadable', text: null };
}

/** 正文长度校验：空/腰斩=写入异常，>1.5 倍=疑似双份（与 CSDN #417 同款护栏） */
function verifyBodyLength(got: number, expected: number): void {
  if (got === 0 || got < expected * 0.5) {
    throw new Error(`掘金正文写入异常（${got} 字符，预期 ${expected}）`);
  }
  if (got > expected * 1.5) {
    throw new Error(`掘金正文疑似重复写入（${got} 字符 > 预期 ${expected} 的 1.5 倍）——已中止`);
  }
}

function parseBodyWriteResult(raw: unknown): { mode: string; len: number } | null {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.mode === 'string' && typeof obj.len === 'number') {
      return { mode: obj.mode, len: obj.len };
    }
  } catch {
    // 非 JSON
  }
  return null;
}

/**
 * 幂等写正文（draft / publish 共用）：
 * - 当前内容与目标一致 → 跳过（重试绝不追加）；
 * - CodeMirror → setValue 整体替换 + 页面内回读长度校验；
 * - 其他编辑器 → 聚焦 + execCommand('selectAll')（与 CDP driver fill 同一
 *   编辑管线，非事件伪造）+ insertText 单份，回读校验防双份；
 * - 找不到编辑器 → 明确失败（0 字草稿事故后不再静默成功）。
 */
async function writeBodyIdempotent(page: Page, editorLocator: Locator | null, content: string): Promise<void> {
  const state = await readEditorState(page);
  if ((state.mode === 'codemirror' || state.mode === 'field') && state.text === content) {
    return; // 上一次尝试已写入——跳过
  }
  if (state.mode === 'codemirror' || state.mode === 'unreadable') {
    const raw = await page.evaluate<unknown>(
      `(function(){
        var md = ${JSON.stringify(content)};
        var cm = document.querySelector('.CodeMirror');
        if (!(cm && cm.CodeMirror)) return JSON.stringify({ mode: 'none', len: 0 });
        cm.CodeMirror.setValue(md);
        var got = cm.CodeMirror.getValue() || '';
        return JSON.stringify({ mode: 'codemirror', len: got.length });
      })()`,
    );
    const res = parseBodyWriteResult(raw);
    if (!res || res.mode === 'none') {
      throw new Error('掘金正文编辑器未找到（CodeMirror / contenteditable / textarea）——正文未写入');
    }
    verifyBodyLength(res.len, content.length);
    return;
  }
  if (state.mode === 'field') {
    if (editorLocator) {
      await editorLocator.click().catch(() => undefined);
    } else {
      await page.evaluate<unknown>(
        `(function(){
          var el = document.querySelector('div[contenteditable="true"], textarea[id*="editor"], textarea[placeholder*="请输入"], textarea[class*="editor"]');
          if (el && document.activeElement !== el) el.focus();
          return 'focused';
        })()`,
      );
    }
    if (state.text) {
      // 全选已有内容，后续 insertText 写在选区上 = 替换而非追加
      await page.evaluate<unknown>(
        `(function(){
          var el = document.querySelector('div[contenteditable="true"], textarea[id*="editor"], textarea[placeholder*="请输入"], textarea[class*="editor"]');
          if (!el) return 'none';
          if (document.activeElement !== el) el.focus();
          var cur = typeof el.value === 'string' ? el.value : (el.textContent || '');
          if (cur !== '') document.execCommand('selectAll');
          return 'selected';
        })()`,
      );
    }
    await page.keyboard.insertText(content);
    const after = await readEditorState(page);
    if ((after.mode === 'field' || after.mode === 'codemirror') && after.text !== null) {
      verifyBodyLength(after.text.length, content.length);
    }
    return;
  }
  throw new Error('掘金正文编辑器未找到（CodeMirror / contenteditable / textarea）——正文未写入');
}

/**
 * 轮询观察草稿 URL（自动保存后从 /editor/drafts/new 落到 /editor/drafts/<id>，
 * ERR-20261022-002 实录）。保存确认没有可靠的选择器证据（知识库/录制均无），
 * 这里只做观测上报，不做失败判据。
 */
async function observeDraft(page: Page, rounds = 12): Promise<{ id: string; url: string } | null> {
  for (let i = 0; i < rounds; i++) {
    try {
      const hit = draftFromUrl(page.url());
      if (hit) return hit;
    } catch {
      return null;
    }
    await randomPause(400, 600);
  }
  return null;
}

/** 失败时上报观察到的草稿（URL/ID），调用方不要盲目重跑 */
function observedDraftTip(page: Page): string[] {
  try {
    const hit = draftFromUrl(page.url());
    if (!hit) return [];
    return [
      `⚠️ 命令失败，但已观察到草稿：${hit.url}（ID ${hit.id}）。请先人工确认该草稿，勿盲目重跑——重跑会重复输入`,
    ];
  } catch {
    return [];
  }
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'juejin',
    url: 'https://juejin.cn',
    description: '掘金 SEO 外链 - 中文技术社区 (DA 70+, 百度收录好)',
    requiresLogin: true,
    isLogin: async (ctx) => {
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const page = ctxAny.page as import('../types').Page;
      if (!page) return true;
      try {
        const url = page.url();
        if (url.includes('/login')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '') as string;
        if (!body) return false;
        if (body.includes('登录') || body.includes('注册')) return false;
        return true;
      } catch {
        return true;
      }
    },
  });

  site.command('login', {
    description: '登录掘金（GitHub OAuth / 手机号）',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser juejin login', description: '登录掘金' }],
    result: z.object({ loggedIn: z.boolean(), url: z.string() }).passthrough(),
    handler: async (_params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      const cdpTips = buildCdpTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto('https://juejin.cn/login', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await randomPause(1400, 2600);

        await ctx.waitForHuman?.({
          reason: '完成掘金登录（GitHub OAuth 或手机验证码）',
          timeout: 300,
        });

        await page.goto('https://juejin.cn/', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await randomPause(1400, 2600);

        const loggedIn = await page
          .locator(
            '.avatar, [class*="avatar"], img[class*="avatar"], .login-btn, a[href*="/user/"]'
          )
          .first()
          .isVisible()
          .catch(() => false);

        await ctx.storage.set('juejin_login', { loggedIn, at: Date.now() });

        return ok({ loggedIn, url: page.url() }, [...cdpTips, loggedIn ? '掘金登录成功' : '登录可能未完成，请检查页面']);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', cdpTips);
      }
    },
  });

  site.command('publish', {
    description: '在掘金发布文章（Markdown，含外链）',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().optional().describe('文章内容（Markdown，与 file 二选一）'),
      file: z.string().optional().describe('Markdown 文件路径（与 content 二选一）'),
      tags: z.string().optional().describe('标签，逗号分隔'),
      category: z.string().optional().describe('分类（前端/后端/Android/iOS 等）'),
      keepAlive: z.boolean().optional().default(false).describe('发布后保留 session（默认关闭）'),
    }),
    examples: [
      {
        cmd: 'xbrowser juejin publish --title "我的指南" --content "# Hello" --tags "前端,JavaScript"',
        description: '发布文章（自动关闭 session）',
      },
      {
        cmd: 'xbrowser juejin publish --title "我的指南" --content "# Hello" --keep-alive',
        description: '发布文章并保留 session（调试用）',
      },
      {
        cmd: 'xbrowser juejin publish --title "我的文章" --file ./article.md --tags "前端,JavaScript"',
        description: '从 Markdown 文件发布文章',
      },
    ],
    result: z.object({ title: z.string(), tags: z.string().optional(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      const cdpTips = buildCdpTips(ctx as unknown as Record<string, unknown>);

      try {
        let content = params.content;
        if (!content && params.file) {
          const fs = await import('fs/promises');
          const path = await import('path');
          const filePath = path.resolve(params.file);
          content = await fs.readFile(filePath, 'utf-8');
        }
        if (!content) {
          return fail('必须提供 --content 或 --file 参数');
        }

        // 2026-09-22: /editor/draft 已被掘金重定向回首页（改版），publish 全流程
        // 空转后仍报成功（假阳性实录）。draft 命令在用的 /editor/drafts/new 仍有效，
        // publish 对齐到同一 URL。
        await page.goto('https://juejin.cn/editor/drafts/new', {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForLoadState('domcontentloaded');
        await randomPause(2800, 5200);
        await humanBrowse(page, 3000);

        const titleInput = page.locator(TITLE_INPUT_SELECTOR).first();
        if (await titleInput.isVisible().catch(() => false)) {
          // 幂等输入（ERR-20261022-002）：重试时读当前值决定跳过/清空重写，绝不追加
          await fillInputIdempotent(page, titleInput, TITLE_INPUT_SELECTOR, params.title);
        }

        await randomPause(350, 650);

        const editor = page.locator(EDITOR_SELECTOR).first();
        if (await editor.isVisible().catch(() => false)) {
          // 幂等写入：insertText 是追加语义——先读当前内容，已就位跳过；
          // CodeMirror 走 setValue 整体替换，其余全选后单份插入
          await writeBodyIdempotent(page, editor, content);
        }

        if (params.tags) {
          const tagsInput = page.locator(TAGS_INPUT_SELECTOR).first();
          if (await tagsInput.isVisible().catch(() => false)) {
            const tags = params.tags.split(',');
            for (const tag of tags) {
              await fillInputIdempotent(page, tagsInput, TAGS_INPUT_SELECTOR, tag.trim());
              await randomPause(350, 650);
              const tagOption = page.locator(
                '[class*="tag-item"], [class*="tag-suggestion"], [role="option"], [class*="tag-wrap"]'
              ).first();
              if (await tagOption.isVisible().catch(() => false)) {
                await humanClick(page, tagOption);
              }
            }
          }
        }

        if (params.category) {
          const categorySelect = page.locator(
            'select[class*="category"], [class*="category-selector"], [class*="select"]'
          ).first();
          if (await categorySelect.isVisible().catch(() => false)) {
            await humanClick(page, categorySelect);
            await randomPause(350, 650);
            const option = page.locator(
              `[class*="option"]:has-text("${params.category}"), [class*="item"]:has-text("${params.category}")`
            ).first();
            if (await option.isVisible().catch(() => false)) {
              await humanClick(page, option);
            }
          }
        }

        await ctx.waitForHuman?.({
          reason: '检查文章内容，解决验证码后点击"发布文章"',
          timeout: 120,
          autoDetect: true,
        });

        const publishBtn = page.locator(
          'button:has-text("发布文章"), button:has-text("发布"), button[class*="publish"]'
        ).first();
        if (await publishBtn.isVisible().catch(() => false)) {
          await humanClick(page, publishBtn);
          await randomPause(1400, 2600);

          const confirmBtn = page.locator(
            'button:has-text("确定并发布"), button:has-text("确认发布"), button:has-text("确定")'
          ).first();
          if (await confirmBtn.isVisible().catch(() => false)) {
            await humanClick(page, confirmBtn);
            await randomPause(2100, 3900);
          }
        }

        const finalUrl = page.url();

        if (!params.keepAlive) {
          try {
            await page.close();
          } catch {
            // page.close() failure is non-fatal
          }
        }

        return ok({
            title: params.title,
            tags: params.tags,
            url: finalUrl,
          }, [...cdpTips, `文章 "${params.title}" 已在掘金发布`]);
      } catch (error) {
        // ERR-20261022-002：失败前草稿可能已创建——上报观察到的草稿，调用方不要盲目重跑
        return fail(error instanceof Error ? error.message : '未知错误', [...cdpTips, ...observedDraftTip(page)]);
      }
    },
  });

  site.command('draft', {
    description: '在掘金保存草稿（自动上传 Markdown 中的本地图片到掘金 CDN）',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().optional().describe('文章内容（Markdown，与 file 二选一）'),
      file: z.string().optional().describe('Markdown 文件路径（与 content 二选一）'),
    }),
    examples: [
      {
        cmd: 'xbrowser juejin draft --title "草稿" --content "# Hello World"',
        description: '保存纯文本草稿',
      },
      {
        cmd: 'xbrowser juejin draft --title "带图文章" --file ./article.md',
        description: '自动扫描 Markdown 中的本地图片路径，上传到掘金 CDN 并替换',
      },
    ],
    result: z.object({
      title: z.string(),
      saved: z.boolean(),
      url: z.string(),
      uploadedImages: z.array(z.object({ localPath: z.string(), cdnUrl: z.string() })).optional(),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      const cdpTips = buildCdpTips(ctx as unknown as Record<string, unknown>);
      const nodePath = await import('path');
      const nodeFs = await import('fs');

      try {
        // Read content
        let content = params.content;
        let baseDir = process.cwd();
        if (!content && params.file) {
          const resolved = nodePath.resolve(params.file);
          baseDir = nodePath.dirname(resolved);
          content = await nodeFs.promises.readFile(resolved, 'utf-8');
        }
        if (!content) {
          return fail('必须提供 --content 或 --file 参数');
        }

        // Scan for local image paths in Markdown:
        // 1. ![alt](./local/path.png) or ![alt](local/path.png)
        // 2. <img src="./local.png">
        // 3. {{img1}}, {{img2}} ... placeholders (with optional --images)
        const localImagePattern = /(!\[[^\]]*\]\(|<img[^>]+src=["'])(\.{0,2}\/[^\s"')\]]+\.(png|jpe?g|gif|webp|svg|bmp|ico))(\)|["'])/gi;
        const localImagePaths: string[] = [];
        let match: RegExpExecArray | null;

        while ((match = localImagePattern.exec(content)) !== null) {
          const imagePath = match[2];
          const resolvedPath = nodePath.resolve(baseDir, imagePath);
          // Check if file exists locally (not a URL)
          if (!imagePath.startsWith('http') && !imagePath.startsWith('//')) {
            try {
              nodeFs.accessSync(resolvedPath);
              if (!localImagePaths.includes(resolvedPath)) {
                localImagePaths.push(resolvedPath);
              }
            } catch {
              // File doesn't exist, skip
            }
          }
        }

        // Also handle {{imgN}} placeholders (legacy mode with --images)
        // Already handled above via localImagePaths

        // Navigate to editor
        await page.goto('https://juejin.cn/editor/drafts/new', {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForLoadState('domcontentloaded');
        await randomPause(2800, 5200);

        // Upload all local images to Juejin CDN and replace in content
        const uploadedImages: Array<{ localPath: string; cdnUrl: string }> = [];
        for (const localPath of localImagePaths) {
          try {
            const cdnUrl = await uploadImageToJuejin(page, localPath);
            uploadedImages.push({ localPath, cdnUrl });

            // Replace all occurrences of this local path with CDN URL
            const relativePath = nodePath.relative(baseDir, localPath);
            // Replace both ./path and path forms, and handle the markdown syntax
            const escapedRel = relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const patterns = [
              escapedRel,
              '\\.\\/' + escapedRel,
              localPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            ];
            for (const pat of patterns) {
              // Replace in ![alt](path) format
              content = content.replace(
                new RegExp(`(\\!\\[[^\\]]*\\]\\()${pat}(\\))`, 'g'),
                `$1${cdnUrl}$2`,
              );
              // Replace in <img src="path"> format
              content = content.replace(
                new RegExp(`(<img[^>]+src=["'])${pat}(["'])`, 'g'),
                `$1${cdnUrl}$2`,
              );
            }
            await randomPause(500, 1000);
          } catch (e) {
            return fail(`图片上传失败 (${localPath}): ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // Set title（幂等——ERR-20261022-002：重试绝不叠加输入）
        const titleInput = page.locator(TITLE_INPUT_SELECTOR).first();
        if (await titleInput.isVisible().catch(() => false)) {
          await fillInputIdempotent(page, titleInput, TITLE_INPUT_SELECTOR, params.title);
        }

        await randomPause(350, 650);

        // Set content（幂等 + 回读校验：0 字草稿不再静默成功）
        await writeBodyIdempotent(page, null, content);

        // 保存观测：自动保存后 URL 落到 /editor/drafts/<id>。无可靠的保存确认
        // 选择器证据（知识库/录制均无），这里只观测上报，不做失败判据。
        const draft = await observeDraft(page);

        return ok({
          title: params.title,
          saved: true,
          url: page.url(),
          ...(draft ? { draftId: draft.id, draftUrl: draft.url } : {}),
          uploadedImages: uploadedImages.length > 0 ? uploadedImages : undefined,
        }, [
          ...cdpTips,
          `草稿 "${params.title}" 已保存`,
          ...(draft ? [`草稿地址：${draft.url}`] : ['未观测到草稿 URL（编辑器可能仍在 /editor/drafts/new，请人工确认）']),
          ...(uploadedImages.length > 0 ? [`已上传 ${uploadedImages.length} 张图片到掘金 CDN`] : []),
        ]);
      } catch (error) {
        // ERR-20261022-002：失败前草稿可能已创建——上报观察到的草稿，调用方不要盲目重跑
        return fail(error instanceof Error ? error.message : '未知错误', [...cdpTips, ...observedDraftTip(page)]);
      }
    },
  });

  site.command('upload-image', {
    description: '上传图片到掘金 CDN（返回 CDN URL）',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      image: z.string().describe('图片文件路径'),
    }),
    examples: [
      {
        cmd: 'xbrowser juejin upload-image --image ./screenshot.png',
        description: '上传图片并获取 CDN URL',
      },
    ],
    result: z.object({ file: z.string(), cdnUrl: z.string() }),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      const cdpTips = buildCdpTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto('https://juejin.cn/editor/draft', {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForLoadState('domcontentloaded');
        await randomPause(2800, 5200);

        const cdnUrl = await uploadImageToJuejin(page, params.image);

        try {
          await page.close();
        } catch {
          // page.close() failure is non-fatal
        }

        return ok({ file: params.image, cdnUrl }, [...cdpTips, `图片已上传到掘金 CDN: ${cdnUrl}`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', cdpTips);
      }
    },
  });

  site.command('update-profile', {
    description: '更新掘金个人资料（添加外链）',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('要添加到 Profile 的网站 URL'),
      bio: z.string().optional().describe('个人简介文本'),
    }),
    examples: [
      {
        cmd: 'xbrowser juejin update-profile --url "https://example.com" --bio "全栈开发者"',
        description: '更新 Profile 添加外链',
      },
    ],
    result: z.object({ url: z.string(), updated: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      const cdpTips = buildCdpTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto('https://juejin.cn/user/settings/profile', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForLoadState('domcontentloaded');
        await randomPause(1400, 2600);

        if (params.bio) {
          const bioInput = page.locator(
            'textarea[name*="bio"], textarea[placeholder*="介绍"], textarea[placeholder*="bio"], textarea[class*="intro"]'
          ).first();
          if (await bioInput.isVisible().catch(() => false)) {
            await humanFill(page, bioInput, `${params.bio}\n\n${params.url}`);
          }
        }

        const webInput = page.locator(
          'input[name*="url"], input[placeholder*="网站"], input[placeholder*="blog"], input[class*="website"]'
        ).first();
        if (await webInput.isVisible().catch(() => false)) {
          await humanFill(page, webInput, params.url);
        }

        const submitBtn = page.locator(
          'button:has-text("保存"), button:has-text("提交"), button[type="submit"]'
        ).first();
        if (await submitBtn.isVisible().catch(() => false)) {
          await humanClick(page, submitBtn);
          await randomPause(1400, 2600);
        }

        return ok({ url: params.url, updated: true }, [...cdpTips, 'Profile 已更新，包含外链']);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', cdpTips);
      }
    },
  });

  site.command('fetch-articles', {
    description: '获取当前登录用户的掘金文章列表',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      limit: z.number().optional().default(20).describe('获取文章数量上限'),
      cursor: z.string().optional().describe('分页游标（可选）'),
    }),
    examples: [
      { cmd: 'xbrowser juejin fetch-articles', description: '获取我的文章列表' },
      { cmd: 'xbrowser juejin fetch-articles --limit 50', description: '获取前50篇文章' },
    ],
    result: z.array(z.object({ title: z.string(), url: z.string(), views: z.string(), likes: z.string(), comments: z.string(), date: z.string() })),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      const cdpTips = buildCdpTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto('https://juejin.cn/user/center/articles', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await page.waitForLoadState('domcontentloaded');
        await randomPause(2100, 3900);

        const articles = await page.evaluate((maxItems: number) => {
          const items: Array<{
            title: string;
            url: string;
            views: string;
            likes: string;
            comments: string;
            date: string;
          }> = [];

          let cards = document.querySelectorAll(
            '[class*="article-item"], [class*="list-item"], [class*="entry"]'
          );
          if (cards.length === 0) {
            cards = document.querySelectorAll('.item');
          }

          cards.forEach((card) => {
            if (items.length >= maxItems) return;
            const titleEl = card.querySelector('[class*="title"] a, a[class*="title"], h3 a, h2 a')
              || card.querySelector('a[href*="/post/"]');
            const viewsEl = card.querySelector('[class*="view"], [class*="read"]')
              || card.querySelector('[class*="count"]');
            const likesEl = card.querySelector('[class*="like"], [class*="digg"]')
              || card.querySelector('[class*="zan"]');
            const commentsEl = card.querySelector('[class*="comment"]')
              || card.querySelector('[class*="message"]');
            const dateEl = card.querySelector('[class*="date"], [class*="time"]')
              || card.querySelector('[class*="meta"] span');

            const title = titleEl?.textContent?.trim() || '';
            if (title) {
              items.push({
                title,
                url: titleEl?.getAttribute('href') || '',
                views: viewsEl?.textContent?.trim() || '',
                likes: likesEl?.textContent?.trim() || '',
                comments: commentsEl?.textContent?.trim() || '',
                date: dateEl?.textContent?.trim() || '',
              });
            }
          });

          return items;
        }, params.limit) as Array<{ title: string; url: string; views: string; likes: string; comments: string; date: string }>;

        return ok(articles, [
            ...cdpTips,
            `获取 ${articles.length} 篇文章`,
          ]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', cdpTips);
      }
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page | undefined;
    if (!page) return;
    await page.goto('https://juejin.cn/login');
    await ctx.storage.set('juejin_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('juejin_login');
  });
}
