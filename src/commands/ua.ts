import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

/**
 * UA 覆盖用 addInitScript（页面级、随导航持续）+ 当前页立即 evaluate。
 * 不用 Network.setUserAgentOverride——daemon 每条命令独立 CDP session，
 * override 会随 session 丢弃（实测）。
 */
function uaHookScript(ua: string): string {
	const uaJson = JSON.stringify(ua);
	const appVersion = JSON.stringify(ua.replace(/^Mozilla\//, ''));
	return (
		`try{Object.defineProperty(navigator,'userAgent',{get:()=>${uaJson},configurable:true});` +
		`Object.defineProperty(navigator,'appVersion',{get:()=>${appVersion},configurable:true});` +
		`Object.defineProperty(navigator,'vendor',{get:()=>'Google Inc.',configurable:true});}catch(e){}`
	);
}

export const uaCommand = registerCommand({
	name: 'ua',
	description: 'Get or override the session User-Agent (anti-bot UA detection countermeasure)',
	scope: 'page',
	parameters: z.object({
		value: z.string().optional().describe('新的 User-Agent；留空则返回当前 UA；"reset" 恢复常见 Chrome UA'),
	}),
	handler: async (p, ctx: BrowserCommandContext) => {
		if (!p.value) {
			const current = await ctx.page.evaluate<string>('navigator.userAgent');
			return ok({ userAgent: current });
		}
		const ua =
			p.value.toLowerCase() === 'reset'
				? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
				: p.value;
		const script = uaHookScript(ua);
		await ctx.page.addInitScript(script);
		await ctx.page.evaluate(`(function(){${script}})()`);
		return ok({ userAgent: ua, mode: 'init-script' });
	},
});
