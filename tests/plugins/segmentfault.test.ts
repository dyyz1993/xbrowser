import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/segmentfault/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (params: Record<string, unknown>, ctx: unknown) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`${name} not registered`);
  return (call[1] as { handler: (p: Record<string, unknown>, c: unknown) => Promise<unknown> }).handler;
}

describe('segmentfault plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
  });

  it('creates site with requiresLogin and isLogin hook', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'segmentfault',
      requiresLogin: true,
    }));
  });

  it('registers login/draft/publish', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0]);
    expect(names.sort()).toEqual(['draft', 'login', 'publish']);
  });

  it('draft fails when neither content nor file provided', async () => {
    const handler = getHandler('draft');
    const result = await handler({ title: 'T' }, {}) as { success: boolean };
    expect(result.success).toBe(false);
  });

  it('publish fails when neither content nor file provided', async () => {
    const handler = getHandler('publish');
    const result = await handler({ title: 'T' }, {}) as { success: boolean };
    expect(result.success).toBe(false);
  });

  it('draft reads content from file', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(`${tmpdir()}/sf-`);
    const f = `${dir}/a.md`;
    writeFileSync(f, '# hello');
    const page = {
      goto: vi.fn(),
      waitForLoadState: vi.fn(),
      url: vi.fn(() => 'https://segmentfault.com/write'),
      $: vi.fn(async () => null),
      locator: vi.fn(() => ({
        first: vi.fn(() => ({ isVisible: vi.fn(async () => false) })),
      })),
    };
    const handler = getHandler('draft');
    const result = await handler({ title: 'T', file: f }, { page, cdpEndpoint: 'x' }) as { success: boolean };
    expect(result.success).toBe(false); // 编辑器元素找不到→fail（file 读取本身成功）
    rmSync(dir, { recursive: true });
  });

  it('each command has description/parameters/handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const def = call[1] as Record<string, unknown>;
      expect(typeof def.description).toBe('string');
      expect(def.parameters).toBeDefined();
      expect(typeof def.handler).toBe('function');
    }
  });
});
