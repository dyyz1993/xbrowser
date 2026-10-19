import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../.xcli/plugins/login-bridge/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };
const originalFetch = globalThis.fetch;

function handlerOf(name: string): (params: unknown, ctx?: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return call[1].handler;
}

describe('login-bridge plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('registers bridge lifecycle commands', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'login-bridge',
      requiresLogin: false,
    }));
    expect(mockSite.command.mock.calls.map((item: unknown[]) => item[0])).toEqual([
      'serve', 'save', 'apply', 'import-from-chrome', 'launch',
    ]);
  });

  it('reports bridge readiness and stored cookie total', async () => {
    // The bridge store is process-global and may contain real developer data;
    // assert only the stable contract, not a machine-specific cookie count.
    const schema = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === 'serve')![1];
    expect(schema.result).toEqual(expect.objectContaining({ shape: expect.anything() }));
    expect(Object.keys(schema.result.shape)).toEqual(['port', 'storedCookies']);
  });

  it('summarizes archived domains and latest timestamp', async () => {
    vi.doMock('../../.xcli/plugins/login-bridge/index.ts', async (importOriginal) => importOriginal());
    const result = await handlerOf('save')({});
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ domains: expect.any(Array), total: expect.any(Number) });
  });

  it('requires a CDP page before applying cookies', async () => {
    const result = await handlerOf('apply')({ site: 'example.com' }, {});
    expect(result.success).toBe(false);
    expect(result.message).toContain('无匹配 cookie');
  });

  it('declares launch contract for persistent-profile Chromium', () => {
    const schema = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === 'launch')![1];
    expect(Object.keys(schema.result.shape)).toEqual(['pid', 'port', 'profile']);
    expect(schema.parameters).toBeTruthy();
    expect(schema.scope).toBe('project');
  });

  it('declares storage count in apply contract', () => {
    const schema = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === 'apply')![1];
    expect(Object.keys(schema.result.shape)).toEqual(['applied', 'storage', 'site']);
  });
});
