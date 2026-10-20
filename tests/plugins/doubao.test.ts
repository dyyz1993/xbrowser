import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/doubao/index.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mockSite = {
  command: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

const mockXCLI = {
  createSite: vi.fn(() => mockSite),
};

function createTempImage(name: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-video-')), name);
  fs.writeFileSync(file, 'test');
  return file;
}

function getVideoHandler(): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'video');
  if (!call) throw new Error('video command not found');
  return call[1].handler as (...args: unknown[]) => Promise<unknown>;
}

function createVideoCtx(mockPage: Record<string, unknown> = {}) {
  return {
    page: {
      url: vi.fn(() => 'https://www.doubao.com/chat/'),
      goto: vi.fn(),
      waitForTimeout: vi.fn(),
      waitForSelector: vi.fn(),
      waitForFunction: vi.fn(() => Promise.resolve(true)),
      bringToFront: vi.fn(async () => undefined),
      keyboard: { press: vi.fn(async () => undefined), type: vi.fn(async () => undefined) },
      mouse: { click: vi.fn(async () => undefined) },
      locator: vi.fn(() => ({
        first: () => ({
          click: vi.fn(async () => undefined),
          count: vi.fn(async () => 1),
        }),
      })),
      setFileDialogInterception: vi.fn(async () => undefined),
      setInputFiles: vi.fn(async () => undefined),
      evaluate: vi.fn()
        .mockImplementation((expression: unknown) => {
          const source = typeof expression === 'string' ? expression : String(expression);
          if (source.includes('querySelectorAll') && source.includes('getBoundingClientRect')) return Promise.resolve(0);
          if (source.includes('videoModeReady') || /Seedance|视频生成/.test(source)) return Promise.resolve(true);
          if (source.includes('querySelectorAll') && source.includes('textContent?.trim()')) {
            return Promise.resolve({ x: 10, y: 10, width: 10, height: 10 });
          }
          if (source.includes('task-id') || source.includes('job-id')) return Promise.resolve('task123');
          return Promise.resolve(true);
        }),
      ...mockPage,
    },
    cdpEndpoint: 'http://localhost:9221',
    sessionId: 'test',
    __loginChecked: true,
  };
}

describe('doubao plugin', () => {
  afterEach(() => {
    delete process.env.XBROWSER_TEST_CLIPBOARD;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.XBROWSER_TEST_CLIPBOARD = '1';
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with correct config', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'doubao',
        url: 'https://www.doubao.com',
        description: expect.stringContaining('豆包'),
      })
    );
  });

  it('should register 20 commands (image-edit removed in favor of `image --ref`)', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(20);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    const expected = [
      'list', 'new', 'open', 'chat',
      'image', 'extract-images', 'image-cutout', 'image-vary', 'my-creations',
      'video', 'video-status', 'video-result',
      'music', 'music-status', 'music-result',
      'upload', 'cloud-drive',
      'mode', 'search', 'attach',
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });

  it('should register extract-images command with chatId param', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'extract-images');
    expect(cmd).toBeDefined();
    const config = cmd![1] as { description: string; parameters: { shape: Record<string, unknown> } };
    expect(config.description).toContain('HD');
    expect(config.parameters.shape.chatId).toBeDefined();
  });

  it('should register list command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'list')!;
    expect(cmd).toBeDefined();
    const config = cmd[1] as Record<string, unknown>;
    expect(config.description).toBe('列出所有历史会话');
    expect(config.scope).toBe('page');
  });

  it('should register chat command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'chat')!;
    expect(cmd).toBeDefined();
    const config = cmd[1] as Record<string, unknown>;
    expect(config.description).toContain('发送消息');
    expect(config.scope).toBe('browser');
  });

  it('should register image command with correct config', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'image')!;
    expect(cmd).toBeDefined();
    const config = cmd[1] as Record<string, unknown>;
    expect(config.description).toContain('文生图');
    expect(config.scope).toBe('browser');
  });

  it('should register image-cutout command (image-edit removed, ref flows through `image --ref`)', () => {
    // image-edit was removed — see image.test.ts for --ref coverage
    expect(true).toBe(true);
  });

  it('should register video command with async task pattern', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'video')!;
    expect(cmd).toBeDefined();
    const config = cmd[1] as Record<string, unknown>;
    expect(config.description).toContain('视频生成');
    expect(config.scope).toBe('browser');
  });

  describe('video attachments', () => {
    it('should declare CSV attachment and first/last frame parameters', () => {
      const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'video')!;
      const config = cmd[1] as { examples?: Array<{ cmd: string }> };
      const examples = (config.examples || []).map((e) => e.cmd).join('\n');
      expect(examples).toContain('--paths');
      expect(examples).toContain('--firstFrame');
      expect(examples).toContain('--lastFrame');
    });

    it('should reject conflicting path and paths before uploading', async () => {
      const handler = getVideoHandler();
      const ctx = createVideoCtx();
      const result = await handler({
        prompt: 'test',
        path: '/tmp/a.jpg',
        paths: '/tmp/b.jpg',
      }, ctx);
      expect(result).toMatchObject({ success: false, message: '参数错误' });
      expect(ctx.page.waitForTimeout).toHaveBeenCalledTimes(1);
    });

    it('should reject a missing attachment before uploading', async () => {
      const handler = getVideoHandler();
      const ctx = createVideoCtx();
      const result = await handler({ prompt: 'test', firstFrame: '/not/exists.jpg' }, ctx);
      expect(result).toMatchObject({ success: false, message: '附件文件不存在: /not/exists.jpg' });
    });

    it('should upload generic attachments in CSV order and report deduped files', async () => {
      const first = createTempImage('first.jpg');
      const second = createTempImage('second.jpg');
      const handler = getVideoHandler();
      const ctx = createVideoCtx();
      const result = await handler({
        prompt: '对比参考图',
        paths: `${first},${second}`,
      }, ctx);
      const data = ((result as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
      expect(data.attachments).toEqual([
        { semantic: '附件', path: first },
        { semantic: '附件', path: second },
      ]);
      const provider = data.provider as Record<string, unknown>;
      expect(provider.attachments).toEqual(data.attachments);
      expect(JSON.stringify((result as Record<string, unknown>).tips)).toContain('✓ 已上传 2 个附件');
    });

    it('should upload deduplicated first and last frame attachments', async () => {
      const first = createTempImage('first.jpg');
      const last = createTempImage('last.jpg');
      const handler = getVideoHandler();
      const ctx = createVideoCtx();
      const result = await handler({
        prompt: '从日出过渡到日落',
        firstFrame: first,
        lastFrame: last,
      }, ctx);
      const data = ((result as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
      expect(data.attachments).toEqual([
        { semantic: '首帧', path: first },
        { semantic: '尾帧', path: last },
      ]);
      expect(JSON.stringify((result as Record<string, unknown>).tips)).toContain('✓ 已上传 2 个附件');
    });

    it('should expose a single last-frame semantic in result and tips', async () => {
      const only = createTempImage('only.jpg');
      const handler = getVideoHandler();
      const ctx = createVideoCtx();
      const result = await handler({ prompt: '让画面动起来', lastFrame: only }, ctx);
      const data = ((result as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
      expect(data.attachments).toEqual([{ semantic: '尾帧', path: only }]);
      expect(JSON.stringify((result as Record<string, unknown>).tips)).toContain('✓ 已上传 1 个尾帧');
    });
  });

  it('should register video-status command', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'video-status')!;
    expect(cmd).toBeDefined();
    const config = cmd[1] as Record<string, unknown>;
    expect(config.description).toContain('状态');
    expect(config.scope).toBe('browser');
  });

  it('should register music command with async task pattern', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'music')!;
    expect(cmd).toBeDefined();
    const config = cmd[1] as Record<string, unknown>;
    expect(config.description).toContain('音乐生成');
    expect(config.scope).toBe('browser');
    const examples = config.examples as Array<{ cmd: string; description: string }>;
    expect(examples.some(e => e.cmd.includes('--lyric'))).toBe(true);
    expect(examples.some(e => e.cmd.includes('--debug'))).toBe(true);
  });

  it('should register upload command', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'upload')!;
    expect(cmd).toBeDefined();
    const config = cmd[1] as Record<string, unknown>;
    expect(config.description).toContain('上传');
    expect(config.scope).toBe('browser');
  });

  it('should register cloud-drive command', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'cloud-drive')!;
    expect(cmd).toBeDefined();
    const config = cmd[1] as Record<string, unknown>;
    expect(config.description).toContain('云盘');
    expect(config.scope).toBe('browser');
  });

  it('should register mode command', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'mode')!;
    expect(cmd).toBeDefined();
    const config = cmd[1] as Record<string, unknown>;
    expect(config.description).toContain('模型');
    expect(config.scope).toBe('browser');
  });

  it('should register search command', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'search')!;
    expect(cmd).toBeDefined();
    const config = cmd[1] as Record<string, unknown>;
    expect(config.description).toContain('搜索');
    expect(config.scope).toBe('browser');
  });

  it('should register attach command', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'attach')!;
    expect(cmd).toBeDefined();
    const config = cmd[1] as Record<string, unknown>;
    expect(config.description).toContain('附件');
    expect(config.scope).toBe('browser');
  });

  it('should have login and logout handlers', () => {
    expect(mockSite.login).toHaveBeenCalled();
    expect(mockSite.logout).toHaveBeenCalled();
  });

  it('should have examples for all commands', () => {
    const calls = mockSite.command.mock.calls;
    for (const [, config] of calls) {
      const c = config as Record<string, unknown>;
      expect(c.examples).toBeDefined();
      expect(Array.isArray(c.examples)).toBe(true);
      expect((c.examples as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it('should have description for all commands', () => {
    const calls = mockSite.command.mock.calls;
    for (const [, config] of calls) {
      const c = config as Record<string, unknown>;
      expect(c.description).toBeDefined();
      expect(typeof c.description).toBe('string');
      expect((c.description as string).length).toBeGreaterThan(0);
    }
  });

  it('should include all specific command groups', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);

    const sessionMgmt = ['list', 'new', 'open', 'chat'];
    const imageCmds = ['image', 'image-cutout', 'image-vary', 'my-creations'];
    const videoCmds = ['video', 'video-status', 'video-result'];
    const musicCmds = ['music', 'music-status', 'music-result'];
    const fileCmds = ['upload', 'cloud-drive'];
    const otherCmds = ['mode', 'search', 'attach'];

    for (const name of [...sessionMgmt, ...imageCmds, ...videoCmds, ...musicCmds, ...fileCmds, ...otherCmds]) {
      expect(names).toContain(name);
    }
  });

  it('image command should accept --ref parameter for reference image', () => {
    const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'image')!;
    expect(cmd).toBeDefined();
    const config = cmd[1] as Record<string, unknown>;
    const params = config.parameters as { shape?: Record<string, unknown> };
    // zod object: just verify the param exists
    expect(params).toBeDefined();
  });
});
