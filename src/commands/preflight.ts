import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

/**
 * preflight — 预检门禁（用户产品级指令 2026-09-13）：
 * "所有自动化任务启动前必须先过反爬检测页，检测成功才放行。"
 *
 * 打开本地检测页（assets/preflight.html，免外网依赖）跑八族断言
 * （webdriver/headless-UA/UA-platform 一致性/plugins/languages/window.chrome/
 * permissions/viewport），全过 → gate=pass；有败项 → gate=fail 并列出失败项。
 *
 * 用法：
 *   xbrowser preflight                          # 自检并输出报告
 *   xbrowser preflight --strict                 # 失败时 exit 1（CI/链式用）
 *   xbrowser "preflight --strict && goto https://..."  # 门禁放行才执行任务
 *
 * headless 发布禁令：--publish 场景（或环境 XBROWSER_NO_HEADLESS_PUBLISH=1）
 * 下检测到 headless UA 直接 fail——发布类操作（真实账号发内容）禁用 headless
 * 是风控红线（知乎/思否四站实证：headless cookie 快速作废 + 服务端踢会话）。
 */
export const preflightCommand = registerCommand({
	name: 'preflight',
	description: 'Pre-flight anti-bot gate: open local detection page and verify stealth posture before any automation task',
	scope: 'page',
	parameters: z.object({
		strict: z.boolean().optional().describe('失败时以非零退出码结束（链式/CI 门禁用）'),
		publish: z.boolean().optional().describe('发布类任务门禁：headless 环境直接判失败（默认由 XBROWSER_NO_HEADLESS_PUBLISH 控制）'),
	}),
	result: z.object({
		gate: z.enum(['pass', 'fail']),
		failed: z.array(z.string()),
		headless: z.boolean(),
	}),
	handler: async (p, ctx: BrowserCommandContext) => {
		const page = ctx.page;
		const tips: string[] = [];

		// headless 判定（UA 泄漏 + outerWidth 特征双信号）
		const ua = await page.evaluate<string>('navigator.userAgent').catch(() => '');
		const outerW = await page.evaluate<number>('window.outerWidth').catch(() => 0);
		const headless = /headless/i.test(ua) || outerW === 0;

		// 发布禁令：发布场景禁 headless（红线——真实账号发布走有头真浏览器）
		const publishMode = p.publish || process.env.XBROWSER_NO_HEADLESS_PUBLISH === '1';
		if (publishMode && headless) {
			tips.push('发布类任务禁用 headless（风控红线）：接有头真浏览器后重试');
			tips.push('  有头 Chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --user-data-dir=~/.xbrowser/chrome-profile-headed --remote-debugging-port=9222');
			tips.push('  然后加 --cdp http://localhost:9222');
			return fail('PREFLIGHT-FAIL: headless 不允许用于发布类任务（用 --cdp 接有头 Chrome）', tips);
		}

		// 打开本地检测页（随包分发的 assets/preflight.html；找不到则用内置 data: 兜底）
		let pageUrl: string | null = null;
		try {
			const { fileURLToPath } = await import('url');
			const { join, dirname } = await import('path');
			const { existsSync } = await import('fs');
			const here = typeof __filename !== 'undefined'
			// ESM 下 __filename 不可用；用 import.meta 兜底（tsup 会注入）
			? __filename
			: fileURLToPath(import.meta.url);
			const candidates = [
				join(dirname(here), '..', 'assets', 'preflight.html'),
				join(process.cwd(), 'assets', 'preflight.html'),
			];
			pageUrl = candidates.find((c) => existsSync(c)) || null;
		} catch { /* fallthrough */ }

		if (pageUrl) {
			await page.goto('file://' + pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
		} else {
			// 兜底：最小 inline 断言页（webdriver + UA 两族核心断言）
			await page.goto('about:blank');
			await page.evaluate(`(function(){
				var fails=[];
				if(navigator.webdriver!==false)fails.push('webdriver');
				if(/headless/i.test(navigator.userAgent))fails.push('ua-no-headless');
				window.__pf=fails.join(',');
				document.title=fails.length?'PREFLIGHT-FAIL':'PREFLIGHT-PASS';
			})()`);
		}
		await page.waitForTimeout(1200); // permissions 异步断言完成

		const result = await page.evaluate<{ title: string; fails: string }>(`(function(){
			var out=document.getElementById('out');
			return { title: document.title, fails: out ? (out.getAttribute('data-fails')||'') : (window.__pf||'') };
		})()`).catch(() => ({ title: 'PREFLIGHT-FAIL', fails: 'evaluate-error' }));

		const passed = result.title === 'PREFLIGHT-PASS';
		const failed = result.fails ? result.fails.split(',').filter(Boolean) : [];
		tips.push(`headless=${headless}${publishMode ? '（publish 门禁开启）' : ''}`);
		if (passed) {
			tips.push('预检通过：反爬姿态全部断言绿灯，可执行自动化任务');
			return ok({ gate: 'pass' as const, failed: [], headless }, tips);
		}
		tips.push(`失败项: ${failed.join(', ') || result.title}`);
		tips.push('修复指引: headless 环境接有头 Chrome（--cdp）；webdriver 泄漏检查 stealth 垫片（XBROWSER_STEALTH 不为 off）');
		return fail(`PREFLIGHT-FAIL: ${failed.join(', ') || result.title}`, tips);
	},
});
