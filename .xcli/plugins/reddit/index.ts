import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const reddit = xcli.createSite({
    name: 'reddit',
    url: 'https://www.reddit.com',
    description: 'Reddit 图片搜索 & 社交互动（发帖/评论/投票/订阅）',
    requiresLogin: true,
    isLogin: async (ctx) => {
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const page = ctxAny.page as import('../types').Page;
      if (!page) return true;
      try {
        const url = page.url();
        if (url.includes('/login') || url.includes('/account/login')) return false;
        const hasLoginBtn = await page.locator('a[href*="/login"], button:has-text("Log In"), a:has-text("Log In")').first().isVisible().catch(() => false);
        if (hasLoginBtn) return false;
        const body = await page.evaluate(() => document.body?.textContent?.trim().slice(0, 200) || '') as string;
        if (!body) return false;
        if (body.includes('Log In') || body.includes('Sign Up')) return false;
        return true;
      } catch {
        return true;
      }
    },
  });

  const BASE = 'https://www.reddit.com';

  // ─── 工具 ──────────────────────────────────────

  function buildTips(ctx: Record<string, unknown>): string[] {
    const tips: string[] = [];
    if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接到已登录的浏览器');
    tips.push(`Session: ${ctx.sessionId || 'default'}`);
    return tips;
  }

  // ─── 1. search-image ───────────────────────────

  reddit.command('search-image', {
    description: 'Reddit 图片搜索 - 搜索 Reddit 中的图片帖子',
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
        const url = `https://www.reddit.com/search/?q=${encodeURIComponent(params.query)}&type=image`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await page.waitForTimeout(1000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          const selectors = 'img[src*="reddit"], img[src*="redd.it"]';
          document.querySelectorAll(selectors).forEach((img, idx) => {
            if (idx >= limit) return;
            const el = img as HTMLImageElement;
            if (el.naturalWidth < 80) return;
            images.push({
              title: el.alt || '',
              thumbnailUrl: el.src,
              sourceUrl: el.closest('a')?.getAttribute('href') || '',
              width: el.naturalWidth,
              height: el.naturalHeight,
            });
          });

          return images;
        }, params.limit) as Array<{ title: string; thumbnailUrl: string; sourceUrl: string; width: number; height: number }>;

        return ok({
          query: params.query,
          engine: 'reddit',
          results: results.map(r => ({ ...r, sourceSite: 'reddit' })),
          total: results.length,
          timestamp: Date.now(),
        });
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误');
      }
    },
  });

  // ─── 2. post (发布文本帖子) ───────────────────

  reddit.command('post', {
    description: '在 Reddit 提交文本帖子',
    scope: 'browser',
    parameters: z.object({
      title: z.string().min(1).describe('帖子标题'),
      content: z.string().optional().describe('帖子内容（文本）'),
      community: z.string().optional().describe('社区名称（如 r/AskReddit）'),
    }),
    examples: [
      { cmd: 'xbrowser reddit post --title "Hello Reddit!" --content "My first post" --community "r/test"', description: '提交文本帖子' },
    ],
    result: z.object({ posted: z.boolean(), title: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto(`${BASE}/submit`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Select community if provided
        if (params.community) {
          const communityInput = page.locator('input[placeholder*="community"], input[placeholder*="Community"], input[role="combobox"]').first();
          await communityInput.waitFor({ state: 'visible', timeout: 10000 });
          await communityInput.click();
          await page.waitForTimeout(500);
          await page.keyboard.type(params.community, { delay: 30 });
          await page.waitForTimeout(1000);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(500);
        }

        // Fill title
        const titleInput = page.locator('textarea').first();
        await titleInput.waitFor({ state: 'visible', timeout: 10000 });
        await titleInput.click();
        await page.keyboard.type(params.title, { delay: 30 });
        await page.waitForTimeout(500);

        // Fill content if provided
        if (params.content) {
          const contentInput = page.locator('textarea').nth(1);
          await contentInput.waitFor({ state: 'visible', timeout: 5000 });
          await contentInput.click();
          await page.keyboard.type(params.content, { delay: 30 });
          await page.waitForTimeout(500);
        }

        // Click submit button
        const submitBtn = page.locator('button[type="submit"], button:has-text("Post"), shreddit-async-loader[buttonrole="submit"] button').first();
        await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
        await submitBtn.click();
        await page.waitForTimeout(5000);

        return ok({ posted: true, title: params.title }, ['帖子已提交', ...tips]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '发布失败');
      }
    },
  });

  // ─── 3. comment (评论) ────────────────────────

  reddit.command('comment', {
    description: '评论指定帖子',
    scope: 'browser',
    parameters: z.object({
      postUrl: z.string().describe('帖子 URL'),
      text: z.string().min(1).describe('评论内容'),
    }),
    examples: [
      { cmd: 'xbrowser reddit comment --postUrl "https://www.reddit.com/r/..." --text "Great post!"', description: '评论帖子' },
    ],
    result: z.object({ commented: z.boolean(), text: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto(params.postUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Click on the comment box
        const commentBox = page.locator('shreddit-composer, [contenteditable="true"]').first();
        await commentBox.waitFor({ state: 'visible', timeout: 10000 });
        await commentBox.click();
        await page.waitForTimeout(500);

        // Type the comment
        await page.keyboard.type(params.text, { delay: 30 });
        await page.waitForTimeout(500);

        // Click Comment button to submit
        const commentBtn = page.locator('button:has-text("Comment"), button:has-text("Reply")').first();
        await commentBtn.waitFor({ state: 'visible', timeout: 5000 });
        await commentBtn.click();
        await page.waitForTimeout(3000);

        return ok({ commented: true, text: params.text }, ['评论已发布', ...tips]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '评论失败');
      }
    },
  });

  // ─── 4. vote (投票) ───────────────────────────

  reddit.command('vote', {
    description: '对指定帖子进行投票（上投票/下投票）',
    scope: 'browser',
    parameters: z.object({
      postUrl: z.string().describe('帖子 URL'),
      direction: z.enum(['up', 'down']).describe('投票方向：up（赞）或 down（踩）'),
    }),
    examples: [
      { cmd: 'xbrowser reddit vote --postUrl "https://www.reddit.com/r/..." --direction up', description: '上投票' },
      { cmd: 'xbrowser reddit vote --postUrl "https://www.reddit.com/r/..." --direction down', description: '下投票' },
    ],
    result: z.object({ voted: z.boolean(), direction: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto(params.postUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        const label = params.direction === 'up' ? 'Upvote' : 'Downvote';
        const voteBtn = page.locator(`button[aria-label*="${label}"]`).first();
        await voteBtn.waitFor({ state: 'visible', timeout: 10000 });
        await voteBtn.click();
        await page.waitForTimeout(2000);

        return ok({ voted: true, direction: params.direction }, [`${params.direction === 'up' ? '上' : '下'}投票成功`, ...tips]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '投票失败');
      }
    },
  });

  // ─── 5. subscribe (订阅) ──────────────────────

  reddit.command('subscribe', {
    description: '订阅指定 subreddit',
    scope: 'browser',
    parameters: z.object({
      subreddit: z.string().describe('subreddit 名称（如 AskReddit 或 r/AskReddit）'),
    }),
    examples: [
      { cmd: 'xbrowser reddit subscribe --subreddit "AskReddit"', description: '订阅 r/AskReddit' },
    ],
    result: z.object({ subscribed: z.boolean(), subreddit: z.string() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page;
      if (!page) throw new Error('需要浏览器页面');
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        const sub = params.subreddit.replace(/^r\//i, '');
        await page.goto(`${BASE}/r/${sub}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        // Click subscribe/join button
        const subscribeBtn = page.locator('button[data-testid="subscribe-button"], button:has-text("Join"), button:has-text("Subscribe")').first();
        await subscribeBtn.waitFor({ state: 'visible', timeout: 10000 });
        await subscribeBtn.click();
        await page.waitForTimeout(2000);

        return ok({ subscribed: true, subreddit: sub }, [`已订阅 r/${sub}`, ...tips]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '订阅失败');
      }
    },
  });

  // ─── draft (本地草稿) ──────────────────────────
  reddit.command('draft', {
    description: '保存草稿到本地（不发布）',
    scope: 'project',
    parameters: z.object({
      text: z.string().min(1).describe('草稿内容'),
      title: z.string().optional().describe('标题（可选）'),
    }),
    result: z.object({ saved: z.boolean(), id: z.string() }).passthrough(),
    handler: async (params) => {
      const { saveDraft } = await import('../shared/draft-storage.js');
      const result = saveDraft('reddit', params.text, params.title);
      return ok({ saved: true, id: result.id, path: result.path }, [`草稿已保存: ${result.id}`]);
    },
  });

  reddit.command('drafts', {
    description: '列出本地保存的草稿',
    scope: 'project',
    parameters: z.object({}),
    result: z.object({ drafts: z.array(z.object({ id: z.string(), title: z.string(), textPreview: z.string(), savedAt: z.string() })) }).passthrough(),
    handler: async () => {
      const { listDrafts } = await import('../shared/draft-storage.js');
      const drafts = listDrafts('reddit');
      return ok({ drafts }, [`${drafts.length} 条草稿`]);
    },
  });

  reddit.command('load-draft', {
    description: '读取指定草稿内容',
    scope: 'project',
    parameters: z.object({
      id: z.string().describe('草稿 ID（时间戳）'),
    }),
    result: z.object({ id: z.string(), title: z.string().optional(), text: z.string(), savedAt: z.string() }).passthrough(),
    handler: async (params) => {
      const { loadDraft } = await import('../shared/draft-storage.js');
      const draft = loadDraft('reddit', params.id);
      if (!draft) return fail('草稿不存在');
      return ok(draft);
    },
  });

  // ─── login/logout ──────────────────────────────

  reddit.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page | undefined;
    console.log('⚠️  请使用 --cdp 参数连接到已登录 Reddit 的浏览器');
    console.log('     xbrowser reddit post --title "Hello" --cdp http://localhost:9221');
    if (page) {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
  });

  reddit.logout(async () => {
    console.log('⚠️  请在浏览器中手动退出 Reddit');
  });
}
