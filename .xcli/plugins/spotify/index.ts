import { z } from 'zod/v4';
import type { XCLIAPI, CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from '../types.js';

function gp(ctx: CommandContext): Page {
  const p = ctx.page;
  if (!p) throw new Error('需要浏览器页面，请使用 --cdp 连接');
  return p;
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'spotify',
    url: 'https://open.spotify.com',
    description: 'Spotify - 音乐搜索、专辑信息',
    requiresLogin: false,
  });

  // TODO: Implement commands per opencli adapter
  // site.command('xxx', { ... });
}
