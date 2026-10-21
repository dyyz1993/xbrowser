import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('console serve', () => {
  let serverRef: Server | null = null;

  afterEach(async () => {
    await fetch('http://127.0.0.1:9225/health', { method: 'DELETE' }).catch(() => {});
    serverRef?.close();
    serverRef = null;
  });

  it('serves readonly JSON and HTML overview', async () => {
    mockBuildOverview.mockResolvedValue({ readonly: true, stats: { runningSessions: 1 } });
    const serveModule = await import('../../src/console/serve.js');
    serverRef = (serveModule as unknown as { __serverForTests?: Server }).__serverForTests ?? null;
    void handleConsoleServe([], {}, 'json');
    await vi.waitFor(async () => {
      const health = await get('/health');
      expect(health.status).toBe(200);
      expect(JSON.parse(health.text)).toMatchObject({ readonly: true });
    });
    const api = await get('/api/overview', 'application/json');
    expect(JSON.parse(api.text)).toMatchObject({ readonly: true });
    const page = await get('/overview');
    expect(page.text).toContain('Read-only prototype');
    expect(mockBuildOverview).toHaveBeenCalled();
  });
});
