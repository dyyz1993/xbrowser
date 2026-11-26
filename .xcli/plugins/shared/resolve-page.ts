import type { CommandContext } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';
import { requirePage } from './page-context.js';

export function resolvePage(ctx: CommandContext): { page: Page; tips: string[] } {
  // 只复用「取 page / 缺 page 报错」；提示文案保持原样（这里不带 Session 行，调用方的输出不变）
  const page = requirePage(ctx, '需要浏览器页面');
  const tips: string[] = [];
  if (!ctx.cdpEndpoint) {
    tips.push('建议使用 --cdp 9221 连接 Chrome 浏览器以获取登录态');
  }
  return { page, tips };
}
