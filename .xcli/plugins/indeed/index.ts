import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  xcli.createSite({
    name: 'indeed',
    url: 'https://www.indeed.com',
    description: 'Indeed - 职位搜索',
    requiresLogin: false,
  });

  // TODO: Implement commands per opencli adapter
  // site.command('xxx', { ... });
}
