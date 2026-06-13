import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const facebook = xcli.createSite({
    name: 'facebook',
    url: 'https://www.facebook.com',
    description: 'Facebook 图片搜索 & 社交互动（发帖/点赞/评论/分享）',
    requiresLogin: true,
    isLogin: async (ctx) => {
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const page = ctxAny.page as import('../types').Page;
      if (!page) return true;
      try {
        const url = page.url();
        if (url.includes('/login/')) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '') as string;
        if (!body) return false;
        if ((body as string).includes('Log in')) return false;
        const hasLoginBtn = await page.locator('button:has-text("Log in"), a:has-text("Log in")').first().isVisible().catch(() => false);
        if (hasLoginBtn) return false;
        return true;
      } catch {
        return true;
      }
    },
  });

  const BASE = 'https://www.facebook.com';

  // ─── 工具 ──────────────────────────────────────

  function buildTips(ctx: Record<string, unknown>): string[] {
    const tips: string[] = [];
    if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接到已登录的浏览器');
    tips.push(`Session: ${ctx.sessionId || 'default'}`);
    return tips;
  }

  // ─── 1. search-image ───────────────────────────

  facebook.command('search-image', {
    description: 'Facebook 图片搜索 - 搜索 Facebook 中的公开图片',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().default(10),
      timeout: z.number().optional().default(20000),
    }),
    result: z.object({
      query: z.string(),
      engine: z.string(),
      results: z.array(z.object({
        title: z.string(),
        thumbnailUrl: z.string(),
        sourceUrl: z.string(),
        originalUrl: z.string().optional(),
        width: z.number(),
        height: z.number(),
        format: z.string().optional(),
        sourceSite: z.string(),
        fileSize: z.string().optional(),
      }).passthrough()),
      total: z.number().optional(),
      timestamp: z.union([z.string(), z.number()]).optional(),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');

      try {
        const url = `https://www.facebook.com/search/posts?q=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(5000);

        if (page.url().includes('/login/')) {
          return fail('Facebook 需要登录，请使用 --cdp 连接已登录的浏览器（CDP 9221）');
        }

        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await page.waitForTimeout(1000);
        }

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          let imgs = document.querySelectorAll('img[src*="fbcdn"], img[src*="facebook"]');
          if (imgs.length === 0) {
            imgs = document.querySelectorAll('img');
          }
          imgs.forEach((img) => {
            if (images.length >= limit) return;
            const el = img as HTMLImageElement;
            const src = el.src || '';
            if (el.width < 50 || !src.startsWith('http')) return;
            if (src.includes('logo') || src.includes('icon') || src.includes('avatar') || src.includes('emoji')) return;
            images.push({
              title: el.alt || '',
              thumbnailUrl: src,
              sourceUrl: el.closest('a')?.getAttribute('href') || '',
              width: el.naturalWidth || el.width,
              height: el.naturalHeight || el.height,
            });
          });

          return images;
        }, params.limit) as Array<Record<string, unknown>>;

        return ok({
            query: params.query,
            engine: 'facebook',
            results: results.map(r => ({ ...r, sourceSite: 'facebook' })),
            total: results.length,
            timestamp: Date.now(),
          });
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误');
      }
    },
  });

  // ─── 2. post (发状态) ─────────────────────────

  facebook.command('post', {
    description: '在 Facebook 发布状态更新',
    scope: 'browser',
    parameters: z.object({
      text: z.string().min(1).describe('状态内容'),
    }),
    examples: [
      { cmd: 'xbrowser facebook post --text "Hello World!"', description: '发布一条状态' },
    ],
    result: z.object({ posted: z.boolean(), text: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Click "What's on your mind" composer
        const composer = page.locator('[role="textbox"]').first();
        await composer.waitFor({ state: 'visible', timeout: 10000 });
        await composer.click();
        await page.waitForTimeout(1000);

        // Type the status text
        await page.keyboard.type(params.text, { delay: 30 });
        await page.waitForTimeout(500);

        // Click Post button
        const postBtn = page.locator('div[aria-label="Post"], div[role="button"][aria-label="Post"]').first();
        await postBtn.waitFor({ state: 'visible', timeout: 10000 });
        await postBtn.click();
        await page.waitForTimeout(3000);

        return ok({ posted: true, text: params.text }, ['状态已发布', ...tips]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '发布失败');
      }
    },
  });

  // ─── 3. like (点赞) ───────────────────────────

  facebook.command('like', {
    description: '点赞指定帖子',
    scope: 'browser',
    parameters: z.object({
      postUrl: z.string().describe('帖子 URL'),
    }),
    examples: [
      { cmd: 'xbrowser facebook like --postUrl "https://www.facebook.com/..."', description: '点赞帖子' },
    ],
    result: z.object({ liked: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto(params.postUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        const likeBtn = page.locator('div[aria-label*="Like"], div[role="button"][aria-label*="Like"]').first();
        await likeBtn.waitFor({ state: 'visible', timeout: 10000 });
        await likeBtn.click();
        await page.waitForTimeout(2000);

        return ok({ liked: true }, ['点赞成功', ...tips]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '点赞失败');
      }
    },
  });

  // ─── 4. comment (评论) ────────────────────────

  facebook.command('comment', {
    description: '评论指定帖子',
    scope: 'browser',
    parameters: z.object({
      postUrl: z.string().describe('帖子 URL'),
      text: z.string().min(1).describe('评论内容'),
    }),
    examples: [
      { cmd: 'xbrowser facebook comment --postUrl "https://www.facebook.com/..." --text "Nice!"', description: '评论帖子' },
    ],
    result: z.object({ commented: z.boolean(), text: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto(params.postUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Click comment area to focus
        const commentTrigger = page.locator('div[aria-label*="Leave a comment"], div[role="button"][aria-label*="comment"]').first();
        await commentTrigger.waitFor({ state: 'visible', timeout: 10000 });
        await commentTrigger.click();
        await page.waitForTimeout(1000);

        // Find the comment textbox and type
        const commentBox = page.locator('[role="textbox"]').first();
        await commentBox.waitFor({ state: 'visible', timeout: 10000 });
        await commentBox.click();
        await page.waitForTimeout(500);

        await page.keyboard.type(params.text, { delay: 30 });
        await page.waitForTimeout(500);

        // Press Enter to submit
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);

        return ok({ commented: true, text: params.text }, ['评论已发布', ...tips]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '评论失败');
      }
    },
  });

  // ─── 5. share (分享) ──────────────────────────

  facebook.command('share', {
    description: '分享指定帖子',
    scope: 'browser',
    parameters: z.object({
      postUrl: z.string().describe('帖子 URL'),
    }),
    examples: [
      { cmd: 'xbrowser facebook share --postUrl "https://www.facebook.com/..."', description: '分享帖子' },
    ],
    result: z.object({ shared: z.boolean() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto(params.postUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Click Share button
        const shareBtn = page.locator('div[aria-label*="Share"], div[role="button"][aria-label*="Share"]').first();
        await shareBtn.waitFor({ state: 'visible', timeout: 10000 });
        await shareBtn.click();
        await page.waitForTimeout(1000);

        // Click "Share now" or "Post" to confirm
        const confirmBtn = page.locator('div[aria-label*="Share Now"], div[role="button"][aria-label*="Share Now"], span:has-text("Share Now")').first();
        await confirmBtn.waitFor({ state: 'visible', timeout: 10000 });
        await confirmBtn.click();
        await page.waitForTimeout(3000);

        return ok({ shared: true }, ['分享成功', ...tips]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '分享失败');
      }
    },
  });

  // ─── draft (本地草稿) ──────────────────────────
  facebook.command('draft', {
    description: '保存草稿到本地（不发布）',
    scope: 'project',
    parameters: z.object({
      text: z.string().min(1).describe('草稿内容'),
      title: z.string().optional().describe('标题（可选）'),
    }),
    result: z.object({ saved: z.boolean(), id: z.string() }).passthrough(),
    handler: async (params) => {
      const { saveDraft } = await import('../shared/draft-storage.js');
      const result = saveDraft('facebook', params.text, params.title);
      return ok({ saved: true, id: result.id, path: result.path }, [`草稿已保存: ${result.id}`]);
    },
  });

  facebook.command('drafts', {
    description: '列出本地保存的草稿',
    scope: 'project',
    parameters: z.object({}),
    result: z.object({ drafts: z.array(z.object({ id: z.string(), title: z.string(), textPreview: z.string(), savedAt: z.string() })) }).passthrough(),
    handler: async () => {
      const { listDrafts } = await import('../shared/draft-storage.js');
      const drafts = listDrafts('facebook');
      return ok({ drafts }, [`${drafts.length} 条草稿`]);
    },
  });

  facebook.command('load-draft', {
    description: '读取指定草稿内容',
    scope: 'project',
    parameters: z.object({
      id: z.string().describe('草稿 ID（时间戳）'),
    }),
    result: z.object({ id: z.string(), title: z.string().optional(), text: z.string(), savedAt: z.string() }).passthrough(),
    handler: async (params) => {
      const { loadDraft } = await import('../shared/draft-storage.js');
      const draft = loadDraft('facebook', params.id);
      if (!draft) return fail('草稿不存在');
      return ok(draft);
    },
  });

  // ─── login/logout ──────────────────────────────

  facebook.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page | undefined;
    console.log('⚠️  请使用 --cdp 参数连接到已登录 Facebook 的浏览器');
    console.log('     xbrowser facebook post --text "Hello" --cdp http://localhost:9221');
    if (page) {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
  });

  facebook.logout(async () => {
    console.log('⚠️  请在浏览器中手动退出 Facebook');
  });
}
