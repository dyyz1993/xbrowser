import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import { searchImageResultSchema, baseSearchParams, buildResult, buildFail } from '../shared/image-search.js';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'bilibili',
    url: 'https://www.bilibili.com',
    description: 'B站 - 视频搜索、动态发布、评论、点赞与图片搜索',
    requiresLogin: false,
    isLogin: async (ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('../types').Page | null;
      if (!page) return false;
      try {
        const url = page.url();
        if (url.includes('/login') || url.includes('/signin')) return false;
        const loggedIn = await page.evaluate(() =>
          !!document.querySelector('[class*="avatar"],[class*="user-info"],[class*="logged-in"],' +
            '.header-info__user,.bili-avatar')
        );
        return loggedIn;
      } catch {
        return false;
      }
    },
  });

  // ─── 工具函数 ──────────────────────────────────

  function buildTips(ctx: Record<string, unknown>): string[] {
    const tips: string[] = [];
    if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器以获取登录态');
    tips.push(`Session: ${ctx.sessionId || 'default'}`);
    return tips;
  }

  // ─── 1. search (搜索视频) ──────────────────────

  site.command('search', {
    description: '搜索 B站视频 — 导航到搜索页，采集视频结果',
    scope: 'browser',
    loginRequired: 'none',
    parameters: z.object({
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().default(10),
    }),
    examples: [
      { cmd: 'xbrowser bilibili search --query "AI 编程"', description: '搜索 AI 编程相关视频' },
    ],
    result: z.object({
      query: z.string(),
      count: z.number(),
      videos: z.array(z.object({
        title: z.string(),
        author: z.string(),
        playCount: z.string(),
        duration: z.string(),
        link: z.string(),
        cover: z.string(),
      }).passthrough()),
    }),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        const searchUrl = `https://search.bilibili.com/all?keyword=${encodeURIComponent(params.query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Smart wait: wait for search results to render
        await page.waitForFunction(
          () => document.querySelectorAll('.bili-video-card__info--tit').length > 0,
          { timeout: 12000 }
        ).catch(() => {});
        await page.waitForTimeout(3000);

        const videos = await page.evaluate((limit) => {
          var items = [];
          var cards = document.querySelectorAll('.bili-video-card, .video-list-item, .video-card');
          cards.forEach(function(card) {
            if (items.length >= limit) return;
            var titleEl = card.querySelector('.bili-video-card__info--tit');
            var titleText = titleEl ? (titleEl.textContent || '').trim() : '';
            if (!titleText) return;
            var videoLink = card.querySelector('a[href*="bilibili.com/video"]');
            var authorEl = card.querySelector('.bili-video-card__info--author, [class*="author"], [class*="up-name"]');
            var playEl = card.querySelector('.bili-video-card__stats--item, [class*="stats--item"]');
            var durationEl = card.querySelector('.bili-video-card__stats__duration, [class*="duration"], [class*="time"]');
            var coverEl = card.querySelector('img');
            items.push({
              title: titleText,
              author: authorEl ? (authorEl.textContent || '').trim() : '',
              playCount: playEl ? (playEl.textContent || '').trim() : '',
              duration: durationEl ? (durationEl.textContent || '').trim() : '',
              link: videoLink ? videoLink.href : '',
              cover: coverEl ? coverEl.src : '',
            });
          });
          return items;
        }, params.limit || 10);

        return ok(
          { query: params.query, count: videos.length, videos },
          [...tips, `找到 ${videos.length} 个视频`],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  // ─── 2. post (投稿动态) ────────────────────────

  site.command('post', {
    description: '发布 B站动态 — 导航到动态页，输入内容并发布',
    scope: 'browser',
    loginRequired: 'required',
    parameters: z.object({
      text: z.string().min(1).max(2000).describe('动态内容'),
    }),
    examples: [
      { cmd: 'xbrowser bilibili post --text "今天分享一个有趣的视频！"', description: '发布一条动态' },
    ],
    result: z.object({
      posted: z.boolean(),
      text: z.string(),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto('https://t.bilibili.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        // 动态发布框（多种选择器兼容）
        const composeBox = page.locator(
          '.bili-dyn-publishing [contenteditable="true"], .bili-dyn-editor [contenteditable="true"], textarea[placeholder*="动态"], [contenteditable="true"]'
        ).first();

        if (await composeBox.isVisible().catch(() => false)) {
          await composeBox.click();
          await page.waitForTimeout(500);
          await page.keyboard.type(params.text, { delay: 30 });
          tips.push('动态内容已输入');
        } else {
          return fail('未找到动态发布框，请确认已登录 B站', tips);
        }

        await page.waitForTimeout(500);

        // 等待用户检查
        await ctx.waitForHuman?.({
          reason: '请在 viewer 中检查动态内容后确认发布',
          timeout: 120,
          autoDetect: true,
        });

        // 点击发布按钮
        const publishBtn = page.locator(
          'button:has-text("发布"), button[class*="publish"], button[class*="submit"], .bili-dyn-publishing__btn'
        ).first();
        if (await publishBtn.isVisible().catch(() => false)) {
          await publishBtn.click();
          await page.waitForTimeout(3000);
          tips.push('✓ 已点击发布按钮');
        } else {
          return fail('未找到发布按钮，请手动发布', tips);
        }

        return ok(
          { posted: true, text: params.text },
          [...tips, `动态 "${params.text.slice(0, 30)}..." 已发布`],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  // ─── 3. comment (评论视频) ─────────────────────

  site.command('comment', {
    description: '评论 B站视频 — 导航到视频页，输入评论并提交',
    scope: 'browser',
    loginRequired: 'required',
    parameters: z.object({
      url: z.string().describe('视频 URL（如 https://www.bilibili.com/video/BVxxx）'),
      text: z.string().min(1).max(2000).describe('评论内容'),
    }),
    examples: [
      { cmd: 'xbrowser bilibili comment --url "https://www.bilibili.com/video/BV1xx411c7mD" --text "太赞了！"', description: '评论视频' },
    ],
    result: z.object({
      commented: z.boolean(),
      text: z.string(),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(4000);

        // 评论输入框
        const commentBox = page.locator(
          '.comment-header textarea, .reply-box textarea, textarea[placeholder*="评论"], [contenteditable="true"][class*="comment"], [contenteditable="true"][class*="reply"]'
        ).first();

        if (await commentBox.isVisible().catch(() => false)) {
          await commentBox.click();
          await page.waitForTimeout(500);
          await page.keyboard.type(params.text, { delay: 30 });
          tips.push('评论内容已输入');
        } else {
          return fail('未找到评论输入框，请确认已登录 B站', tips);
        }

        await page.waitForTimeout(500);

        // 等待用户检查
        await ctx.waitForHuman?.({
          reason: '请在 viewer 中检查评论内容后确认发送',
          timeout: 120,
          autoDetect: true,
        });

        // 点击发送评论按钮
        const sendBtn = page.locator(
          'button:has-text("发送"), button[class*="send"], button[class*="submit"], .reply-box .reply-send'
        ).first();
        if (await sendBtn.isVisible().catch(() => false)) {
          await sendBtn.click();
          await page.waitForTimeout(3000);
          tips.push('✓ 已发送评论');
        } else {
          return fail('未找到评论发送按钮，请手动发送', tips);
        }

        return ok(
          { commented: true, text: params.text },
          [...tips, '评论已发送'],
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  // ─── 4. like (点赞视频) ────────────────────────

  site.command('like', {
    description: '点赞 B站视频 — 导航到视频页，点击点赞按钮',
    scope: 'browser',
    loginRequired: 'required',
    parameters: z.object({
      url: z.string().describe('视频 URL'),
    }),
    examples: [
      { cmd: 'xbrowser bilibili like --url "https://www.bilibili.com/video/BV1xx411c7mD"', description: '点赞视频' },
    ],
    result: z.object({
      liked: z.boolean(),
    }).passthrough(),
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      const tips = buildTips(ctx as unknown as Record<string, unknown>);

      try {
        await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(4000);

        // 先检查登录态：B 站未登录时点赞会弹登录框
        const isLoggedIn = await page.evaluate(() => {
          var loginModal = document.querySelector('.bili-mini-login-wrapper, [class*="login-modal"], [class*="login-mask"]');
          if (loginModal && loginModal.offsetParent !== null) return false;
          return !!document.querySelector('[class*="avatar"],[class*="user-info"],[class*="logged-in"],.header-info__user,.bili-avatar');
        });
        if (!isLoggedIn) {
          return fail('LOGIN_REQUIRED: 未登录 B站，请先登录后再点赞', [...tips, '⚠️ 未检测到登录态']);
        }

        // 记录点击前的点赞状态
        const wasActive = await page.evaluate(() => {
          var btn = document.querySelector('.video-toolbar-left .like, .like-icon, [class*="video-like"]');
          if (!btn) return false;
          return btn.classList.contains('active') || btn.classList.contains('on');
        });

        // 点赞按钮
        const likeBtn = page.locator(
          '.video-toolbar-left .like, .video-toolbar-left .like-icon, [class*="toolbar-left"] [class*="like"], .like-icon, [class*="video-like"]'
        ).first();

        if (await likeBtn.isVisible().catch(() => false)) {
          await likeBtn.click();
          await page.waitForTimeout(2000);
          tips.push('✓ 已点击点赞按钮');
        } else {
          const clicked = await page.evaluate(() => {
            var btns = Array.from(document.querySelectorAll('[class*="like"], [class*="点赞"]'));
            for (var i = 0; i < btns.length; i++) {
              var btn = btns[i];
              if (btn.classList.contains('active') || btn.classList.contains('on')) continue;
              var parent = btn.closest('button, [class*="toolbar"]');
              if (parent && parent.offsetParent !== null) { parent.click(); return true; }
            }
            return false;
          });
          if (clicked) { tips.push('✓ 已点击点赞按钮（evaluate）'); }
          else { return fail('未找到点赞按钮，请确认已登录 B站', tips); }
        }

        // 点击后验证：检查是否弹出了登录框
        const loginPopup = await page.evaluate(() => {
          var modal = document.querySelector('.bili-mini-login-wrapper, [class*="login-modal"], [class*="login-mask"], [class*="login-dialog"]');
          return modal && modal.offsetParent !== null;
        });
        if (loginPopup) {
          return fail('LOGIN_REQUIRED: 点击点赞后弹出登录框，请先登录 B站', tips);
        }

        // 验证点赞是否生效
        const nowActive = await page.evaluate(() => {
          var btn = document.querySelector('.video-toolbar-left .like, .like-icon, [class*="video-like"]');
          if (!btn) return false;
          return btn.classList.contains('active') || btn.classList.contains('on');
        });
        const finalLiked = (nowActive && !wasActive) || (wasActive && nowActive);
        if (!finalLiked) { tips.push('⚠️ 点击后点赞按钮未变为 active，可能未生效'); }

        return ok({ liked: finalLiked, wasAlreadyLiked: wasActive }, [...tips, finalLiked ? '点赞成功' : '点赞状态不确定']);
      } catch (error) {
        return fail(error instanceof Error ? error.message : '未知错误', tips);
      }
    },
  });

  // ─── 5. search-image (搜索图片) ────────────────

  site.command('search-image', {
    description: 'B站图片搜索 — 搜索视频封面及相关图片',
    scope: 'browser',
    loginRequired: 'none',
    parameters: z.object(baseSearchParams),
    result: searchImageResultSchema,
    handler: async (params, ctx) => {
      const page = ctx.page;
      if (!page) throw new Error('需要浏览器页面');
      try {
        const url = `https://search.bilibili.com/all?keyword=${encodeURIComponent(params.query)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: params.timeout });
        await page.waitForFunction(
          () => document.querySelectorAll('.bili-video-card__info--tit').length > 0,
          { timeout: 12000 }
        ).catch(() => {});
        await page.waitForTimeout(2000);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await page.waitForTimeout(1000);

        const results = await page.evaluate((limit) => {
          var images = [];

          document.querySelectorAll('img[src*="hdslb"], img[src*="bilivideo"], img[src*="hdslb.com"]').forEach(function(img, idx) {
            if (idx >= limit) return;
            if (img.naturalWidth < 80) return;
            var src = img.src || '';
            if (src.indexOf('avatar') > -1 || src.indexOf('icon') > -1 || src.indexOf('logo') > -1) return;
            var closestA = img.closest('a');
            images.push({
              title: img.alt || '',
              thumbnailUrl: src,
              sourceUrl: closestA ? closestA.getAttribute('href') : '',
              width: img.naturalWidth,
              height: img.naturalHeight,
            });
          });

          if (images.length === 0) {
            document.querySelectorAll('.bili-video-card img, .video-card img').forEach(function(img, idx) {
              if (idx >= limit) return;
              if (img.naturalWidth < 80) return;
              var src = img.src || '';
              if (src.indexOf('avatar') > -1 || src.indexOf('icon') > -1 || src.indexOf('logo') > -1) return;
              var closestA = img.closest('a');
              images.push({
                title: img.alt || '',
                thumbnailUrl: src,
                sourceUrl: closestA ? closestA.getAttribute('href') : '',
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
            });
          }

          return images;
        }, params.limit || 10);
        return buildResult(params.query, 'bilibili', results.map(r => ({ ...r, sourceSite: 'bilibili' })));
      } catch (error) {
        return buildFail(error, 'bilibili');
      }
    },
  });

  // ─── login/logout ──────────────────────────────

  site.login(async (ctx) => {
    const page = (ctx as unknown as Record<string, unknown>).page as import('../types').Page | undefined;
    console.log('⚠️  请使用 --cdp 参数连接到已登录 bilibili 的浏览器');
    console.log('     xbrowser bilibili search --query "测试" --cdp http://localhost:9221');
    if (page) {
      await page.goto('https://passport.bilibili.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    await ctx.storage.set('bilibili_login', { at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('bilibili_login');
  });
}
