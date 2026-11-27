import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/cnblogs/index.ts';
import { HumanWaitRequiredError } from '../../src/plugin/human-wait.js';

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

  describe('login command', () => {
    function createLoginPage(initialUrl = 'https://i.cnblogs.com/posts') {
      let currentUrl = initialUrl;
      const nextUrlOverrides = new Map<string, string>([
        ['https://i.cnblogs.com/posts', 'https://account.cnblogs.com/signin'],
      ]);
      return {
        goto: vi.fn(async (url: string) => {
          currentUrl = nextUrlOverrides.get(url) ?? url;
        }),
        waitForTimeout: vi.fn(async () => undefined),
        url: vi.fn(() => currentUrl),
      };
    }

    function createLoginCtx(
      page: ReturnType<typeof createLoginPage>,
      waitForHuman = vi.fn(async () => ({ solved: true })),
    ) {
      return { page, cdpEndpoint: 'x', waitForHuman, storage: { set: vi.fn() } };
    }

    it('resolves without handing off when already logged in', async () => {
      const page = createLoginPage();
      page.goto.mockImplementation(async () => undefined);
      const ctx = createLoginCtx(page);
      const result = await getHandler('login')({}, ctx) as {
        data: { loggedIn: boolean; url: string };
      };
      expect(result.data).toEqual({ loggedIn: true, url: 'https://i.cnblogs.com/posts' });
      expect(ctx.waitForHuman).not.toHaveBeenCalled();
      expect(page.goto).toHaveBeenCalledTimes(1);
      expect(page.goto).toHaveBeenCalledWith('https://i.cnblogs.com/posts', expect.anything());
      expect(ctx.storage.set).toHaveBeenCalledWith(
        'cnblogs_login',
        expect.objectContaining({ loggedIn: true })
      );
    });

    it('opens signin and rejects with NEEDS_HUMAN when logged out', async () => {
      const page = createLoginPage();
      const ctx = createLoginCtx(page, vi.fn(() =>
        Promise.reject(new HumanWaitRequiredError('需要人工协助', '完成博客园登录'))));
      await expect(getHandler('login')({}, ctx)).rejects.toBeInstanceOf(HumanWaitRequiredError);
      expect(page.goto.mock.calls.map((c: unknown[]) => c[0])).toEqual([
        'https://i.cnblogs.com/posts',
        'https://account.cnblogs.com/signin',
      ]);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('博客园') })
      );
      expect(ctx.storage.set).not.toHaveBeenCalled();
    });

    it('refuses login state when a returned handoff still shows signin', async () => {
      const page = createLoginPage();
      const ctx = createLoginCtx(page);
      await expect(getHandler('login')({}, ctx)).rejects.toThrow('仍未检测到登录态');
      expect(page.goto.mock.calls.map((c: unknown[]) => c[0])).toEqual([
        'https://i.cnblogs.com/posts',
        'https://account.cnblogs.com/signin',
        'https://i.cnblogs.com/posts',
      ]);
      expect(ctx.storage.set).not.toHaveBeenCalled();
    });
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
