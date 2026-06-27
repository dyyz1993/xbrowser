import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  xcli.createSite({
    name: 'reuters',
    url: 'https://www.reuters.com',
    description: 'Reuters - 新闻资讯',
    requiresLogin: false,
  });

  // TODO: Implement commands per opencli adapter
  // site.command('xxx', { ... });
}
