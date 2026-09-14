import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';
import { randomPause } from '../shared/humanize.js';

/**
 * 51CTO 博客发布插件（2026-09-14 全流程实证 recipe，文章 ID 14933247）。
 *
 * 编辑器是 wukong 富文本（contenteditable .am-engine，模型 $VM.wukcontent）：
 * - locator.fill / 合成事件会被清空，唯一存活通道 = 真实点击聚焦 + CDP Input.insertText
 *   （\n 自动分段落，模型实时同步）
 * - 后台 tab 的 trusted 输入被 Chrome 静默丢弃，任何点击前必须 bringToFront
 * - 发布链：edit-submit → check-txt 敏感词检测 →（命中）prohi_words 弹窗 →
 *   continue_pub → 设置面板 → 选分类 → #submitForm → blogger/success/<id>
 */

function resolvePage(ctx: CommandContext): { page: Page; tips: string[] } {
  const page = ctx.page;
  if (!page) throw new Error('需要浏览器页面');
  const tips: string[] = [];
  if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器以获取登录态');
  return { page, tips };
}

// ── 驱动能力面：XBPage 实现了但 PluginPage 类型未声明（分层事实，收窄访问） ──
interface WithBringToFront { bringToFront?: () => Promise<void> }
interface WithPressCombo {
  pressCombo?: (key: string, modifier: 'Meta' | 'Control' | 'Alt' | 'Shift') => Promise<void>;
}

const PUBLISH_URL = 'https://blog.51cto.com/blogger/publish?old=1&newBloger=1';
const MANAGER_URL = 'https://blog.51cto.com/creative-center/manager';
const INSERT_CHUNK = 3000;

async function bringToFront(page: Page): Promise<void> {
  await (page as unknown as WithBringToFront).bringToFront?.();
}

/** evaluate 读元素中心坐标——evaluateHandle+boundingBox 在部分环境静默返回 null，直读 rect 更稳 */
async function centerOf(page: Page, selector: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`) as Promise<{ x: number; y: number } | null>;
}

async function clickCenter(page: Page, selector: string): Promise<boolean> {
  const c = await centerOf(page, selector);
  if (!c) return false;
  await page.mouse.click(c.x, c.y);
  return true;
}

/** 轮询等元素挂载并返回坐标——wukong 编辑器异步 boot，刚 goto 完单次探测必空 */
async function waitForCenter(page: Page, selector: string, timeoutMs: number): Promise<{ x: number; y: number } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const c = await centerOf(page, selector);
    if (c) return c;
    await page.waitForTimeout(500);
  }
  return null;
}

/**
 * 在 rootSel 容器集合里按 innerText 精确匹配并坐标点击（分类项无稳定 id/class）。
 * 测量与点击之间页面可能滚动（发文助手弹层收起使面板上移，实测坐标偏移 1~2 格）——
 * 用 elementFromPoint 自校验：命中目标才点，否则重测（最多 6 次）。
 */
async function clickTextItem(page: Page, rootSel: string, text: string): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const c = await page.evaluate(`(() => {
      const items = [...document.querySelectorAll(${JSON.stringify(rootSel)})];
      const el = items.find(i => (i.innerText || '').trim() === ${JSON.stringify(text)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      const ok = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
      return { x, y, ok };
    })()`) as { x: number; y: number; ok: boolean } | null;
    if (!c) return false;
    if (c.ok) {
      await page.mouse.click(c.x, c.y);
      return true;
    }
    await page.waitForTimeout(400);
  }
  return false;
}

async function isVisible(page: Page, selector: string): Promise<boolean> {
  return page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
  })()`) as Promise<boolean>;
}

async function waitForVisible(page: Page, selector: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isVisible(page, selector)) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

/** 多选择器竞速等待，返回先可见的选择器（无敏感词时设置面板直接弹出，省 8s 轮询） */
async function waitForAnyVisible(page: Page, selectors: string[], timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const s of selectors) {
      if (await isVisible(page, s)) return s;
    }
    await page.waitForTimeout(300);
  }
  return null;
}

async function waitForUrl(page: Page, test: (u: string) => boolean, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const u = page.url();
    if (test(u)) return u;
    await page.waitForTimeout(500);
  }
  return null;
}

async function cmdA(page: Page): Promise<void> {
  const kb = page.keyboard as unknown as WithPressCombo;
  if (kb.pressCombo) {
    await kb.pressCombo('a', 'Meta');
  } else {
    await page.keyboard.down('Meta');
    await page.keyboard.press('a');
    await page.keyboard.up('Meta');
  }
}

async function fillTitle(page: Page, title: string): Promise<void> {
  const c = await waitForCenter(page, 'input.editor-title', 15000);
  if (!c) throw new Error('标题输入框未找到（input.editor-title，15s 未挂载）');
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(300);
  await cmdA(page);
  await page.waitForTimeout(150);
  await page.keyboard.insertText(title);
  await page.waitForTimeout(400);
}

async function fillBody(page: Page, content: string): Promise<void> {
  const c = await waitForCenter(page, '.am-engine', 15000);
  if (!c) throw new Error('正文编辑器未找到（.am-engine，15s 未挂载）');
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(400);
  await cmdA(page);
  await page.waitForTimeout(150);
  for (let i = 0; i < content.length; i += INSERT_CHUNK) {
    await page.keyboard.insertText(content.slice(i, i + INSERT_CHUNK));
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(800);
}

/** 编辑器模型同步验收——innerText 长度不可信（Draft 系惰性更新），$VM.wukcontent 是真信号 */
async function verifyModelSync(page: Page): Promise<number> {
  return page.evaluate('(() => (typeof $VM !== "undefined" && $VM.wukcontent) ? $VM.wukcontent.length : 0)()') as Promise<number>;
}

/** 选一级+二级分类。二级面板由接口异步填充——轮询等待；失败时带面板状态诊断 */
async function selectCategories(page: Page, cat1: string, cat2: string): Promise<string | null> {
  if (!await clickTextItem(page, '.first-types-content .select_item, .types_content .select_item', cat1)) {
    return `一级分类「${cat1}」未找到`;
  }
  // 二级列表异步渲染：轮询直到目标项出现（接口慢时 800ms 固定等待不够）
  const deadline = Date.now() + 8000;
  let clicked = false;
  while (Date.now() < deadline) {
    if (await clickTextItem(page, '.second-types-content .select_item, .second-types-item', cat2)) {
      clicked = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  if (!clicked) {
    const diag = await page.evaluate(`(() => ({
      wrapper: (() => { const d = document.querySelector('.editor-dialog__wrapper'); return d ? getComputedStyle(d).display : 'missing'; })(),
      secondTexts: [...document.querySelectorAll('.second-types-content .select_item, .second-types-item')].map(i => i.innerText.trim()).slice(0, 15)
    }))()`) as Record<string, unknown>;
    try {
      const { writeFileSync } = await import('node:fs');
      writeFileSync('/tmp/cto-cat-fail.png', (await page.screenshot()) as Buffer);
    } catch { /* 截图失败不遮蔽原错误 */ }
    return `二级分类「${cat2}」未选中：面板=${JSON.stringify(diag)}`;
  }
  await page.waitForTimeout(500);
  return null;
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: '51cto',
    url: 'https://www.51cto.com',
    description: '51CTO - IT技术/运维/认证社区 (DA 65+, 运维内容权重高)',
    requiresLogin: true,
    isLogin: async (ctx) => {
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const page = ctxAny.page as Page | undefined;
      if (!page) return true;
      // 文字启发式不可靠（未登录入口"登录注册"藏在页脚，已登录页也含该串）——
      // 确定性探测：发布页未登录时硬重定向 home.51cto.com/login
      try {
        await page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(1200);
        return !(await page.url()).includes('home.51cto.com');
      } catch { return true; }
    },
  });

  site.command('login', {
    description: '登录 51CTO（打开登录页等待人工完成）',
    loginRequired: 'none', scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser 51cto login', description: '登录 51CTO' }],
    result: z.object({ loggedIn: z.boolean(), url: z.string() }).passthrough(),
    handler: async (_params, ctx) => {
      const { page } = resolvePage(ctx);
      await page.goto('https://home.51cto.com/index/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await randomPause(1200, 2400);
      await ctx.waitForHuman?.({ reason: '完成 51CTO 登录（手机号验证码/微信扫码）', timeout: 300 });
      await page.goto('https://blog.51cto.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      const loggedIn = !(await page.url()).includes('login');
      return ok({ loggedIn, url: page.url() }, [loggedIn ? '51CTO 登录成功' : '仍未登录']);
    },
  });

  const openEditor = async (page: Page): Promise<string | null> => {
    await page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('domcontentloaded');
    await randomPause(1500, 3000);
    if ((await page.url()).includes('home.51cto.com')) return '未登录：先跑 xbrowser 51cto login';
    return null;
  };

  site.command('draft', {
    description: '在 51CTO 编辑器填入文章（自动保存草稿）',
    loginRequired: 'required', scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().optional().describe('正文（与 file 二选一）'),
      file: z.string().optional().describe('Markdown 文件路径（与 content 二选一）'),
    }),
    result: z.object({ title: z.string(), saved: z.boolean(), url: z.string(), modelBytes: z.number() }).passthrough(),
    examples: [{ cmd: 'xbrowser 51cto draft --title "T" --file a.md', description: '填入草稿' }],
    handler: async (params, ctx) => {
      let content = params.content || '';
      if (!content && params.file) { const { readFileSync } = await import('node:fs'); content = readFileSync(params.file, 'utf8'); }
      if (!content) return fail('必须提供 --content 或 --file 参数');
      const { page, tips } = resolvePage(ctx);
      const err = await openEditor(page);
      if (err) return fail(err);
      await bringToFront(page);
      try {
        await fillTitle(page, params.title);
        await randomPause(500, 1000);
        await fillBody(page, content);
      } catch (e) {
        return fail(String(e instanceof Error ? e.message : e));
      }
      const modelBytes = await verifyModelSync(page);
      if (modelBytes < 100) return fail('编辑器模型未同步（$VM.wukcontent 为空）——内容可能未插入');
      return ok({ title: params.title, saved: true, url: page.url(), modelBytes }, [...tips, `内容已插入（模型 ${modelBytes} 字节），51CTO 会自动保存草稿`]);
    },
  });

  site.command('publish', {
    description: '在 51CTO 发布文章（全自动：敏感词确认弹窗 + 分类选择 + 提交）',
    loginRequired: 'required', scope: 'page',
    parameters: z.object({
      title: z.string().describe('文章标题'),
      content: z.string().optional().describe('正文（与 file 二选一）'),
      file: z.string().optional().describe('Markdown 文件路径（与 content 二选一）'),
      category1: z.string().optional().default('后端开发').describe('一级分类'),
      category2: z.string().optional().default('架构').describe('二级分类'),
      keepAlive: z.boolean().optional().default(false).describe('发布后保留 session'),
    }),
    result: z.object({
      title: z.string(), published: z.boolean(), url: z.string(),
      articleId: z.string().optional(), sensitiveReview: z.boolean().optional(),
    }).passthrough(),
    examples: [{ cmd: 'xbrowser 51cto publish --title "T" --file a.md', description: '发布文章' }],
    handler: async (params, ctx) => {
      const { page, tips } = resolvePage(ctx);
      let content = params.content || '';
      if (!content && params.file) { const { readFileSync } = await import('node:fs'); content = readFileSync(params.file, 'utf8'); }
      if (!content) return fail('必须提供 --content 或 --file 参数');

      const err = await openEditor(page);
      if (err) return fail(err);
      await bringToFront(page);
      try {
        await fillTitle(page, params.title);
        await randomPause(500, 1000);
        await fillBody(page, content);
      } catch (e) {
        return fail(String(e instanceof Error ? e.message : e));
      }
      const modelBytes = await verifyModelSync(page);
      if (modelBytes < 100) return fail('编辑器模型未同步（$VM.wukcontent 为空）——发布会被"正文不能为空"早退');

      // 发布 → 敏感词检测：无敏感词直接弹设置面板，有则先弹 prohi_words 确认框
      await bringToFront(page);
      if (!await clickCenter(page, '.edit-submit')) return fail('发布按钮未找到（.edit-submit）');
      const first = await waitForAnyVisible(page, ['.dialog.prohi_words', '.editor-dialog__wrapper'], 15000);
      let sensitiveReview = false;
      if (first === '.dialog.prohi_words') {
        sensitiveReview = true;
        if (!await clickCenter(page, '.continue_pub')) return fail('敏感词确认按钮未找到（.continue_pub）');
      }
      if (!await waitForVisible(page, '.editor-dialog__wrapper', 10000)) {
        return fail('发布设置面板未打开（可能正文/标题为空被早退，或 check-txt 接口异常）');
      }
      // 面板带 fadeInRightBig 滑入动画：动画期间测量的坐标在元素最终位置右侧，
      // 点击会命中右侧 1~3 格的分类（前端开发/数据库/移动开发 实录）——等动画结束
      await page.waitForTimeout(1500);

      const catErr = await selectCategories(page, params.category1, params.category2);
      if (catErr) return fail(catErr);

      // 终发布：#submitForm 无 baseinfo class 时跳过表单校验直接提交
      await bringToFront(page);
      if (!await clickCenter(page, '#submitForm')) return fail('终发布按钮未找到（#submitForm）');
      const successUrl = await waitForUrl(page, u => u.includes('blogger/success/'), 20000);
      if (!successUrl) {
        return fail('提交后未跳转成功页（分类/标签可能未通过校验，请人工检查设置面板）');
      }
      const m = successUrl.match(/success\/(\d+)/);
      const articleId = m ? m[1] : undefined;
      const reviewTip = sensitiveReview
        ? '文章含敏感词已进人工审核（"发布成功-待审核"），审核结果见 xbrowser 51cto status'
        : '发布成功，可在创作中心查看';
      if (!params.keepAlive) await page.waitForTimeout(1000);
      return ok(
        { title: params.title, published: true, url: successUrl, articleId, sensitiveReview },
        [...tips, reviewTip],
      );
    },
  });

  site.command('status', {
    description: '查询创作中心文章审核状态（待审核/未通过+原因/已发布计数）',
    loginRequired: 'required', scope: 'page',
    parameters: z.object({}),
    result: z.object({
      pending: z.number(), rejected: z.number(),
      rejectReasons: z.array(z.object({ title: z.string(), reason: z.string() })),
    }).passthrough(),
    examples: [{ cmd: 'xbrowser 51cto status', description: '查审核状态' }],
    handler: async (_params, ctx) => {
      const { page, tips } = resolvePage(ctx);
      await page.goto(MANAGER_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('domcontentloaded');
      await randomPause(2000, 3500);
      if ((await page.url()).includes('home.51cto.com')) return fail('未登录：先跑 xbrowser 51cto login');
      // 计数由接口异步填充（初始渲染无数字）——轮询直到出现 "(n)" 或超时
      const deadline = Date.now() + 8000;
      let counts = { pending: 0, rejected: 0 };
      while (Date.now() < deadline) {
        counts = await page.evaluate(`(() => {
          const read = (t) => {
            const el = [...document.querySelectorAll('strong')].find(e => e.innerText.trim().startsWith(t));
            const m = el ? el.innerText.match(/\\((\\d+)\\)/) : null;
            return m ? Number(m[1]) : -1;
          };
          return { pending: read('待审核'), rejected: read('未通过') };
        })()`) as { pending: number; rejected: number };
        if (counts.pending >= 0 && counts.rejected >= 0) break;
        await page.waitForTimeout(500);
      }
      if (counts.pending < 0) counts.pending = 0;
      if (counts.rejected < 0) counts.rejected = 0;

      // 未通过列表：点开标签读渲染后的标题+原因（art-template 异步渲染）
      const rejectReasons: Array<{ title: string; reason: string }> = [];
      if (counts.rejected > 0) {
        await bringToFront(page);
        await clickCenter(page, 'strong[attr_type="6"]');
        await page.waitForTimeout(2500);
        const rows = await page.evaluate(`(() => {
          const items = [...document.querySelectorAll('.common-article-list')];
          return items.map(e => ({
            title: (e.querySelector('.title a')?.innerText || '').trim().slice(0, 80),
            reason: (e.querySelector('.through-text')?.innerText || '').trim(),
          }));
        })()`) as Array<{ title: string; reason: string }>;
        rejectReasons.push(...rows);
      }
      return ok({ ...counts, rejectReasons }, [...tips, '审核被拒常见原因：含广告信息（GitHub/npm 推广链接）——去链接后可重新发布']);
    },
  });
}
