import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  xcli.createSite({
    name: 'linkedin',
    url: 'https://www.linkedin.com',
    description: 'LinkedIn - 职业社交网络',
    requiresLogin: true,
  });

  // TODO: Implement commands per opencli adapter
  // site.command('xxx', { ... });
}
