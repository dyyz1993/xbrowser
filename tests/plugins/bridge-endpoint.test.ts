import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeHttpBase, bridgeHttpPort, DEFAULT_BRIDGE_HTTP } from '../../.xcli/plugins/shared/bridge-endpoint.js';

/**
 * chrome-bridge 端点的唯一来源（2026-11-24）。`XBROWSER_BRIDGE_HTTP` 是测试 / 多实例
 * 环境的隔离开关：驱动层和 daemon 一直认它，插件、发布层、控制台面板以前各自写死
 * 9347——隔离环境里跑一条相关命令就直接打进现网 bridge 和用户的浏览器。
 */
describe('bridge endpoint', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is the production bridge when nothing is configured', () => {
    vi.stubEnv('XBROWSER_BRIDGE_HTTP', '');
    expect(bridgeHttpBase()).toBe('http://127.0.0.1:9347');
    expect(bridgeHttpPort()).toBe(9347);
    expect(DEFAULT_BRIDGE_HTTP).toBe('http://127.0.0.1:9347');
  });

  it('follows XBROWSER_BRIDGE_HTTP', () => {
    vi.stubEnv('XBROWSER_BRIDGE_HTTP', 'http://127.0.0.1:19447');
    expect(bridgeHttpBase()).toBe('http://127.0.0.1:19447');
    expect(bridgeHttpPort()).toBe(19447);
  });

  it('reads the variable at call time, so a test can switch bridges', () => {
    vi.stubEnv('XBROWSER_BRIDGE_HTTP', 'http://127.0.0.1:19447');
    expect(bridgeHttpPort()).toBe(19447);
    vi.stubEnv('XBROWSER_BRIDGE_HTTP', '');
    expect(bridgeHttpPort()).toBe(9347);
  });

  it('ignores surrounding whitespace and a trailing slash', () => {
    vi.stubEnv('XBROWSER_BRIDGE_HTTP', '  http://127.0.0.1:19447/ ');
    expect(bridgeHttpBase()).toBe('http://127.0.0.1:19447');
    expect(bridgeHttpPort()).toBe(19447);
  });
});
