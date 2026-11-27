import { describe, expect, it } from 'vitest';
import { requirePage, sessionTips } from '../../.xcli/plugins/shared/page-context.js';

describe('shared page-context', () => {
  it('requirePage returns the injected page', () => {
    const page = { url: () => 'https://example.com' };
    expect(requirePage({ page } as never)).toBe(page);
  });

  it('requirePage throws the default or a custom message when there is no page', () => {
    expect(() => requirePage({} as never)).toThrow('需要浏览器页面，请使用 --cdp 连接');
    expect(() => requirePage({} as never, '需要浏览器页面')).toThrow('需要浏览器页面');
  });

  it('sessionTips suggests --cdp only when no CDP endpoint is known, and always names the session', () => {
    expect(sessionTips({ sessionId: 's1', cdpEndpoint: 'http://localhost:9222' } as never))
      .toEqual(['Session: s1']);
    expect(sessionTips({ options: { cdp: 'http://localhost:9222' } } as never))
      .toEqual(['Session: default']);
    expect(sessionTips({} as never)).toEqual([
      '建议使用 --cdp 9221 连接到已登录的浏览器',
      'Session: default',
    ]);
    expect(sessionTips({} as never, '连接到已登录 Suno 的浏览器')[0]).toBe('连接到已登录 Suno 的浏览器');
  });
});
