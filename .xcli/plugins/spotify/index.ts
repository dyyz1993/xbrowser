import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  xcli.createSite({
    name: 'spotify',
    url: 'https://open.spotify.com',
    description: 'Spotify - 音乐搜索、专辑信息',
    requiresLogin: false,
  });

  // TODO: Implement commands per opencli adapter
  // site.command('xxx', { ... });
}
