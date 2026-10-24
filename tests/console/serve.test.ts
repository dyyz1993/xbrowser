import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const { mockBuildOverview } = vi.hoisted(() => ({ mockBuildOverview: vi.fn() }));

vi.mock('../../src/console/facade.js', () => ({
  buildConsoleOverview: mockBuildOverview,
}));

import { Server } from 'node:http';
import { handleConsoleServe } from '../../src/console/serve.js';

async function get(path: string, accept?: string) {
  const response = await fetch(`http://127.0.0.1:9225${path}`, {
    headers: accept ? { accept } : {},
  });
  return { status: response.status, text: await response.text() };
}

/**
 * 共享服务器模式：整个文件只起一次 9225。
 *
 * 此前每用例各起一次，端口释放存在竞态——上一个 server 未完全让出端口
 * 时下一个 listen 就 EADDRINUSE，而 serve.ts 的 error handler 会
 * process.exit(1)（CI 实测 Unhandled Error 直接打挂 test job）。
 */
describe('console serve', () => {
  let server: Server | null = null;

  beforeAll(async () => {
    mockBuildOverview.mockResolvedValue({ readonly: true, stats: { runningSessions: 1 } });
    const serveModule = await import('../../src/console/serve.js');
    void handleConsoleServe([], {}, 'json');
    await vi.waitFor(async () => {
      const health = await get('/health');
      expect(health.status).toBe(200);
    });
    server = (serveModule as unknown as { __serverForTests?: Server }).__serverForTests ?? null;
  }, 15_000);

  afterAll(async () => {
    await fetch('http://127.0.0.1:9225/health', { method: 'DELETE' }).catch(() => {});
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  afterEach(() => {
    // 恢复默认 mock（个别用例改过行为）
    mockBuildOverview.mockResolvedValue({ readonly: true, stats: { runningSessions: 1 } });
  });

  it('serves readonly JSON and HTML overview', async () => {
    const health = await get('/health');
    expect(health.status).toBe(200);
    expect(JSON.parse(health.text)).toMatchObject({ readonly: true });
    const api = await get('/api/overview', 'application/json');
    expect(JSON.parse(api.text)).toMatchObject({ readonly: true });
    const page = await get('/overview');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<html');
  });

  it('根路径返回 HTML，未知路径 404，健康端点独立于 overview 构建', async () => {
    const root = await get('/');
    expect(root.status).toBe(200);
    expect(root.text).toContain('<html');

    const notFound = await get('/no-such-path');
    expect(notFound.status).toBe(404);
  });

  it('overview 构建失败时 /api/overview 返回 5xx 而非挂死', async () => {
    mockBuildOverview.mockRejectedValue(new Error('source down'));
    const api = await get('/api/overview');
    expect(api.status).toBeGreaterThanOrEqual(500);
  });
});
