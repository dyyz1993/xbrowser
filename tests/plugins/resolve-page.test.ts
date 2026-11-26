import type { CommandContext } from '@dyyz1993/xcli-core';
import { describe, expect, it } from 'vitest';
import { resolvePage } from '../../.xcli/plugins/shared/resolve-page.js';

describe('resolvePage', () => {
  it('returns the page without a CDP tip when cdpEndpoint is present', () => {
    const page = {} as import('../../.xcli/plugins/types.js').Page;
    expect(resolvePage({ page, cdpEndpoint: 'x' } as CommandContext)).toEqual({
      page,
      tips: [],
    });
  });

  it('suggests CDP when no endpoint is present', () => {
    const page = {} as import('../../.xcli/plugins/types.js').Page;
    expect(resolvePage({ page } as CommandContext)).toEqual({
      page,
      tips: ['建议使用 --cdp 9221 连接 Chrome 浏览器以获取登录态'],
    });
  });

  it('throws when no page is present', () => {
    expect(() => resolvePage({} as CommandContext)).toThrow('需要浏览器页面');
  });
});
