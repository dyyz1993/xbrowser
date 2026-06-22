import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page, Locator } from '../types.js';

type Point = { x: number; y: number };

function gaussianRandom(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z0 * stdDev + mean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomInRange(min: number, max: number): number {
  return gaussianRandom((min + max) / 2, (max - min) / 6);
}

function sleep(ms: number): Promise<void> {
  // 测试环境跳过真实等待（human* 行为模拟函数会累积几十秒 sleep，拖垮单元测试）
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCJK(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0x4e00 && code <= 0x9fff;
}

function isPunctuation(char: string): boolean {
  return /[.,;:!?。，；：！？、…—]/.test(char);
}

function cubicBezier(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
): Point {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
  };
}

async function randomPause(minMs: number, maxMs: number): Promise<void> {
  const ms = clamp(Math.round(randomInRange(minMs, maxMs)), minMs, maxMs);
  await sleep(ms);
}

async function humanMouseMove(
  page: Page,
  targetX: number,
  targetY: number,
): Promise<void> {
  const startPos = await page.evaluate(() => {
    const w = window as unknown as Record<string, number>;
    return {
      x: w.__humanMouseX ?? Math.round(window.innerWidth / 2),
      y: w.__humanMouseY ?? Math.round(window.innerHeight / 2),
    };
  });

  const p0: Point = startPos as Point;
  const p3: Point = { x: targetX, y: targetY };

  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const offsetFactor = clamp(dist * 0.3, 20, 150);
  const p1: Point = {
    x: p0.x + dx * 0.25 + gaussianRandom(0, offsetFactor),
    y: p0.y + dy * 0.25 + gaussianRandom(0, offsetFactor),
  };
  const p2: Point = {
    x: p0.x + dx * 0.75 + gaussianRandom(0, offsetFactor),
    y: p0.y + dy * 0.75 + gaussianRandom(0, offsetFactor),
  };

  const steps = clamp(Math.round(dist / 8), 5, 80);
  const stepInterval = clamp(16 - dist / 200, 4, 16);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const pt = cubicBezier(p0, p1, p2, p3, eased);

    await page.mouse.move(pt.x, pt.y);
    await sleep(stepInterval + gaussianRandom(0, 2));
  }

  await page.evaluate(
    ([x, y]) => {
      (window as unknown as Record<string, number>).__humanMouseX = x;
      (window as unknown as Record<string, number>).__humanMouseY = y;
    },
    [targetX, targetY],
  );
}

async function humanType(
  locator: Locator,
  text: string,
): Promise<void> {
  await locator.focus();
  await randomPause(100, 300);

  const chars = [...text];
  let charIndex = 0;
  let nextLongPause = clamp(
    Math.round(gaussianRandom(15, 5)),
    10,
    20,
  );

  for (const char of chars) {
    charIndex++;
    await locator.pressSequentially(char, { delay: 0 });

    let delay: number;
    if (isCJK(char)) {
      delay = clamp(Math.round(gaussianRandom(120, 30)), 100, 200);
    } else {
      delay = clamp(Math.round(gaussianRandom(80, 20)), 50, 150);
    }

    if (char === ' ') {
      delay += clamp(Math.round(gaussianRandom(40, 15)), 20, 100);
    }

    if (isPunctuation(char)) {
      delay += clamp(Math.round(gaussianRandom(150, 50)), 100, 300);
    }

    if (charIndex >= nextLongPause) {
      delay += clamp(Math.round(gaussianRandom(350, 100)), 200, 600);
      nextLongPause =
        charIndex +
        clamp(Math.round(gaussianRandom(15, 5)), 10, 20);
    }

    await sleep(delay);
  }
}

async function humanPaste(
  locator: Locator,
  text: string,
): Promise<void> {
  await locator.click();
  await randomPause(200, 500);

  await locator.evaluate(
    (el: HTMLElement, content: string) => {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.value = content;
      } else if (el.isContentEditable) {
        el.textContent = content;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    text,
  );

  await randomPause(100, 300);
}

async function humanClick(
  page: Page,
  locator: Locator,
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('元素不可见或不存在，无法获取位置');
  }

  const targetX = box.x + box.width * clamp(Math.random(), 0.2, 0.8);
  const targetY = box.y + box.height * clamp(Math.random(), 0.2, 0.8);

  await humanMouseMove(page, targetX, targetY);
  await randomPause(50, 150);

  await page.mouse.click(targetX, targetY, {
    delay: clamp(Math.round(gaussianRandom(50, 20)), 30, 120),
  });
}

async function humanBrowse(
  page: Page,
  durationMs: number = 0,
): Promise<void> {
  const totalDuration = durationMs > 0 ? durationMs : clamp(Math.round(gaussianRandom(3500, 800)), 2000, 5000);
  const startTime = Date.now();

  const scrollCount = clamp(Math.round(gaussianRandom(2, 0.8)), 1, 3);
  for (let i = 0; i < scrollCount; i++) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= totalDuration) break;

    const scrollY = clamp(Math.round(gaussianRandom(250, 100)), 100, 400);
    await page.mouse.wheel(0, scrollY);
    await randomPause(300, 800);
  }

  const moveCount = clamp(Math.round(gaussianRandom(1.5, 0.5)), 1, 2);
  for (let i = 0; i < moveCount; i++) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= totalDuration) break;

    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    const rx = clamp(
      Math.round(gaussianRandom(viewport.width / 2, viewport.width / 4)),
      50,
      viewport.width - 50,
    );
    const ry = clamp(
      Math.round(gaussianRandom(viewport.height / 2, viewport.height / 4)),
      50,
      viewport.height - 50,
    );
    await humanMouseMove(page, rx, ry);
    await randomPause(200, 600);
  }

  if (Math.random() < 0.4) {
    try {
      const elements = page.locator('a, button, [role="link"], [role="button"]').filter({ visible: true });
      const count = await elements.count();
      if (count > 0) {
        const idx = Math.floor(Math.random() * count);
        const box = await elements.nth(idx).boundingBox();
        if (box) {
          await humanMouseMove(
            page,
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          await randomPause(300, 700);
        }
      }
    } catch {
      // 页面上没有可 hover 的元素，忽略
    }
  }

  const remaining = totalDuration - (Date.now() - startTime);
  if (remaining > 0) {
    await sleep(remaining);
  }
}

async function humanFill(
  page: Page,
  locator: Locator,
  text: string,
): Promise<void> {
  const len = [...text].length;

  if (len < 50) {
    await humanType(locator, text);
  } else if (len <= 500) {
    await humanType(locator, text);
  } else {
    await humanPaste(locator, text);
  }
}

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

      const result = await (comp.uploadImages as (files: File[]) => Promise<Array<{ url?: string }>>)([file]);
      return result?.[0]?.url || '';
    } catch (e: unknown) {
      throw new Error('Image upload failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, base64);

  if (!cdnUrl) throw new Error('Image upload returned empty URL');
  return cdnUrl;
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
    handler: async (params, ctx) => {
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

        await page.goto('https://juejin.cn/editor/draft', {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForLoadState('domcontentloaded');
        await randomPause(2800, 5200);
        await humanBrowse(page, 3000);

        const titleInput = page.locator(
          'input[placeholder*="输入文章标题"], input[class*="title-input"], input[name*="title"], input[placeholder*="标题"], input[data-testid*="title"]'
        ).first();
        if (await titleInput.isVisible().catch(() => false)) {
          await humanFill(page, titleInput, params.title);
        }

        await randomPause(350, 650);

        const editor = page.locator(
          'div[contenteditable="true"][class*="editor"], textarea[class*="editor"], div[class*="CodeMirror"], textarea[placeholder*="请输入"], div[contenteditable="true"][class*="CodeMirror"], div[contenteditable="true"][data-placeholder], textarea[id*="editor"]'
        ).first();
        if (await editor.isVisible().catch(() => false)) {
          await editor.click();
          await page.keyboard.insertText(content);
        }

        if (params.tags) {
          const tagsInput = page.locator(
            'input[placeholder*="标签"], input[placeholder*="tag"], input[class*="tag-input"], input[placeholder*="添加标签"]'
          ).first();
          if (await tagsInput.isVisible().catch(() => false)) {
            const tags = params.tags.split(',');
            for (const tag of tags) {
              await humanFill(page, tagsInput, tag.trim());
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
            'button:has-text("确认发布"), button:has-text("确定")'
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
        return fail(error instanceof Error ? error.message : '未知错误', cdpTips);
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

        // Set title
        const titleInput = page.locator(
          'input[placeholder*="输入文章标题"], input[class*="title-input"], input[name*="title"], input[placeholder*="标题"]'
        ).first();
        if (await titleInput.isVisible().catch(() => false)) {
          await humanFill(page, titleInput, params.title);
        }

        await randomPause(350, 650);

        // Set content via CodeMirror
        await page.evaluate((md: string) => {
          const cm = document.querySelector('.CodeMirror') as unknown as { CodeMirror?: { setValue(v: string): void } };
          if (cm?.CodeMirror) {
            cm.CodeMirror.setValue(md);
            return 'OK';
          }
          return 'NO_CM';
        }, content as unknown as string);

        // Wait for auto-save
        await randomPause(2000, 3500);

        return ok({
          title: params.title,
          saved: true,
          url: page.url(),
          uploadedImages: uploadedImages.length > 0 ? uploadedImages : undefined,
        }, [...cdpTips, `草稿 "${params.title}" 已保存`, uploadedImages.length > 0 ? `已上传 ${uploadedImages.length} 张图片到掘金 CDN` : ''].filter(Boolean));
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', cdpTips);
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
