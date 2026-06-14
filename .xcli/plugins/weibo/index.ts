import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const weibo = xcli.createSite({
    name: 'weibo',
    url: 'https://weibo.com',
    description: '微博 - 社交媒体发布与图片搜索',
    requiresLogin: true,
  });

  weibo.command('post', {
    description: '发布微博 — 导航到微博首页，输入内容并发布',
    scope: 'browser',
    loginRequired: 'required',
    parameters: z.object({
      text: z.string().min(1).max(2000).describe('微博内容'),
    }),
    examples: [
      { cmd: 'xbrowser weibo post --text "今天天气真好！"', description: '发布一条微博' },
    ],
    result: z.object({
      posted: z.boolean(),
      text: z.string(),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips: string[] = [];
      if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器以获取登录态');
      tips.push(`Session: ${ctx.sessionId || 'default'}`);

      try {
        await page.goto('https://weibo.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        // 微博输入框（多种选择器兼容）
        const composeBox = page.locator(
          'textarea[placeholder*="有什么新鲜事"], [contenteditable="true"][class*="Form_Editor"], div[contenteditable="true"], textarea[class*="editor"]'
        ).first();

        if (await composeBox.isVisible().catch(() => false)) {
          await composeBox.click();
          await page.waitForTimeout(500);
          await page.keyboard.type(params.text, { delay: 30 });
          tips.push('内容已输入');
        } else {
          return fail('未找到微博输入框，请确认已登录', tips);
        }

        await page.waitForTimeout(500);

        // 等待用户检查
        await ctx.waitForHuman?.({
          reason: '请在 viewer 中检查微博内容后确认发布',
          timeout: 120,
          autoDetect: true,
        });

        // 点击发送按钮
        const sendBtn = page.locator(
          'button[class*="submit"], a[class*="submit"], button:has-text("发博"), button:has-text("发送"), button:has-text("发布")'
        ).first();
        if (await sendBtn.isVisible().catch(() => false)) {
          await sendBtn.click();
          await page.waitForTimeout(3000);
          tips.push('✓ 已点击发布按钮');
        } else {
          // 备选：Ctrl+Enter 发送
          await page.keyboard.down('Control');
          await page.keyboard.press('Enter');
          await page.keyboard.up('Control');
          tips.push('已使用快捷键发送');
          await page.waitForTimeout(2000);
        }

        return ok({ posted: true, text: params.text }, [...tips, `微博 "${params.text.slice(0, 30)}..." 已发布`]);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  weibo.command('repost', {
    description: '转发微博 — 导航到微博详情页，输入评论并转发',
    scope: 'browser',
    loginRequired: 'required',
    parameters: z.object({
      url: z.string().describe('微博 URL'),
      text: z.string().max(2000).optional().describe('转发评论内容（可留空）'),
    }),
    examples: [
      { cmd: 'xbrowser weibo repost --url "https://weibo.com/xxx/xxx" --text "支持"', description: '转发并评论' },
      { cmd: 'xbrowser weibo repost --url "https://weibo.com/xxx/xxx"', description: '纯转发' },
    ],
    result: z.object({
      reposted: z.boolean(),
      text: z.string(),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips: string[] = [];
      if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器以获取登录态');
      tips.push(`Session: ${ctx.sessionId || 'default'}`);

      try {
        await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        // 点击转发按钮
        const repostBtn = page.locator(
          'a[href*="repost"], button:has-text("转发"), [class*="forward"], [class*="repost"]'
        ).first();
        if (await repostBtn.isVisible().catch(() => false)) {
          await repostBtn.click();
          await page.waitForTimeout(2000);
          tips.push('已点击转发按钮');
        } else {
          return fail('未找到转发按钮，请确认页面已加载', tips);
        }

        // 输入转发评论
        if (params.text) {
          const editor = page.locator(
            'textarea[placeholder*="转发"], textarea[placeholder*="说点什么"], [contenteditable="true"], textarea'
          ).first();
          if (await editor.isVisible().catch(() => false)) {
            await editor.click();
            await page.waitForTimeout(300);
            await page.keyboard.type(params.text, { delay: 30 });
            tips.push('转发评论已输入');
          }
        }

        await page.waitForTimeout(500);

        // 等待用户检查
        await ctx.waitForHuman?.({
          reason: '请在 viewer 中检查转发内容后确认',
          timeout: 120,
          autoDetect: true,
        });

        // 点击确认转发按钮
        const confirmBtn = page.locator(
          'button:has-text("转发"), button:has-text("发送"), button[class*="submit"], button[class*="confirm"]'
        ).last();
        if (await confirmBtn.isVisible().catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(3000);
          tips.push('✓ 已确认转发');
        } else {
          return fail('未找到转发确认按钮，请手动确认', tips);
        }

        return ok({ reposted: true, text: params.text || '' }, [...tips, '转发成功']);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  weibo.command('search-image', {
    description: '微博图片搜索 - 搜索微博中的图片内容',
    scope: 'browser',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        const url = `https://s.weibo.com/weibo?q=${encodeURIComponent(params.query)}&type=image`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForTimeout(3000);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await page.waitForTimeout(1000);

        const results = await page.evaluate((limit: number) => {
          const images: Array<{
            title: string; thumbnailUrl: string; sourceUrl: string;
            width: number; height: number;
          }> = [];

          document.querySelectorAll('img[src*="sinaimg"]').forEach((img, idx) => {
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

        // ok() returns CommandResult<T> but handler type expects raw T — framework design mismatch
        return buildResult(params.query, 'weibo', results.map(r => ({ ...r, sourceSite: 'weibo' })));
      } catch (error) {
        return buildFail(error, 'weibo');
      }
    },
  });

}
