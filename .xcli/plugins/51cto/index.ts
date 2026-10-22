import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';
import { randomPause } from '../shared/humanize.js';
import { register51ctoPublishing } from './publishing.js';
import { checkLoggedIn } from '../shared/publishing/login-probe.js';

/**
 * 51CTO 博客插件。
 *
 * 发布（draft / publish）已迁移到共享发布层 `shared/publishing/`——
 * 51CTO 编辑器 UI 在 2026 年换过一次版（旧的 `.editor-dialog__wrapper` +
 * `#submitForm` 两级分类面板已不存在，新版是右侧「基础信息」面板）。
 * 详见 `publishing.ts` 与 `shared/publishing/sites/51cto.ts`。
 *
 * 本文件保留：站点注册、登录、审核状态查询。
 */

const PUBLISH_URL = 'https://blog.51cto.com/blogger/publish?old=1&newBloger=1';
const MANAGER_URL = 'https://blog.51cto.com/creative-center/manager';

function resolvePage(ctx: CommandContext): { page: Page; tips: string[] } {
  const page = ctx.page;
  if (!page) throw new Error('需要浏览器页面');
  const tips: string[] = [];
  if (!ctx.cdpEndpoint) tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器以获取登录态');
  return { page, tips };
}

/** 驱动能力面：XBPage 实现了但 PluginPage 类型未声明（分层事实，收窄访问） */
interface WithBringToFront {
  bringToFront?: () => Promise<void>;
}

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

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: '51cto',
    url: 'https://www.51cto.com',
    description: '51CTO - IT技术/运维/认证社区 (DA 65+, 运维内容权重高)',
    requiresLogin: true,
    isLogin: async (ctx) => {
      // bridge 优先——用户登录态在用户自己的 Chrome 里（发布走 bridge 通道）
      const ctxAny = ctx as unknown as Record<string, unknown>;
      const page = ctxAny.page as Page | undefined;
      return checkLoggedIn('51cto', PUBLISH_URL, async () => {
        if (!page) return true;
        // 文字启发式不可靠（未登录入口"登录注册"藏在页脚，已登录页也含该串）——
        // 确定性探测：发布页未登录时硬重定向 home.51cto.com/login
        try {
          await page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForTimeout(1200);
          return !(await page.url()).includes('home.51cto.com');
        } catch {
          return true;
        }
      });
    },
  });

  site.command('login', {
    description: '登录 51CTO（打开登录页等待人工完成）',
    loginRequired: 'none',
    scope: 'browser',
    parameters: z.object({}),
    examples: [{ cmd: 'xbrowser 51cto login', description: '登录 51CTO' }],
    result: z.object({ loggedIn: z.boolean(), url: z.string() }).passthrough(),
    handler: async (_params, ctx) => {
      const { page } = resolvePage(ctx);
      await page.goto('https://home.51cto.com/index/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await randomPause(1200, 2400);
      await ctx.waitForHuman?.({ reason: '完成 51CTO 登录（手机号验证码/微信扫码）', timeout: 300 });
      await page.goto('https://blog.51cto.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      const loggedIn = !(await page.url()).includes('home.51cto.com');
      return ok({ loggedIn, url: page.url() }, [loggedIn ? '51CTO 登录成功' : '仍未登录']);
    },
  });

  site.command('status', {
    description: '查询创作中心文章审核状态（待审核/未通过+原因/已发布计数）',
    loginRequired: 'required',
    scope: 'page',
    parameters: z.object({}),
    result: z.object({
      pending: z.number(),
      rejected: z.number(),
      rejectReasons: z.array(z.object({ title: z.string(), reason: z.string() })),
    }).passthrough(),
    examples: [{ cmd: 'xbrowser 51cto status', description: '查审核状态' }],
    handler: async (_params, ctx) => {
      const { page, tips } = resolvePage(ctx);
      await page.goto(MANAGER_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('domcontentloaded');
      await randomPause(2000, 3500);
      if ((await page.url()).includes('home.51cto.com')) return fail('未登录：先跑 xbrowser 51cto login');
      // 计数由接口异步填充——数字在 tab strong 的相邻兄弟 "(n)" 里
      // （strong 自身 innerText 只有"待审核/未通过"，实测 2026-09-15）
      const deadline = Date.now() + 8000;
      let counts = { pending: 0, rejected: 0 };
      while (Date.now() < deadline) {
        counts = await page.evaluate(`(() => {
          const read = (attrType) => {
            const el = document.querySelector('strong[attr_type="' + attrType + '"]');
            const m = el && el.nextElementSibling ? el.nextElementSibling.innerText.match(/\\((\\d+)\\)/) : null;
            return m ? Number(m[1]) : -1;
          };
          return { pending: read('1'), rejected: read('6') };
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

  // draft / publish —— 共享发布层（chrome-bridge 优先，本地 page 兜底）
  register51ctoPublishing(site);
}
