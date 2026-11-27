import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod/v4';
import plugin from '../../.xcli/plugins/npm/index.ts';
import { HumanWaitRequiredError } from '../../src/plugin/human-wait.js';

// —— mock XCLIAPI（参考 devto.test.ts 的三件套）——
const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): Function {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1].handler;
}

function getCommandConfig(name: string): Record<string, unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1] as Record<string, unknown>;
}

// API 型测试：mock 全局 fetch
function mockFetchOnce(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    json: async () => payload,
    ok: true,
  })) as unknown as typeof fetch);
}

const ALL_COMMANDS = ['search', 'package', 'downloads', 'create-token', 'list-tokens', 'delete-token'];
const TOKEN_COMMANDS = ['create-token', 'list-tokens', 'delete-token'];

// ─── 令牌命令的 mock page 工厂（evaluate 按 arg 形状分发）───

interface MockPageState {
  currentUrl: string;
  loggedIn: boolean;
  visibleSelectors: string[];
  buttonPoints: Record<string, { x: number; y: number }>;
  tokenValue: string | null;
  tableRows: Array<{ name: string; type: string; created: string; expires: string | null; lastUsed: string | null }>;
  rowPoint: { name: string; point: { x: number; y: number } } | null;
  rowExists: boolean;
}

function createMockPage(overrides: Partial<MockPageState> = {}) {
  const state: MockPageState = {
    currentUrl: 'https://www.npmjs.com/login',
    loggedIn: false,
    visibleSelectors: ['#username', '#password', '#tokenName'],
    buttonPoints: { 'Sign in': { x: 100, y: 200 }, 'Create Token': { x: 300, y: 400 } },
    tokenValue: null,
    tableRows: [],
    rowPoint: null,
    rowExists: false,
    ...overrides,
  };
  const page = {
    url: vi.fn(() => state.currentUrl),
    goto: vi.fn(async () => ({})),
    fill: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    waitForLoadState: vi.fn(async () => {}),
    evaluate: vi.fn(async (fn: unknown, arg?: unknown) => {
      const src = typeof fn === 'function' ? fn.toString() : String(fn);
      if (Array.isArray(arg)) {
        // 选择器候选（本插件所有候选数组都含至少一个 '#id' 项）vs 按钮文本候选
        if ((arg as unknown[]).some((x) => typeof x === 'string' && (x as string).startsWith('#'))) {
          const hit = (arg as string[]).find((sel) => state.visibleSelectors.includes(sel));
          return hit ?? null;
        }
        for (const text of arg as string[]) {
          if (state.buttonPoints[text]) return state.buttonPoints[text];
        }
        return null;
      }
      if (typeof arg === 'string') {
        if (arg.includes('avatar')) return state.loggedIn; // checkLoggedIn 标记
        return state.rowExists; // tokenRowExists
      }
      if (arg && typeof arg === 'object' && 'target' in (arg as Record<string, unknown>)) {
        return state.rowPoint; // findTokenRowPoint
      }
      if (src.includes('npm_')) return state.tokenValue; // readTokenValue
      if (src.includes('thead')) return state.tableRows; // scrapeTokenTable
      return null;
    }),
    mouse: { click: vi.fn(async () => {}), move: vi.fn(async () => {}) },
    keyboard: { insertText: vi.fn(async () => {}), press: vi.fn(async () => {}) },
    locator: vi.fn(() => ({ selectOption: vi.fn(async () => ['30 days']) })),
    close: vi.fn(async () => {}),
  };
  return { page, state };
}

/**
 * 真实运行时 ctx.waitForHuman 抛 NEEDS_HUMAN（fail-closed）；单测里让它「返回」以走到复核分支，
 * 用 onWaitForHuman 模拟用户在这期间做了什么（比如登进去了）。
 */
function createMockCtx(page: unknown, options: { onWaitForHuman?: () => void } = {}) {
  return {
    page,
    storage: { set: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
    waitForHuman: vi.fn(async () => {
      options.onWaitForHuman?.();
    }),
  };
}

describe('npm plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ——— L1 注册 ———
  it('should create site with name npm', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'npm' })
    );
  });

  it('should create site with the npm registry url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://www.npmjs.com' })
    );
  });

  it('should register 6 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(6);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(ALL_COMMANDS);
  });

  it('each command should have description, scope, parameters, and handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const config = call[1] as Record<string, unknown>;
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('scope');
      expect(config).toHaveProperty('parameters');
      expect(config).toHaveProperty('handler');
      expect(typeof config.handler).toBe('function');
    }
  });

  it('each token command should declare result schema and examples (pre-commit gate)', () => {
    for (const name of TOKEN_COMMANDS) {
      const config = getCommandConfig(name);
      expect(config.result).toBeTruthy();
      expect(Array.isArray(config.examples)).toBe(true);
      expect((config.examples as unknown[]).length).toBeGreaterThan(0);
      expect(config.scope).toBe('page');
    }
  });

  it('every parameter of every command has a .describe() (pre-flight questionnaire)', () => {
    for (const call of mockSite.command.mock.calls) {
      const name = call[0] as string;
      const config = call[1] as { parameters: z.ZodObject<z.ZodRawShape> };
      const shape = config.parameters.shape;
      for (const [key, field] of Object.entries(shape)) {
        const desc = (field as z.ZodType).description ?? '';
        expect(desc, `${name}.${key} 缺少中文 .describe()`).toMatch(/[\u4e00-\u9fff]/);
      }
    }
  });

  it('should register login/logout hooks', () => {
    expect(mockSite.login).toHaveBeenCalled();
    expect(mockSite.logout).toHaveBeenCalled();
  });

  // ——— L3 关键路径：search ———
  describe('search command', () => {
    it('should fetch the npm registry search endpoint', async () => {
      mockFetchOnce({ objects: [] });
      const handler = getHandler('search');
      await handler({ query: 'react', limit: 20 }, {});
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('registry.npmjs.org/-/v1/search'),
        expect.anything() // fetchJson init: { signal: AbortSignal.timeout(...) }
      );
      expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(
        encodeURIComponent('react')
      );
    });

    it('should map results to rank/name/version shape', async () => {
      mockFetchOnce({
        objects: [
          {
            package: { name: 'react', version: '18.0.0', description: 'UI lib' },
            downloads: { weekly: 100 },
          },
        ],
      });
      const result = await getHandler('search')({ query: 'react', limit: 20 }, {});
      expect(result.data[0]).toMatchObject({
        rank: 1,
        name: 'react',
        version: '18.0.0',
        description: 'UI lib',
        weeklyDownloads: 100,
      });
    });

    it('should fail when no results', async () => {
      mockFetchOnce({ objects: [] });
      const result = await getHandler('search')({ query: 'xxx', limit: 20 }, {});
      expect(result.success).toBe(false);
    });
  });

  // ——— L3 关键路径：package ———
  describe('package command', () => {
    it('should fetch registry + downloads endpoints', async () => {
      let calls = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string) => {
          calls++;
          const payload =
            calls === 1
              ? {
                  name: 'react',
                  'dist-tags': { latest: '18.0.0' },
                  versions: { '18.0.0': { license: 'MIT' } },
                  description: 'UI lib',
                  keywords: ['react'],
                  readme: 'r',
                  maintainers: [{ name: 'gaearon' }],
                }
              : { downloads: 5000 };
          return { json: async () => payload, ok: true } as Response;
        }) as unknown as typeof fetch
      );
      const result = await getHandler('package')({ name: 'react' }, {});
      expect(result.data).toMatchObject({
        name: 'react',
        version: '18.0.0',
        monthlyDownloads: 5000,
      });
    });

    it('should fail when package not found', async () => {
      mockFetchOnce({ error: 'Not found' });
      const result = await getHandler('package')({ name: 'nope' }, {});
      expect(result.success).toBe(false);
    });
  });

  // ——— L3 关键路径：downloads ———
  describe('downloads command', () => {
    it('should reject invalid period', async () => {
      const result = await getHandler('downloads')(
        { name: 'react', period: 'invalid' },
        {}
      );
      expect(result.success).toBe(false);
    });

    it('should return download stats for valid period', async () => {
      mockFetchOnce({
        package: 'react',
        downloads: 999,
        startDate: '2026-05-27',
        endDate: '2026-06-27',
      });
      const result = await getHandler('downloads')(
        { name: 'react', period: 'last-month' },
        {}
      );
      expect(result.data.downloads).toBe(999);
      expect(result.data.package).toBe('react');
    });
  });

  // ——— L3 关键路径：create-token ———
  describe('create-token command', () => {
    const baseParams = { username: 'myuser', password: 'secret', tokenName: 'ci-publish' };

    it('should fail when no browser page is present', async () => {
      const result = await getHandler('create-token')(baseParams, createMockCtx(undefined));
      expect(result.success).toBe(false);
      expect(result.message).toContain('chrome-bridge');
    });

    it('should reject expiryDays=custom without customExpiryDays', async () => {
      const { page } = createMockPage();
      const result = await getHandler('create-token')(
        { ...baseParams, expiryDays: 'custom' },
        createMockCtx(page)
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain('customExpiryDays');
    });

    it('should login with credentials + param OTP, then create and extract the one-time token', async () => {
      const { page } = createMockPage({
        visibleSelectors: ['#username', '#password', '#otp', '#tokenName', '#expiration'],
        tokenValue: 'npm_AbCdEfGh1234567890XYZ',
      });
      const ctx = createMockCtx(page);
      const result = await getHandler('create-token')({ ...baseParams, otp: '123456', expiryDays: '30' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.token).toBe('npm_AbCdEfGh1234567890XYZ');
      expect(result.data.name).toBe('ci-publish');
      expect(typeof result.data.createdAt).toBe('string');

      // 登录导航 + 建令牌页导航
      const urls = page.goto.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(urls).toContain('https://www.npmjs.com/login');
      expect(urls).toContain('https://www.npmjs.com/settings/myuser/tokens/granular-access-tokens/new');

      // trusted fill：账密 + OTP + 令牌名
      const fills = page.fill.mock.calls.map((c: unknown[]) => c as [string, string]);
      expect(fills).toContainEqual(['#username', 'myuser']);
      expect(fills).toContainEqual(['#password', 'secret']);
      expect(fills).toContainEqual(['#otp', '123456']);
      expect(fills).toContainEqual(['#tokenName', 'ci-publish']);

      // 关键 UI 用真实鼠标（Sign in + Create Token），共两次 mouse.click
      expect(page.mouse.click).toHaveBeenCalledTimes(2);
      // --otp 直传时不应触发 waitForHuman
      expect(ctx.waitForHuman).not.toHaveBeenCalled();
      // 登录态写入 storage
      expect(ctx.storage.set).toHaveBeenCalledWith('npm_login', expect.objectContaining({ username: 'myuser' }));
    });

    it('should pause via waitForHuman for email OTP when --otp is absent', async () => {
      const { page, state } = createMockPage({
        visibleSelectors: ['#username', '#password', '#otp', '#tokenName'],
        tokenValue: 'npm_ZZZZZZZZZZZZZZZZZZZZ',
      });
      const ctx = createMockCtx(page, {
        onWaitForHuman: () => {
          // 用户在 viewer 里输入 OTP 后已登录
          state.loggedIn = true;
          state.currentUrl = 'https://www.npmjs.com/';
        },
      });
      const result = await getHandler('create-token')(baseParams, ctx);

      expect(result.success).toBe(true);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringMatching(/OTP|验证码/) })
      );
    });

    it('should fail when the session is still logged out after the OTP handoff', async () => {
      const { page } = createMockPage({
        visibleSelectors: ['#username', '#password', '#otp'],
      });
      const ctx = createMockCtx(page);
      const result = await getHandler('create-token')(baseParams, ctx);

      expect(result.success).toBe(false);
      expect(result.message).toContain('OTP');
    });

    it('stops with NEEDS_HUMAN instead of faking success when the OTP handoff fails closed', async () => {
      const { page } = createMockPage({
        visibleSelectors: ['#username', '#password', '#otp'],
      });
      const ctx = createMockCtx(page);
      ctx.waitForHuman = vi.fn(async () => {
        throw new HumanWaitRequiredError('需要人工协助', 'npm 已向账号邮箱发送一次性验证码（OTP）');
      });

      await expect(getHandler('create-token')(baseParams, ctx)).rejects.toBeInstanceOf(HumanWaitRequiredError);
      expect(ctx.storage.set).not.toHaveBeenCalled();
    });

    it('should fail with clear pointers when token-name input is not found', async () => {
      const { page } = createMockPage({
        visibleSelectors: ['#username', '#password', '#otp'], // 登录可完成，但建令牌页无 #tokenName
      });
      const result = await getHandler('create-token')(
        { ...baseParams, otp: '123456' },
        createMockCtx(page)
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain('令牌名称');
    });
  });

  // ——— L3 关键路径：list-tokens ———
  describe('list-tokens command', () => {
    it('should fail when no browser page is present', async () => {
      const result = await getHandler('list-tokens')({ username: 'myuser' }, createMockCtx(undefined));
      expect(result.success).toBe(false);
      expect(result.message).toContain('chrome-bridge');
    });

    it('should scrape and return token table rows', async () => {
      const { page } = createMockPage({
        currentUrl: 'https://www.npmjs.com/settings/myuser/tokens',
        loggedIn: true,
        tableRows: [
          { name: 'xbrowser-ci', type: 'Granular', created: '2026-11-01', expires: '2026-12-01', lastUsed: '2026-11-20' },
          { name: 'legacy', type: 'Classic', created: '2025-01-01', expires: null, lastUsed: null },
        ],
      });
      const ctx = createMockCtx(page);
      const result = await getHandler('list-tokens')({ username: 'myuser' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.count).toBe(2);
      expect(result.data.tokens[0]).toMatchObject({ name: 'xbrowser-ci', type: 'Granular' });
      expect(result.data.tokens[1].expires).toBeNull();
      expect(page.goto).toHaveBeenCalledWith(
        'https://www.npmjs.com/settings/myuser/tokens',
        expect.anything()
      );
    });

    it('should fail when not logged in', async () => {
      const { page } = createMockPage({ currentUrl: 'https://www.npmjs.com/settings/myuser/tokens', loggedIn: false });
      const result = await getHandler('list-tokens')({ username: 'myuser' }, createMockCtx(page));
      expect(result.success).toBe(false);
      expect(result.message).toContain('登录态');
    });

    it('should fail when the token table is missing/empty', async () => {
      const { page } = createMockPage({ currentUrl: 'https://www.npmjs.com/settings/myuser/tokens', loggedIn: true, tableRows: [] });
      const result = await getHandler('list-tokens')({ username: 'myuser' }, createMockCtx(page));
      expect(result.success).toBe(false);
      expect(result.message).toContain('令牌表格');
    });
  });

  // ——— L3 关键路径：delete-token ———
  describe('delete-token command', () => {
    it('should fail when no browser page is present', async () => {
      const result = await getHandler('delete-token')({ username: 'myuser', name: 'x' }, createMockCtx(undefined));
      expect(result.success).toBe(false);
      expect(result.message).toContain('chrome-bridge');
    });

    it('should require --name or --id', async () => {
      const { page } = createMockPage();
      const result = await getHandler('delete-token')({ username: 'myuser' }, createMockCtx(page));
      expect(result.success).toBe(false);
      expect(result.message).toContain('--name');
    });

    it('should revoke via trusted clicks, confirm dialog, and verify row removal', async () => {
      const { page } = createMockPage({
        currentUrl: 'https://www.npmjs.com/settings/myuser/tokens',
        loggedIn: true,
        rowPoint: { name: 'xbrowser-ci', point: { x: 700, y: 80 } },
        buttonPoints: { 'Delete Token': { x: 500, y: 300 } },
        rowExists: false, // 轮询时行已消失
      });
      const ctx = createMockCtx(page);
      const result = await getHandler('delete-token')({ username: 'myuser', name: 'xbrowser-ci' }, ctx);

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ deleted: true, name: 'xbrowser-ci', verified: true });
      // revoke 按钮 + 确认弹窗 = 两次真实鼠标点击
      expect(page.mouse.click).toHaveBeenCalledTimes(2);
      expect(page.mouse.click).toHaveBeenCalledWith(700, 80);
      expect(page.mouse.click).toHaveBeenCalledWith(500, 300);
    });

    it('should fail when the target token row is not found', async () => {
      const { page } = createMockPage({
        currentUrl: 'https://www.npmjs.com/settings/myuser/tokens',
        loggedIn: true,
        rowPoint: null,
      });
      const result = await getHandler('delete-token')({ username: 'myuser', name: 'nope' }, createMockCtx(page));
      expect(result.success).toBe(false);
      expect(result.message).toContain('nope');
    });

    it('should report unverified when the row never disappears', async () => {
      const { page } = createMockPage({
        currentUrl: 'https://www.npmjs.com/settings/myuser/tokens',
        loggedIn: true,
        rowPoint: { name: 'xbrowser-ci', point: { x: 700, y: 80 } },
        rowExists: true, // 行一直在
      });
      const result = await getHandler('delete-token')({ username: 'myuser', name: 'xbrowser-ci' }, createMockCtx(page));
      expect(result.success).toBe(true);
      expect(result.data.verified).toBe(false);
      expect(result.data.deleted).toBe(true);
    });
  });
});
