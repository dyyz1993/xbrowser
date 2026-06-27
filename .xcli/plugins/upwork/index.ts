import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  xcli.createSite({
    name: 'upwork',
    url: 'https://www.upwork.com',
    description: 'Upwork - 自由职业平台',
    requiresLogin: true,
  });

  // TODO: Implement commands per opencli adapter
  // site.command('xxx', { ... });
}
