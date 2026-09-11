import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/cnblogs/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (params: Record<string, unknown>, ctx: unknown) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`${name} not registered`);
  return (call[1] as { handler: (p: Record<string, unknown>, c: unknown) => Promise<unknown> }).handler;
}

describe('cnblogs plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
  });

  it('creates site cnblogs with requiresLogin', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'cnblogs',
      requiresLogin: true,
    }));
  });

  it('registers login/draft/publish', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0]);
    expect(names.sort()).toEqual(['draft', 'login', 'publish']);
  });

  it('draft fails when neither content nor file provided', async () => {
    const result = await getHandler('draft')({ title: 'T' }, {}) as { success: boolean };
    expect(result.success).toBe(false);
  });

  it('publish fails when neither content nor file provided', async () => {
    const result = await getHandler('publish')({ title: 'T' }, {}) as { success: boolean };
    expect(result.success).toBe(false);
  });

  it('login navigates to signin and reports state', async () => {
    const page = {
      goto: vi.fn(async () => undefined),
      url: vi.fn(() => 'https://i.cnblogs.com/posts'),
    };
    const ctx = { page, cdpEndpoint: 'x', waitForHuman: vi.fn(async () => ({ solved: true })) };
    const result = await getHandler('login')({}, ctx) as { success: boolean; data: { loggedIn: boolean } };
    expect(page.goto).toHaveBeenCalledWith('https://account.cnblogs.com/signin', expect.anything());
    expect(result.data.loggedIn).toBe(true);
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
