import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  xcli.createSite({
    name: 'confluence',
    url: 'https://xxx.atlassian.net/wiki',
    description: 'Confluence - 团队文档',
    requiresLogin: true,
  });

  // TODO: Implement commands per opencli adapter
  // site.command('xxx', { ... });
}
