/**
 * daemon 构建指纹（buildId）：同 version、不同构建的"旧 daemon 跑旧代码"
 * 场景必须在 CLI 连接时触发重启（2026-11-21 调试黑洞实录）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockStop = vi.fn().mockResolvedValue(undefined);
const mockStart = vi.fn().mockResolvedValue(undefined);
let healthResponse: Record<string, unknown> = { status: 'ok' };

vi.mock('../../src/daemon/daemon.js', () => ({
  startDaemonProcess: mockStart,
  stopDaemonProcess: mockStop,
  killAllDaemonProcesses: vi.fn(),
}));

// 模拟"新构建的 CLI"：version 与 daemon 相同、buildId 不同
vi.mock('../../src/version.js', () => ({
  version: '9.9.9',
  buildId: 'newbuild',
}));

const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  globalThis.fetch = vi.fn(async () =>
    Promise.resolve({ ok: true, json: async () => healthResponse }) as unknown as Response,
  );
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.XBROWSER_DAEMON_SKIP_BUILD_CHECK;
});

describe('daemon buildId mismatch restart', () => {
  it('同 version、buildId 不同 → 停旧 daemon 并重启', async () => {
    healthResponse = { status: 'ok', version: '9.9.9', buildId: 'oldbuild' };
    const { daemonPing } = await import('../../src/client/daemon-client.js');
    await daemonPing();
    expect(mockStop).toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalled();
  });

  it('buildId 相同 → 不重启', async () => {
    healthResponse = { status: 'ok', version: '9.9.9', buildId: 'newbuild' };
    const { daemonPing } = await import('../../src/client/daemon-client.js');
    await daemonPing();
    expect(mockStop).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('daemon 上报 buildId 缺失（旧版 daemon）→ 不因 build 重启（version 一致）', async () => {
    healthResponse = { status: 'ok', version: '9.9.9' };
    const { daemonPing } = await import('../../src/client/daemon-client.js');
    await daemonPing();
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('XBROWSER_DAEMON_SKIP_BUILD_CHECK=1 → buildId 不同也不重启', async () => {
    process.env.XBROWSER_DAEMON_SKIP_BUILD_CHECK = '1';
    healthResponse = { status: 'ok', version: '9.9.9', buildId: 'oldbuild' };
    const { daemonPing } = await import('../../src/client/daemon-client.js');
    await daemonPing();
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('src 直跑（buildId=dev）不参与比较——模拟旧版 CLI 无指纹', async () => {
    vi.doMock('../../src/version.js', () => ({ version: '9.9.9', buildId: 'dev' }));
    healthResponse = { status: 'ok', version: '9.9.9', buildId: 'oldbuild' };
    const { daemonPing } = await import('../../src/client/daemon-client.js');
    await daemonPing();
    expect(mockStop).not.toHaveBeenCalled();
  });
});
