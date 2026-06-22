import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/gemini/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

function createMockPage(evaluateResult: unknown = '') {
  return {
    url: vi.fn(() => 'https://gemini.google.com/app'),
    goto: vi.fn(() => Promise.resolve()),
    waitForTimeout: vi.fn(() => Promise.resolve()),
    waitForLoadState: vi.fn(() => Promise.resolve()),
    evaluate: vi.fn(() => Promise.resolve(evaluateResult)),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(() => Promise.resolve()),
        fill: vi.fn(() => Promise.resolve()),
        count: vi.fn(() => Promise.resolve(0)),
        waitFor: vi.fn(() => Promise.resolve()),
      })),
      count: vi.fn(() => Promise.resolve(0)),
    })),
    keyboard: { type: vi.fn(() => Promise.resolve()), press: vi.fn(() => Promise.resolve()) },
    mouse: { wheel: vi.fn(() => Promise.resolve()), move: vi.fn() },
    close: vi.fn(),
    fill: vi.fn(() => Promise.resolve()),
  };
}

function createMockCtx(page?: ReturnType<typeof createMockPage>) {
  return {
    page,
    cdpEndpoint: 'http://localhost:9221',
    sessionId: 'test-session',
    storage: { set: vi.fn(), get: vi.fn(() => null), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() },
  };
}

const ALL_COMMANDS = ['list', 'open', 'chat', 'music', 'image', 'check-login', 'attach', 'storyboard'];

describe('gemini plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  // ─── 注册测试 ───
  it('should create site with name gemini', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'gemini' }));
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://gemini.google.com' }));
  });

  it('should create site with requiresLogin true', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ requiresLogin: true }));
  });

  it('should register 8 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(8);
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

    it('should throw when no page', async () => {
      const handler = getHandler('list');
      const ctx = createMockCtx(undefined);
      await expect(handler({}, ctx)).rejects.toThrow('需要浏览器页面');
    });

    it('should return conversations from evaluate', async () => {
      const handler = getHandler('list');
      const page = createMockPage('最近\nChat 1\nChat 2\nGemini\n笔记本\n');
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx) as Record<string, unknown>;
      expect(result.success).toBe(true);
      const data = result.data as unknown[];
      expect(Array.isArray(data)).toBe(true);
    });

    it('should return fail on evaluate error', async () => {
      const handler = getHandler('list');
      const page = createMockPage();
      page.evaluate = vi.fn(() => Promise.reject(new Error('evaluate failed')));
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── chat command ───
  describe('chat command', () => {
    it('should have page scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'chat');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('page');
    });

    it('should throw when no page', async () => {
      const handler = getHandler('chat');
      const ctx = createMockCtx(undefined);
      await expect(handler({ message: 'Hello' }, ctx)).rejects.toThrow('需要浏览器页面');
    });

    it('should return ok with conversationUrl', async () => {
      const handler = getHandler('chat');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ message: 'Hello' }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data).toHaveProperty('conversationUrl');
    });
  });

  // ─── music command ───
  describe('music command', () => {
    it('should have page scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'music');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('page');
    });

    it('should throw when no page', async () => {
      const handler = getHandler('music');
      const ctx = createMockCtx(undefined);
      await expect(handler({ prompt: 'piano' }, ctx)).rejects.toThrow('需要浏览器页面');
    });

    it('should return ok with url', async () => {
      const handler = getHandler('music');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ prompt: 'piano' }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data).toHaveProperty('url');
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
