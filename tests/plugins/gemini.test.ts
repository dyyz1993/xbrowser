import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/gemini/index.ts';
import { imageCommandHandler, setImageHelpers } from '../../.xcli/plugins/gemini/image.ts';
import { parseUsageText, usageCommandHandler } from '../../.xcli/plugins/gemini/usage.ts';

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

const ALL_COMMANDS = [
  'list', 'chat', 'image', 'usage', 'music',
  'task-open', 'task-close', 'task-list',
  'generate-image', 'generate-video',
  'history-list', 'history-download-video',
];

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

  it('should register all commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(ALL_COMMANDS.length);
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

  // ─── image command ───
  describe('image command', () => {
    it('should have page scope and required login', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'image');
      const config = cmd![1] as Record<string, unknown>;
      expect(config.scope).toBe('page');
      expect(config.loginRequired).toBe('required');
    });

    it('should throw when no page', async () => {
      await expect(imageCommandHandler({ prompt: 'cat', timeout: 15 }, createMockCtx(undefined) as never))
        .rejects.toThrow('需要浏览器页面');
    });

    it('activates image mode, submits prompt, and downloads new images', async () => {
      const page = createMockPage(['https://old.example/avatar.png']);
      page.url = vi.fn(() => 'https://gemini.google.com/app');
      setImageHelpers({
        clickImageMode: vi.fn(() => Promise.resolve(true)),
        typePrompt: vi.fn(() => Promise.resolve()),
        submitPrompt: vi.fn(() => Promise.resolve()),
        collectNewImages: vi.fn(() => Promise.resolve(['https://new.example/generated.png'])),
        downloadImages: vi.fn(() => Promise.resolve(['/tmp/generated.png'])),
      });

      const result = await imageCommandHandler(
        { prompt: 'watercolor cat', timeout: 15, ratio: '16:9' },
        createMockCtx(page) as never,
      ) as unknown as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        prompt: 'watercolor cat',
        count: 1,
        localPaths: ['/tmp/generated.png'],
      });
      expect(page.goto).not.toHaveBeenCalled();
    });

    it('returns fail when no generated image appears', async () => {
      const page = createMockPage([]);
      page.url = vi.fn(() => 'https://gemini.google.com/app');
      setImageHelpers({
        clickImageMode: vi.fn(() => Promise.resolve(false)),
        typePrompt: vi.fn(() => Promise.resolve()),
        submitPrompt: vi.fn(() => Promise.resolve()),
        collectNewImages: vi.fn(() => Promise.resolve([])),
        downloadImages: vi.fn(() => Promise.resolve([])),
      });

      const result = await imageCommandHandler({ prompt: 'cat', timeout: 15 }, createMockCtx(page) as never) as unknown as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(result.message).toBe('未检测到生成图片');
    });
  });

  // ─── music command ───
  describe('usage command', () => {
    it('should have page scope and required login', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'usage');
      const config = cmd![1] as Record<string, unknown>;
      expect(config.scope).toBe('page');
      expect(config.loginRequired).toBe('required');
    });

    it('should throw when no page', async () => {
      await expect(usageCommandHandler({}, createMockCtx(undefined) as never))
        .rejects.toThrow('需要浏览器页面');
    });

    it('parses current and weekly usage with reset times', () => {
      const text = [
        'Gemini',
        '用量限额 PRO',
        '更新时间：1 分钟前',
        '当前用量',
        '已使用 1%',
        '重置时间：23:34',
        '每周限额',
        '重置时间：10月20日05:34',
        '已使用 0%',
      ].join('\n');
      const parsed = parseUsageText(text, 'https://gemini.google.com/usage');
      expect(parsed.plan).toBe('PRO');
      expect(parsed.current).toEqual({ usedPercent: 1, resetAt: '23:34' });
      expect(parsed.weekly).toEqual({ usedPercent: 0, resetAt: '10月20日05:34' });
      expect(parsed.updatedAt).toBe('1 分钟前');
    });

    it('reuses the usage tab and returns parsed data', async () => {
      const usageText = [
        '用量限额 PRO',
        '当前用量',
        '已使用 2%',
        '重置时间：23:34',
        '每周限额',
        '重置时间：10月20日05:34',
        '已使用 1%',
      ].join('\n');
      const page = createMockPage(usageText);
      page.url = vi.fn(() => 'https://gemini.google.com/usage');
      const result = await usageCommandHandler({}, createMockCtx(page) as never) as unknown as Record<string, unknown>;
      expect(result.success).toBe(true);
      const data = result.data as Record<string, any>;
      expect(data.current.usedPercent).toBe(2);
      expect(data.weekly.usedPercent).toBe(1);
      expect(data.sourceUrl).toContain('/usage');
      expect(page.goto).not.toHaveBeenCalled();
    });
  });

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
