import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/gemini/index.ts';
import { parseUsageText, usageCommandHandler } from '../../.xcli/plugins/gemini/usage.ts';
import { musicCommandHandler, musicStatusHandler, setMusicDownloader, setMusicRuntime } from '../../.xcli/plugins/gemini/music.ts';
import { setGenerateRuntime, uploadAttachments } from '../../.xcli/plugins/gemini/generate.ts';

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
  'list', 'chat', 'usage',
  'task-open', 'task-close', 'task-list',
  'generate-image', 'generate-video',
  'history-list', 'history-download-video',
  'download-video',
  'music', 'music-status',
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

  describe('download-video command', () => {
    it('should have project scope and a session URL parameter', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'download-video');
      const config = cmd![1] as Record<string, unknown>;
      expect(config.scope).toBe('project');
      expect(JSON.stringify(config.parameters)).toContain('url');
    });
  });

  describe('music command', () => {
    const sampleAudioBase64 = Buffer.alloc(10_000, 7).toString('base64');
    const readyState = {
      href: 'https://gemini.google.com/app/sea',
      text: 'Music ready',
      editor: 'sea prompt',
      musicSelected: true,
      toolsOpen: false,
      audio: [{ src: 'https://example.com/song.mp4', duration: 62 }],
    };

    function createRuntime(state: unknown, options: { failOpen?: boolean } = {}) {
      setMusicDownloader((localPath) => localPath);
      const taskClose = vi.fn((_command?: string) => Promise.resolve({ ok: true }));
      setMusicRuntime({
        bridgeExec: vi.fn((command: string) => {
          if (command === 'task-open') {
            if (options.failOpen) return Promise.resolve({ ok: false, error: 'down' });
            return Promise.resolve({ ok: true, data: { tabId: 42 } });
          }
          return taskClose(command);
        }) as never,
        cdp: vi.fn(() => Promise.resolve(undefined)) as never,
        ev: vi.fn((expression: string) => {
          if (expression.includes('fetch(')) return Promise.resolve(sampleAudioBase64);
          if (expression.includes('musicSelected')) return Promise.resolve(JSON.stringify(state));
          if (expression.includes('上传和工具') || expression.includes('制作音乐') || expression.includes('发送')) {
            return Promise.resolve('true');
          }
          return Promise.resolve('null');
        }) as never,
        sleep: vi.fn(() => Promise.resolve()),
      });
      return { taskClose };
    }

    afterEach(() => {
      setMusicDownloader(undefined as never);
      setMusicRuntime({ bridgeExec: vi.fn(), cdp: vi.fn(), ev: vi.fn(), sleep: vi.fn() });
    });

    it('registers project commands for synchronous and asynchronous music generation', () => {
      const music = mockSite.command.mock.calls.find((call: unknown[]) => call[0] === 'music');
      const status = mockSite.command.mock.calls.find((call: unknown[]) => call[0] === 'music-status');
      expect((music![1] as Record<string, unknown>).scope).toBe('project');
      expect((status![1] as Record<string, unknown>).scope).toBe('project');
    });

    it('returns chrome-bridge failure without opening a page', async () => {
      createRuntime(readyState, { failOpen: true });
      const result = await musicCommandHandler({ prompt: 'sea', timeout: 1, wait: true, taskId: 'music-no-bridge' } as never) as unknown as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(result.message).toBe('chrome-bridge 未启动');
    });

    it('switches to music mode, waits for completion, and downloads the track', async () => {
      const { taskClose } = createRuntime(readyState);
      const result = await musicCommandHandler({
        prompt: 'sea prompt', timeout: 1, wait: true, taskId: 'music-test',
      }) as unknown as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        taskId: 'music-test',
        site: 'gemini',
        kind: 'audio',
        status: 'completed',
        download: { ok: true, taskId: 'music-test' },
      });
      expect((result.data as { artifacts: Array<Record<string, unknown>> }).artifacts[0]).toMatchObject({
        taskId: 'music-test',
        status: 'completed',
        mediaUrl: 'https://example.com/song.mp4',
        sizeBytes: expect.any(Number),
      });
      expect((result.data as { localPath: string }).localPath).toContain('gemini_music_music-test.mp4');
      expect(taskClose).toHaveBeenCalledWith('task-close');
    });

    it('reports the downloaded byte size without re-reading the artifact', async () => {
      const written: string[] = [];
      createRuntime(readyState);
      setMusicDownloader((localPath, bytes) => {
        written.push(localPath);
        expect(bytes.length).toBeGreaterThan(0);
        return `/tmp/verified-${bytes.length}.mp4`;
      });
      const result = await musicCommandHandler({
        prompt: 'sea prompt', timeout: 1, wait: true, taskId: 'music-size',
      }) as unknown as Record<string, unknown>;

      expect(written).toHaveLength(1);
      expect((result.data as { localPath: string }).localPath).toBe('/tmp/verified-10000.mp4');
      expect((result.data as { artifacts: Array<{ sizeBytes: number }> }).artifacts[0].sizeBytes)
        .toBe(10_000);
    });

    it('keeps concurrent task state isolated by task id', async () => {
      const calls: Array<{ command: string; payload?: unknown }> = [];
      setMusicRuntime({
        bridgeExec: vi.fn((command: string, payload?: unknown) => {
          calls.push({ command, payload });
          if (command === 'task-open') {
            return Promise.resolve({ ok: true, data: { tabId: (payload as { name: string }).name.length } });
          }
          return Promise.resolve({ ok: true });
        }) as never,
        cdp: vi.fn(() => Promise.resolve(undefined)) as never,
        ev: vi.fn((expression: string, tabId: number) => {
          if (expression.includes('fetch(')) return Promise.resolve(sampleAudioBase64);
          if (expression.includes('musicSelected')) {
            const expectedPrompt = tabId === 3 ? 'first' : 'second';
            return Promise.resolve(JSON.stringify({
              ...readyState,
              editor: expectedPrompt,
            }));
          }
          if (expression.includes('上传和工具') || expression.includes('制作音乐') || expression.includes('发送')) {
            return Promise.resolve('true');
          }
          return Promise.resolve('null');
        }) as never,
        sleep: vi.fn(() => Promise.resolve()),
      });

      const [first, second] = await Promise.all([
        musicCommandHandler({ prompt: 'first', timeout: 1, wait: false, taskId: 'one' }) as unknown as Record<string, unknown>,
        musicCommandHandler({ prompt: 'second', timeout: 1, wait: false, taskId: 'two-two' }) as unknown as Record<string, unknown>,
      ]);

      expect(first.success, JSON.stringify(first)).toBe(true);
      expect(second.success, JSON.stringify(second)).toBe(true);
      expect((first.data as { taskId: string }).taskId).toBe('one');
      expect((second.data as { taskId: string }).taskId).toBe('two-two');
      expect(calls.filter((call) => call.command === 'task-open').map((call) => call.payload))
        .toEqual(expect.arrayContaining([
          { name: 'one', url: 'https://gemini.google.com/app' },
          { name: 'two-two', url: 'https://gemini.google.com/app' },
        ]));
    });

    it('supports asynchronous submission and keeps the task alive', async () => {
      const { taskClose } = createRuntime(readyState);
      const result = await musicCommandHandler({
        prompt: 'sea prompt', timeout: 1, wait: false, taskId: 'music-async',
      }) as unknown as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        taskId: 'music-async',
        site: 'gemini',
        kind: 'audio',
        status: 'submitted',
        artifacts: [],
        download: { ok: false, taskId: 'music-async' },
      });
      expect(taskClose).not.toHaveBeenCalled();
    });

    it('downloads an asynchronous track through music-status', async () => {
      createRuntime(readyState);
      const result = await musicStatusHandler({ taskId: 'music-async', timeout: 1 }) as unknown as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        taskId: 'music-async',
        site: 'gemini',
        kind: 'audio',
        status: 'completed',
        download: { ok: true },
      });
    });

    it('fails clearly when the music mode cannot be selected', async () => {
      createRuntime({ ...readyState, musicSelected: false });
      const result = await musicCommandHandler({
        prompt: 'sea', timeout: 1, wait: true, taskId: 'music-mode',
      }) as unknown as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(result.message).toBe('切换「制作音乐」模式失败');
    });

    it('reports Gemini synthesis failure', async () => {
      createRuntime({
        ...readyState,
        text: '抱歉，音频生成过程中遇到了一点问题，未能成功合成。',
        audio: [],
      });
      const result = await musicCommandHandler({
        prompt: 'sea', timeout: 1, wait: true, taskId: 'music-fail',
      }) as unknown as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(result.message).toBe('Gemini 音乐合成失败，请调整提示词后重试');
    });

    it('reports timeout when no track becomes ready', async () => {
      createRuntime({ ...readyState, audio: [] });
      const result = await musicCommandHandler({
        prompt: 'sea', timeout: 0, wait: true, taskId: 'music-slow',
      }) as unknown as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(result.message).toContain('等待音乐超时');
    });
  });

  describe('generate command', () => {
    afterEach(() => {
      setGenerateRuntime({ bridgeExec: vi.fn(), cdp: vi.fn(), ev: vi.fn(), sleep: vi.fn(), pasteImage: undefined });
    });

    it('reports Google anti-automation blocks before missing-tool errors', async () => {
      setGenerateRuntime({
        bridgeExec: vi.fn((command: string) => {
          if (command === 'task-open') return Promise.resolve({ ok: true, data: { tabId: 77 } });
          return Promise.resolve({ ok: true });
        }) as never,
        cdp: vi.fn(() => Promise.resolve(undefined)) as never,
        ev: vi.fn((expression: string) => {
          if (expression.includes('location.href')) {
            return Promise.resolve({
              href: 'https://www.google.com/sorry/index?continue=https://gemini.google.com/app',
              text: '我们的系统检测到您的计算机网络中存在异常流量',
            });
          }
          return Promise.resolve('null');
        }) as never,
        sleep: vi.fn(() => Promise.resolve()) as never,
      });

      const handler = getHandler('generate-video');
      const result = await handler({ prompt: 'a calm sea', timeout: 30 }) as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(result.message).toContain('Google 反自动化拦截');
    });

    it('declares CSV attachments and first/last-frame parameters', () => {
      const video = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'generate-video');
      const config = (video![1] as { parameters: { shape?: Record<string, unknown> } }).parameters;
      expect(JSON.stringify(config)).toContain('firstFrame');
      expect(JSON.stringify(config)).toContain('lastFrame');
      expect(JSON.stringify(config)).toContain('paths');
    });

    it('rejects conflicting path and paths before uploading', async () => {
      const handler = getHandler('generate-video');
      setGenerateRuntime({
        bridgeExec: vi.fn(() => Promise.resolve({ ok: true, data: { tabId: 42 } })) as never,
        cdp: vi.fn(() => Promise.resolve(undefined)) as never,
        ev: vi.fn(() => Promise.resolve({ ready: 'complete', editor: true })) as never,
        sleep: vi.fn(() => Promise.resolve()) as never,
      });
      const result = await handler({ prompt: 'test', timeout: 30, path: '/a.png', paths: '/b.png' }) as Record<string, unknown>;
      expect(result).toMatchObject({ success: false, message: '参数错误' });
    });

    it('rejects missing attachments before uploading', async () => {
      const handler = getHandler('generate-video');
      setGenerateRuntime({
        bridgeExec: vi.fn(() => Promise.resolve({ ok: true, data: { tabId: 42 } })) as never,
        cdp: vi.fn(() => Promise.resolve(undefined)) as never,
        ev: vi.fn(() => Promise.resolve({ ready: 'complete', editor: true })) as never,
        sleep: vi.fn(() => Promise.resolve()) as never,
      });
      const result = await handler({ prompt: 'test', timeout: 30, firstFrame: '/not-exists.png' }) as Record<string, unknown>;
      expect(result.message).toContain('附件文件不存在');
    });

    it('uploads attachments one by one with DOM count verification', async () => {
      const pasteImage = vi.fn(async (): Promise<void> => undefined);
      let count = 0;
      setGenerateRuntime({
        bridgeExec: vi.fn((command: string) => command === 'task-open'
          ? Promise.resolve({ ok: true, data: { tabId: 42 } })
          : Promise.resolve({ ok: true })) as never,
        cdp: vi.fn(() => Promise.resolve(undefined)) as never,
        ev: vi.fn(() => Promise.resolve(++count)) as never,
        sleep: vi.fn(() => Promise.resolve()) as never,
        pasteImage,
      });

      const uploaded = await uploadAttachments(42, [
        { path: '/tmp/first.png', semantic: '首帧' },
        { path: '/tmp/last.png', semantic: '尾帧' },
      ]);
      expect(pasteImage).toHaveBeenCalledTimes(2);
      expect(uploaded).toBe(2);
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
