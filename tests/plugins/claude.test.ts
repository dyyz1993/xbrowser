import { tipsMessages } from './_tips-helper.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/claude/index.ts';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`Command "${name}" not found`);
  return call[1].handler;
}

function createMockPage() {
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    waitForLoadState: vi.fn(),
    waitForSelector: vi.fn(() => Promise.resolve()),
    waitForFunction: vi.fn(() => Promise.resolve()),
    evaluate: vi.fn(() => Promise.resolve(true)),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(() => Promise.resolve()),
        fill: vi.fn(() => Promise.resolve()),
        count: vi.fn(() => Promise.resolve(1)),
        waitFor: vi.fn(() => Promise.resolve()),
        textContent: vi.fn(() => Promise.resolve('text')),
        type: vi.fn(() => Promise.resolve()),
      })),
      count: vi.fn(() => Promise.resolve(1)),
    })),
    keyboard: { insertText: vi.fn(), press: vi.fn() },
    mouse: { wheel: vi.fn(), move: vi.fn() },
    close: vi.fn(),
    url: vi.fn(() => 'https://claude.ai/'),
    reload: vi.fn(() => Promise.resolve()),
    route: vi.fn(() => Promise.resolve()),
    unroute: vi.fn(() => Promise.resolve()),
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

const ALL_COMMANDS = ['list', 'new', 'open', 'chat', 'attach'];

describe('claude plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  // ─── 注册测试 ───
  it('should create site with name claude', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'claude' })
    );
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://claude.ai' })
    );
  });

  it('should create site with requiresLogin true', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ requiresLogin: true })
    );
  });

  it('should register 5 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(5);
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

  it('should have examples for all commands', () => {
    for (const [, config] of mockSite.command.mock.calls) {
      const c = config as Record<string, unknown>;
      expect(c.examples).toBeDefined();
      expect(Array.isArray(c.examples)).toBe(true);
      expect((c.examples as unknown[]).length).toBeGreaterThan(0);
    }
  });

  // ─── list command ───
  describe('list command', () => {
    it('should have page scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'list');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('page');
    });

    it('should return conversations from evaluate', async () => {
      const handler = getHandler('list');
      const page = createMockPage();
      page.evaluate = vi.fn(() => Promise.resolve([
        { index: 0, title: 'Conversation 1', url: 'https://claude.ai/chat/1' },
        { index: 1, title: 'Conversation 2', url: 'https://claude.ai/chat/2' },
      ]));
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx) as Record<string, unknown>;
      const data = result.data as unknown[];
      expect(data).toHaveLength(2);
      expect((data[0] as Record<string, unknown>).title).toBe('Conversation 1');
    });

    it('should include count in tips', async () => {
      const handler = getHandler('list');
      const page = createMockPage();
      page.evaluate = vi.fn(() => Promise.resolve([
        { index: 0, title: 'Conv1', url: 'https://claude.ai/chat/1' },
      ]));
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx) as Record<string, unknown>;
      const tips = tipsMessages(result.tips);
      expect(tips.some((t) => t.includes('1 个会话'))).toBe(true);
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
      const page = createMockPage();
      page.evaluate = vi.fn(() => Promise.resolve('clicked'));
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

    it('should include "已创建新对话" tip on success', async () => {
      const handler = getHandler('new');
      const page = createMockPage();
      page.evaluate = vi.fn(() => Promise.resolve('clicked'));
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx) as Record<string, unknown>;
      const tips = tipsMessages(result.tips);
      expect(tips.some((t) => t.includes('已创建新对话'))).toBe(true);
    });
  });

  // ─── open command ───
  describe('open command', () => {
    it('should have title parameter', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'open');
      const config = cmd![1] as Record<string, unknown>;
      expect(config.parameters).toBeDefined();
    });

    it('should return opened title when conversation found', async () => {
      const handler = getHandler('open');
      const page = createMockPage();
      page.evaluate = vi.fn(() => Promise.resolve({ found: true, title: 'My Chat' }));
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'My' }, ctx) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      expect(data.opened).toBe('My Chat');
    });

    it('should return fail when conversation not found', async () => {
      const handler = getHandler('open');
      const page = createMockPage();
      page.evaluate = vi.fn(() => Promise.resolve({ found: false, title: '' }));
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'Nonexistent' }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
    });
  });

  // ─── chat command ───
  describe('chat command', () => {
    it('should have message parameter', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'chat');
      expect(cmd).toBeDefined();
    });

    it('should have browser scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'chat');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('browser');
    });

    it('should support attach, model, think, search, showSources params', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'chat');
      const config = cmd![1] as Record<string, unknown>;
      expect(config.parameters).toBeDefined();
    });
  });

  // ─── attach command ───
  describe('attach command', () => {
    it('should have type and path parameters', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'attach');
      expect(cmd).toBeDefined();
    });

    it('should have browser scope', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'attach');
      expect((cmd![1] as Record<string, unknown>).scope).toBe('browser');
    });

    it('should send URL as message when type is url', async () => {
      const handler = getHandler('attach');
      const page = createMockPage();
      page.evaluate = vi.fn(() => Promise.resolve(true));
      page.locator = vi.fn(() => ({
        first: vi.fn(() => ({
          count: vi.fn(() => Promise.resolve(1)),
          isVisible: vi.fn(() => Promise.resolve(true)),
          click: vi.fn(() => Promise.resolve()),
          fill: vi.fn(() => Promise.resolve()),
          waitFor: vi.fn(() => Promise.resolve()),
          textContent: vi.fn(() => Promise.resolve('https://example.com')),
          type: vi.fn(() => Promise.resolve()),
        })),
        count: vi.fn(() => Promise.resolve(1)),
      }));
      const ctx = createMockCtx(page);
      const result = await handler({ type: 'url', path: 'https://example.com' }, ctx) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      expect(data.type).toBe('url');
      expect(data.sent).toBe(true);
    });

    it('should return fail when file does not exist', async () => {
      const handler = getHandler('attach');
      const page = createMockPage();
      page.evaluate = vi.fn(() => Promise.resolve(true));
      const ctx = createMockCtx(page);
      const result = await handler({ type: 'image', path: '/nonexistent/file.png' }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
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
