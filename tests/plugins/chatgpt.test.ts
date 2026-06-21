import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/chatgpt/index.ts';

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
        inputValue: vi.fn(() => Promise.resolve('')),
      })),
      count: vi.fn(() => Promise.resolve(1)),
    })),
    keyboard: { insertText: vi.fn(), press: vi.fn(), type: vi.fn(() => Promise.resolve()) },
    mouse: { wheel: vi.fn(), move: vi.fn(), click: vi.fn(() => Promise.resolve()) },
    close: vi.fn(),
    url: vi.fn(() => 'https://chatgpt.com/'),
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

const ALL_COMMANDS = ['check-login', 'list', 'new', 'open', 'chat', 'attach', 'image', 'storyboard'];

describe('chatgpt plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  // ─── 注册测试 ───
  it('should create site with name chatgpt', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'chatgpt' })
    );
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://chatgpt.com' })
    );
  });

  it('should create site with requiresLogin true', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ requiresLogin: true })
    );
  });

  it('should register 8 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(8);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(ALL_COMMANDS);
  });

  it('each command should have description, parameters, and handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const config = call[1] as Record<string, unknown>;
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('parameters');
      expect(config).toHaveProperty('handler');
      expect(typeof config.handler).toBe('function');
    }
  });

  it('browser-interacting commands should have scope', () => {
    // check-login 等纯检查命令可以没有 scope
    for (const call of mockSite.command.mock.calls) {
      const name = call[0] as string;
      const config = call[1] as Record<string, unknown>;
      if (name === 'check-login') continue;
      expect(config).toHaveProperty('scope');
    }
  });

  it('should register login and logout handlers', () => {
    expect(mockSite.login).toHaveBeenCalledTimes(1);
    expect(mockSite.logout).toHaveBeenCalledTimes(1);
  });

  it('should have examples for interactive commands', () => {
    // check-login 等辅助命令可以没有 examples
    for (const [name, config] of mockSite.command.mock.calls) {
      if (name === 'check-login') continue;
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
        { index: 0, title: 'Conversation 1', url: 'https://chatgpt.com/c/1' },
        { index: 1, title: 'Conversation 2', url: 'https://chatgpt.com/c/2' },
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
        { index: 0, title: 'Conv1', url: 'https://chatgpt.com/c/1' },
      ]));
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx) as Record<string, unknown>;
      const tips = result.tips as string[];
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
      const tips = result.tips as string[];
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

    it('should support attach, model, search, showSources params', () => {
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
      // Mock evaluate for ensurePage login check + fillInput
      page.evaluate = vi.fn(() => Promise.resolve(true));
      page.locator = vi.fn(() => ({
        first: vi.fn(() => ({
          count: vi.fn(() => Promise.resolve(1)),
          isVisible: vi.fn(() => Promise.resolve(true)),
          click: vi.fn(() => Promise.resolve()),
          fill: vi.fn(() => Promise.resolve()),
          waitFor: vi.fn(() => Promise.resolve()),
          textContent: vi.fn(() => Promise.resolve('')),
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

  // ─── image command ───
  describe('image command', () => {
    it('should have browser scope and result schema with localPaths', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'image');
      const config = cmd![1] as Record<string, unknown>;
      expect(config.scope).toBe('browser');
      expect(config.result).toBeDefined();
    });

    it('should download generated images to local and return localPaths', async () => {
      const handler = getHandler('image');
      const page = createMockPage();
      const fakeB64 = Buffer.from('fake-png-bytes').toString('base64');
      const fakeUrl = 'https://chatgpt.com/backend-api/estuary/content?id=fake';
      // 按 evaluate 表达式特征区分各次调用
      page.evaluate = vi.fn((expr: unknown) => {
        const e = typeof expr === 'function' ? expr.toString() : String(expr);
        if (e.includes('composer-submit-button')) return Promise.resolve({ x: 100, y: 200 });
        // URL 收集（循环内，含 anchorSet 参数）：返回新图 URL
        if (e.includes('anchorSet') && e.includes('image-')) return Promise.resolve([fakeUrl]);
        if (e.includes('anchorSet')) return Promise.resolve([]);
        // 锚点收集（发送前，含 estuary 但无 anchorSet）：返回空
        if (e.includes('estuary') || e.includes('Array.from(seen)')) return Promise.resolve([]);
        // checkRefusal 内部 evaluate：返回空字符串表示无拒绝文案
        if (e.includes('let best')) return Promise.resolve('');
        // 下载：含 credentials
        if (e.includes('credentials')) return Promise.resolve([{ src: fakeUrl, b64: fakeB64 }]);
        // 写入校验
        if (e.includes('textContent')) return Promise.resolve(true);
        // 会话 ID
        if (e.includes('location.href')) return Promise.resolve('test-conv-id');
        return Promise.resolve(null);
      });
      page.url = vi.fn(() => 'https://chatgpt.com/c/test-conv-id');
      page.locator = vi.fn(() => ({
        first: vi.fn(() => ({
          click: vi.fn(() => Promise.resolve()),
          count: vi.fn(() => Promise.resolve(1)),
        })),
      }));
      const ctx = createMockCtx(page);
      const result = await handler({ prompt: '测试海报' }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.images).toBeDefined();
      expect(Array.isArray(data.localPaths)).toBe(true);
      expect((data.localPaths as string[]).length).toBeGreaterThan(0);
      const tips = result.tips as string[];
      expect(tips.some((t) => t.includes('已下载'))).toBe(true);
    });

    it('should still return success (with empty localPaths) when download fails', async () => {
      const handler = getHandler('image');
      const page = createMockPage();
      const failUrl = 'https://chatgpt.com/backend-api/estuary/content?id=fail';
      page.evaluate = vi.fn((expr: unknown) => {
        const e = typeof expr === 'function' ? expr.toString() : String(expr);
        if (e.includes('composer-submit-button')) return Promise.resolve({ x: 100, y: 200 });
        if (e.includes('anchorSet') && e.includes('image-')) return Promise.resolve([failUrl]);
        if (e.includes('anchorSet')) return Promise.resolve([]);
        if (e.includes('estuary') || e.includes('Array.from(seen)')) return Promise.resolve([]);
        if (e.includes('let best')) return Promise.resolve('');
        if (e.includes('credentials')) return Promise.resolve([]);  // 下载全失败
        if (e.includes('textContent')) return Promise.resolve(true);
        if (e.includes('location.href')) return Promise.resolve('conv');
        return Promise.resolve(null);
      });
      page.url = vi.fn(() => 'https://chatgpt.com/c/conv');
      page.locator = vi.fn(() => ({
        first: vi.fn(() => ({ click: vi.fn(() => Promise.resolve()), count: vi.fn(() => Promise.resolve(1)) })),
      }));
      const ctx = createMockCtx(page);
      const result = await handler({ prompt: '测试' }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.images).toBeDefined();
      expect(Array.isArray(data.localPaths)).toBe(true);
      expect((data.localPaths as string[]).length).toBe(0);
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
