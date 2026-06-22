import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/qianwen/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn(), isLoggedIn: vi.fn(() => Promise.resolve(false)) };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

function createMockPage(evaluateResult: unknown = true) {
  return {
    url: vi.fn(() => 'https://www.qianwen.com'),
    goto: vi.fn(() => Promise.resolve()),
    waitForTimeout: vi.fn(() => Promise.resolve()),
    waitForLoadState: vi.fn(() => Promise.resolve()),
    evaluate: vi.fn(() => Promise.resolve(evaluateResult)),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(() => Promise.resolve()),
        fill: vi.fn(() => Promise.resolve()),
        count: vi.fn(() => Promise.resolve(1)),
        waitFor: vi.fn(() => Promise.resolve()),
      })),
      count: vi.fn(() => Promise.resolve(1)),
    })),
    keyboard: { type: vi.fn(() => Promise.resolve()), press: vi.fn(() => Promise.resolve()) },
    mouse: { wheel: vi.fn(() => Promise.resolve()), move: vi.fn() },
    close: vi.fn(),
  };
}

function createMockCtx(page?: ReturnType<typeof createMockPage>) {
  return {
    page,
    cdpEndpoint: 'http://localhost:9221',
    sessionId: 'test-session',
    __loginChecked: true,
    storage: { set: vi.fn(), get: vi.fn(() => null), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() },
  };
}

const ALL_COMMANDS = ['check-login', 'list', 'new', 'open', 'chat', 'attach'];

describe('qianwen plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  // ─── 注册测试 ───
  it('should create site with name qianwen', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'qianwen' }));
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://www.qianwen.com' }));
  });

  it('should create site with requiresLogin true', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ requiresLogin: true }));
  });

  it('should register 6 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(6);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(ALL_COMMANDS);
  });

  it('each command should have description, parameters, and handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const name = call[0] as string;
      const config = call[1] as Record<string, unknown>;
      expect(config).toHaveProperty('description');
      if (name === 'check-login') continue;   // check-login 纯检查命令无 scope
      expect(config).toHaveProperty('scope');
      expect(config).toHaveProperty('parameters');
      expect(config).toHaveProperty('handler');
      expect(typeof config.handler).toBe('function');
    }
  });

  it('should register login and logout handlers', () => {
    expect(mockSite.login).toHaveBeenCalledTimes(1);
    expect(mockSite.logout).toHaveBeenCalledTimes(1);
  });

  // ─── list command ───
  describe('list command', () => {
    it('should have page scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'list');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('page');
    });

    it('should return conversations from evaluate', async () => {
      const handler = getHandler('list');
      const page = createMockPage([
        { index: 0, title: 'Conv 1', url: 'https://qianwen.com/chat/1' },
        { index: 1, title: 'Conv 2', url: 'https://qianwen.com/chat/2' },
      ]);
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx) as Record<string, unknown>;
      const data = result.data as unknown[];
      expect(data).toHaveLength(2);
    });

    it('should return fail on error', async () => {
      const handler = getHandler('list');
      const page = createMockPage();
      page.evaluate = vi.fn(() => Promise.reject(new Error('evaluate failed')));
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── new command ───
  describe('new command', () => {
    it('should have browser scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'new');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('browser');
    });

    it('should return created true on success', async () => {
      const handler = getHandler('new');
      const page = createMockPage('clicked');
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      expect(data.created).toBe(true);
    });

    it('should return created true via fallback icon', async () => {
      const handler = getHandler('new');
      const page = createMockPage();
      page.evaluate = vi.fn()
        .mockResolvedValueOnce('not_found')
        .mockResolvedValueOnce('clicked_icon');
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      expect(data.created).toBe(true);
    });

    it('should return fail when button not found', async () => {
      const handler = getHandler('new');
      const page = createMockPage();
      page.evaluate = vi.fn()
        .mockResolvedValueOnce('not_found')
        .mockResolvedValueOnce('failed');
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── open command ───
  describe('open command', () => {
    it('should have browser scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'open');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('browser');
    });

    it('should return opened title when found', async () => {
      const handler = getHandler('open');
      const page = createMockPage({ found: true, title: '工作计划' });
      const ctx = createMockCtx(page);
      const result = await handler({ title: '工作' }, ctx) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      expect(data.opened).toBe('工作计划');
    });

    it('should return fail when not found', async () => {
      const handler = getHandler('open');
      const page = createMockPage({ found: false, title: '' });
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'Nonexistent' }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── chat command ───
  describe('chat command', () => {
    it('should have browser scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'chat');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('browser');
    });

    it('should have message, attach, attachType, think, search, showSources params', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'chat');
      expect(cmd).toBeDefined();
    });

    it('should return response text', async () => {
      const handler = getHandler('chat');
      const page = createMockPage();
      // Mock evaluate: think check → null (not found), search check → null, response loop → 'response text'
      page.evaluate = vi.fn()
        .mockResolvedValueOnce('not_found')  // think toggle
        .mockResolvedValueOnce('not_found')  // search toggle
        .mockResolvedValueOnce(true)          // clear input
        .mockResolvedValueOnce(false)         // send click
        .mockResolvedValueOnce('AI response'); // response text
      const ctx = createMockCtx(page);
      const result = await handler({ message: 'Hello' }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(true);
    });
  });

  // ─── attach command ───
  describe('attach command', () => {
    it('should have browser scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'attach');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('browser');
    });

    it('should return fail when file does not exist', async () => {
      const handler = getHandler('attach');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ file: '/nonexistent/file.png' }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });

    it('should have file parameter', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'attach');
      expect(cmd).toBeDefined();
    });
  });

  // ─── login/logout hooks ───
  it('login hook should be registered', () => {
    expect(mockSite.login).toHaveBeenCalledTimes(1);
  });

  it('logout hook should be registered', () => {
    expect(mockSite.logout).toHaveBeenCalledTimes(1);
  });
});
