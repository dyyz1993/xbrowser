import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page, Locator } from '../../src/browser-shim.js';

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

  const p0: Point = startPos;
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

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'devto',
    url: 'https://dev.to',
    description: 'Dev.to SEO 外链 - 开发者社区 (DA 51, UGC/nofollow, 高流量)',
    requiresLogin: true,
    loginConfig: {
      loginUrls: ['/login', '/signin', '/auth'],
      loginSelectors: ['[class*="login"]', '[class*="signin"]'],
      captchaSelectors: ['[class*="captcha"]', '[class*="verify"]'],
      loginKeywords: ['Sign in', 'Log in'],
      loggedInSelectors: ['[class*="avatar"]', '[data-testid*="avatar"]'],
      loginPrompt: 'This site requires login. Use --cdp to connect a logged-in browser.',
    },
    isLogin: async (ctx) => {
      const ctxAny = ctx as Record<string, unknown>;
      const page = ctxAny.page as import('../types').Page;
      if (!page) return true;
      try {
        const url = page.url();
        if (url.includes('/enter') || url.includes('/login')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '');
        if (!body) return false;
        if (body.includes('Sign in')) return false;
        return true;
      } catch {
        return true;
      }
    },
  });

  site.command('login', {
    description: '登录 Dev.to（GitHub OAuth / 邮箱）',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser devto login', description: '登录 Dev.to' }],
    result: z.object({ loggedIn: z.boolean(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('../types').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://dev.to/enter', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      await ctx.waitForHuman?.({
        reason: 'Complete Dev.to login (GitHub OAuth or email)',
        timeout: 300,
      });

      await page.goto('https://dev.to/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      const loggedIn = await page
        .locator(
          'a[href*="/signout"], button[aria-label*="Sign Out"], [data-testid="user-menu"], .crayons-header--user-navigation'
        )
        .first()
        .isVisible()
        .catch(() => false);

      await ctx.storage.set('devto_login', { loggedIn, at: Date.now() });

      return ok({ loggedIn, url: page.url() }, [loggedIn ? 'Dev.to 登录成功' : '登录可能未完成，请检查页面']);
    },
  });

  site.command('publish', {
    description: '在 Dev.to 发布文章（Markdown，含外链）',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().optional().describe('文章内容（Markdown，与 file 二选一）'),
      file: z.string().optional().describe('Markdown 文件路径（与 content 二选一）'),
      tags: z.string().optional().describe('标签，逗号分隔（最多4个）'),
      keepAlive: z.boolean().optional().default(false).describe('发布后保留 session（默认关闭）'),
    }),
    examples: [
      {
        cmd: 'xbrowser devto publish --title "My Guide" --content "# Hello" --tags "webdev"',
        description: '发布文章（自动关闭 session）',
      },
      {
        cmd: 'xbrowser devto publish --title "My Guide" --content "# Hello" --keep-alive',
        description: '发布文章并保留 session（调试用）',
      },
      {
        cmd: 'xbrowser devto publish --title "My Article" --file ./article.md --tags "webdev,cli"',
        description: '从 Markdown 文件发布文章',
      },
    ],
    result: z.object({ title: z.string(), tags: z.string().optional(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('../types').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

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

      await page.goto('https://dev.to/new', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('domcontentloaded');
      await humanBrowse(page, 3000);

      const titleInput = page.locator(
        'textarea#article-form-title, input#article_title, input[name="article[title]"], textarea[aria-label="Post Title"]'
      ).first();
      if (await titleInput.isVisible().catch(() => false)) {
        await humanFill(page, titleInput, params.title);
      }

      const bodyInput = page.locator(
        'textarea#article_body_markdown, textarea[name="article[body_markdown]"], textarea[placeholder*="Write"]'
      ).first();
      if (await bodyInput.isVisible().catch(() => false)) {
        await humanFill(page, bodyInput, content);
      }

      await humanBrowse(page, 2000);

      if (params.tags) {
        const tagsInput = page.locator(
          'input#article_tag_list, input[name="article[tag_list]"], input[placeholder*="tag"]'
        ).first();
        if (await tagsInput.isVisible().catch(() => false)) {
          await humanFill(page, tagsInput, params.tags);
        }
      }

      await randomPause(1000, 3000);

      const publishBtn = page.locator(
        'button[value="Publish"], button:has-text("Publish"), button:has-text("发布"), input[value="Publish"]'
      ).first();
      if (await publishBtn.isVisible().catch(() => false)) {
        await humanClick(page, publishBtn);
        await randomPause(2000, 4000);
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
        }, [`文章 "${params.title}" 已在 Dev.to 发布`]);
    },
  });

  site.command('draft', {
    description: '在 Dev.to 保存草稿',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().describe('文章内容（Markdown）'),
    }),
    examples: [
      {
        cmd: 'xbrowser devto draft --title "Draft" --content "# Draft content"',
        description: '保存为草稿',
      },
    ],
    result: z.object({ title: z.string(), saved: z.boolean(), url: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('../types').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://dev.to/new', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('domcontentloaded');
      await humanBrowse(page, 3000);

      const titleInput = page.locator(
        'input#article_title, input[name="article[title]"]'
      ).first();
      if (await titleInput.isVisible().catch(() => false)) {
        await humanFill(page, titleInput, params.title);
      }

      const bodyInput = page.locator(
        'textarea#article_body_markdown, textarea[name="article[body_markdown]"]'
      ).first();
      if (await bodyInput.isVisible().catch(() => false)) {
        await humanFill(page, bodyInput, params.content);
      }

      await humanBrowse(page, 2000);

      const saveBtn = page.locator(
        'button:has-text("Save draft"), button:has-text("保存草稿"), button[value="Save"]'
      ).first();
      if (await saveBtn.isVisible().catch(() => false)) {
        await humanClick(page, saveBtn);
        await randomPause(2000, 4000);
      }

      return ok({
          title: params.title,
          saved: true,
          url: page.url(),
        }, [`草稿 "${params.title}" 已保存`]);
    },
  });

  site.command('update-profile', {
    description: '更新 Dev.to 个人资料（添加外链）',
    loginRequired: 'required',
    scope: 'browser',
    parameters: z.object({
      url: z.string().describe('要添加到 Profile 的 URL'),
      bio: z.string().optional().describe('个人简介文本'),
    }),
    examples: [
      {
        cmd: 'xbrowser devto update-profile --url "https://example.com" --bio "Full-stack developer"',
        description: '更新 Profile 添加外链',
      },
    ],
    result: z.object({ url: z.string(), updated: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('../types').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      await page.goto('https://dev.to/settings', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForLoadState('domcontentloaded');
      await humanBrowse(page, 2000);

      if (params.bio) {
        const bioInput = page.locator(
          'textarea[name="user[summary]"], textarea[aria-label*="Bio"], textarea[placeholder*="bio"]'
        ).first();
        if (await bioInput.isVisible().catch(() => false)) {
          await humanFill(page, bioInput, `${params.bio}\n\n${params.url}`);
        }
      }

      const webInput = page.locator(
        'input[name="user[website_url]"], input[aria-label*="Website"], input[placeholder*="website"]'
      ).first();
      if (await webInput.isVisible().catch(() => false)) {
        await humanFill(page, webInput, params.url);
      }

      await randomPause(500, 1500);

      const submitBtn = page.locator(
        'button:has-text("Save"), button:has-text("保存"), input[type="submit"]'
      ).first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await humanClick(page, submitBtn);
        await randomPause(2000, 3000);
      }

      return ok({ url: params.url, updated: true }, ['Profile 已更新，包含外链']);
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as Record<string, unknown>).page as import('../types').Page | undefined;
    if (!page) return;
    await page.goto('https://dev.to/enter');
    await ctx.storage.set('devto_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('devto_login');
  });
}
