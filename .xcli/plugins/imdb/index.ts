import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  xcli.createSite({
    name: 'imdb',
    url: 'https://www.imdb.com',
    description: 'IMDb - 电影电视剧信息',
    requiresLogin: false,
  });

  // TODO: Implement commands per opencli adapter
  // site.command('xxx', { ... });
}
