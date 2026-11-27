import type { CommandContext } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';

/**
 * 插件命令里反复出现的两个小工具（此前 `gp` / `buildTips` 在十来个插件里各有一份拷贝）。
 */

/** 取 ctx.page；没有就抛错（scope 为 page/browser 的命令，运行时一定会注入 page）。 */
export function requirePage(
  ctx: CommandContext,
  message = '需要浏览器页面，请使用 --cdp 连接',
): Page {
  const page = ctx.page;
  if (!page) throw new Error(message);
  return page;
}

/**
 * 会话类提示：没连 CDP 时提醒怎么连，并带上当前 session 名。
 * `hint` 缺省是通用文案；站点可以传自己的（如「连接到已登录 Suno 的浏览器」）。
 */
export function sessionTips(
  ctx: CommandContext | Record<string, unknown>,
  hint = '建议使用 --cdp 9221 连接到已登录的浏览器',
): string[] {
  const tips: string[] = [];
  // 部分插件内部的辅助函数把 ctx 放宽成了 Record<string, unknown>，两种形态都接
  const ctxAny = ctx as Record<string, unknown>;
  const options = ctxAny.options as Record<string, unknown> | undefined;
  const cdp = ctxAny.cdpEndpoint || options?.cdp;
  if (!cdp) tips.push(hint);
  tips.push(`Session: ${ctxAny.sessionId || 'default'}`);
  return tips;
}
