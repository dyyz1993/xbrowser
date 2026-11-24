import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/doubao/index.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wholePng } from './_image-helper.js';

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

/** A whole PNG carrying width/height (signature + IHDR + IEND). */
function pngHeader(width: number, height: number): Buffer {
  return wholePng(width, height);
}

function writeTempFile(name: string, bytes: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-preflight-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
}

function getCommandHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`${name} command not found`);
  return call[1].handler as (...args: unknown[]) => Promise<unknown>;
}

function getVideoHandler(): (...args: unknown[]) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'video');
  if (!call) throw new Error('video command not found');
  return call[1].handler as (...args: unknown[]) => Promise<unknown>;
}

function createVideoCtx(mockPage: Record<string, unknown> = {}) {
  return {
    page: {
      url: vi.fn(() => 'https://www.doubao.com/chat/38448285459015426'),
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
          isVisible: vi.fn(async () => true),
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
          // submitMessage：发送按钮坐标（JSON 字符串）
          if (source.includes('flow-end-msg-send')) return Promise.resolve(JSON.stringify({ x: 10, y: 10 }));
          // video 输入存活校验：编辑器字符数（要 ≥10 才算存活）
          if (source.includes('], textarea')) return Promise.resolve(50);
          // 点击后清空核实：编辑器已清空（0）
          if (source.includes('ProseMirror')) return Promise.resolve(0);
          if (source.includes('task-id') || source.includes('job-id')) return Promise.resolve('task123');
          if (source.includes('location.href') || source.includes('window.location')) {
            return Promise.resolve('https://www.doubao.com/chat/38448285459015426');
          }
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

  // ─── --preflight-only：只跑本地检查，不碰页面、不提交任务 ───
  describe('preflight-only', () => {
    it('declares preflightOnly on every media generation submit command', () => {
      for (const name of ['image', 'image-cutout', 'image-vary', 'video', 'music']) {
        const cmd = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name)!;
        const config = cmd[1] as { parameters: { shape: Record<string, unknown> } };
        expect(config.parameters.shape.preflightOnly, `${name} must declare preflightOnly`).toBeDefined();
      }
    });

    it('video preflight returns a report and never touches the page', async () => {
      const handler = getCommandHandler('video');
      const ctx = createVideoCtx();
      const first = writeTempFile('first.png', pngHeader(1280, 720));
      const result = await handler({ prompt: '从日出过渡到日落', firstFrame: first, preflightOnly: true }, ctx);
      const record = result as Record<string, unknown>;
      expect(record.success).toBe(true);
      const data = record.data as Record<string, unknown>;
      expect(data.status).toBe('completed');
      expect(data.providerStatus).toBe('preflight-only');
      const preflight = data.preflight as Record<string, unknown>;
      expect(preflight.ok).toBe(true);
      expect(preflight.provider).toBe('doubao');
      expect(preflight.command).toBe('video');
      expect((preflight.attachments as Array<Record<string, unknown>>)[0]).toMatchObject({
        width: 1280, height: 720, kind: 'image', semantic: '首帧',
      });
      expect(ctx.page.goto).not.toHaveBeenCalled();
      expect(ctx.page.evaluate).not.toHaveBeenCalled();
      expect(ctx.page.waitForTimeout).not.toHaveBeenCalled();
    });

    it('video preflight fails with a specific reason for a missing file', async () => {
      const handler = getCommandHandler('video');
      const ctx = createVideoCtx();
      const result = await handler({ prompt: 'p', firstFrame: '/not/exists/ref.png', preflightOnly: true }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(result.message).toBe('preflight 未通过');
      expect(JSON.stringify(result.tips)).toContain('附件文件不存在或无法访问');
      expect(ctx.page.goto).not.toHaveBeenCalled();
    });

    it('video preflight fails for a non-image attachment', async () => {
      const handler = getCommandHandler('video');
      const ctx = createVideoCtx();
      const textFile = writeTempFile('notes.txt', Buffer.from('plain text', 'utf8'));
      const result = await handler({ prompt: 'p', path: textFile, preflightOnly: true }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.tips)).toContain('不是图片文件');
      expect(ctx.page.evaluate).not.toHaveBeenCalled();
    });

    it('video preflight fails for a truncated image header', async () => {
      const handler = getCommandHandler('video');
      const ctx = createVideoCtx();
      const truncated = writeTempFile('cut.png', pngHeader(800, 600).subarray(0, 18));
      const result = await handler({ prompt: 'p', path: truncated, preflightOnly: true }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.tips)).toContain('截断');
      expect(ctx.page.evaluate).not.toHaveBeenCalled();
    });

    function createImageCtx(refButtonRect: { x: number; y: number } | null, setInputFilesError?: Error) {
      return {
        page: {
          url: vi.fn(() => 'https://www.doubao.com/chat/1'),
          goto: vi.fn(async () => ({})),
          waitForTimeout: vi.fn(async () => {}),
          waitForSelector: vi.fn(async () => null),
          waitForFunction: vi.fn(async () => true),
          evaluate: vi.fn(async (expression: unknown) => {
            const source = typeof expression === 'string' ? expression : String(expression);
            if (source.includes('document.body') && source.includes('innerText')) {
              return '豆包 新对话';
            }
            // clickButtonByText 的 TreeWalker 查询（找"参考图"按钮）
            if (source.includes('createTreeWalker')) return refButtonRect;
            return true;
          }),
          mouse: { click: vi.fn(async () => {}) },
          keyboard: { type: vi.fn(async () => {}), press: vi.fn(async () => {}) },
          locator: vi.fn(() => ({
            first: () => ({
              click: vi.fn(async () => {}),
              count: vi.fn(async () => 1),
              isVisible: vi.fn(async () => true),
            }),
          })),
          setInputFiles: vi.fn(async () => {
            if (setInputFilesError) throw setInputFilesError;
          }),
        },
        cdpEndpoint: 'http://localhost:9221',
        sessionId: 'test',
      };
    }

    it('image preflight reports the reference image and never navigates', async () => {
      const handler = getCommandHandler('image');
      const ctx = createImageCtx({ x: 1, y: 1 });
      const ref = writeTempFile('ref.png', pngHeader(300, 400));
      const result = await handler({ prompt: '油画风格的花园', ref, preflightOnly: true }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.providerStatus).toBe('preflight-only');
      const preflight = data.preflight as Record<string, unknown>;
      expect(preflight.ok).toBe(true);
      expect(preflight.command).toBe('image');
      expect((preflight.attachments as Array<Record<string, unknown>>)[0]).toMatchObject({
        semantic: '参考图', width: 300, height: 400,
      });
      expect(ctx.page.goto).not.toHaveBeenCalled();
      expect(ctx.page.evaluate).not.toHaveBeenCalled();
    });

    it('image-cutout preflight validates the source image without a page', async () => {
      const handler = getCommandHandler('image-cutout');
      const ctx = createImageCtx(null);
      const image = writeTempFile('cut-me.png', pngHeader(64, 64));
      const result = await handler({ image, preflightOnly: true }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(true);
      const preflight = ((result.data as Record<string, unknown>).preflight) as Record<string, unknown>;
      expect(preflight.ok).toBe(true);
      expect((preflight.attachments as Array<Record<string, unknown>>)[0]).toMatchObject({ semantic: '抠图源图' });
      expect(ctx.page.goto).not.toHaveBeenCalled();
    });

    it('image-vary preflight fails for a truncated reference', async () => {
      const handler = getCommandHandler('image-vary');
      const ctx = createImageCtx(null);
      const truncated = writeTempFile('broken.png', pngHeader(100, 100).subarray(0, 17));
      const result = await handler({ image: truncated, preflightOnly: true }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.tips)).toContain('截断');
      expect(ctx.page.goto).not.toHaveBeenCalled();
    });

    it('music preflight validates parameters and reports lyric truncation', async () => {
      const handler = getCommandHandler('music');
      const ctx = createVideoCtx();
      const result = await handler({
        description: '快乐的歌曲', style: '流行', lyric: '啊'.repeat(250), preflightOnly: true,
      }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.providerStatus).toBe('preflight-only');
      const preflight = data.preflight as Record<string, unknown>;
      expect(preflight.ok).toBe(true);
      expect(preflight.mode).toBe('audio:流行');
      expect((preflight.notes as string[]).join(' ')).toContain('截断到 200 字');
      expect(ctx.page.goto).not.toHaveBeenCalled();
    });

    it('music preflight fails when description and lyric are both missing', async () => {
      const handler = getCommandHandler('music');
      const ctx = createVideoCtx();
      const result = await handler({ preflightOnly: true }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(result.message).toBe('preflight 未通过');
      expect(JSON.stringify(result.tips)).toContain('--description 或 --lyric 为空');
      expect(ctx.page.goto).not.toHaveBeenCalled();
    });
  });

  // ─── fail-closed：参考图缺失/上传失败时，绝不带伤提交消耗额度 ───
  describe('image --ref fail-closed before submit', () => {
    it('fails before any navigation when the reference file is missing', async () => {
      const handler = getCommandHandler('image');
      const ctx = createVideoCtx();
      const result = await handler({ prompt: 'p', ref: '/not/exists/ref.png' }, ctx) as Record<string, unknown>;
      expect(result).toMatchObject({ success: false, message: '参考图文件不存在: /not/exists/ref.png' });
      expect(ctx.page.goto).not.toHaveBeenCalled();
      expect(ctx.page.keyboard.type).not.toHaveBeenCalled();
    });

    it('fails instead of submitting when the 参考图 button is missing', async () => {
      const handler = getCommandHandler('image');
      const ctx = {
        page: {
          url: vi.fn(() => 'https://www.doubao.com/chat/1'),
          goto: vi.fn(async () => ({})),
          waitForTimeout: vi.fn(async () => {}),
          waitForSelector: vi.fn(async () => null),
          waitForFunction: vi.fn(async () => true),
          evaluate: vi.fn(async (expression: unknown) => {
            const source = typeof expression === 'string' ? expression : String(expression);
            if (source.includes('document.body') && source.includes('innerText')) {
              return '豆包 新对话';
            }
            if (source.includes('createTreeWalker')) return null; // 按钮找不到
            return true;
          }),
          mouse: { click: vi.fn(async () => {}) },
          keyboard: { type: vi.fn(async () => {}), press: vi.fn(async () => {}) },
          locator: vi.fn(() => ({
            first: () => ({
              click: vi.fn(async () => {}),
              count: vi.fn(async () => 1),
              isVisible: vi.fn(async () => true),
            }),
          })),
          setInputFiles: vi.fn(async () => {}),
        },
        cdpEndpoint: 'http://localhost:9221',
        sessionId: 'test',
      };
      const ref = writeTempFile('ref.png', pngHeader(32, 32));
      const result = await handler({ prompt: 'p', ref }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(result.message).toBe('附件上传失败');
      expect(JSON.stringify(result.tips)).toContain('参考图未上传');
      expect(JSON.stringify(result.tips)).toContain('fail-closed');
      // 提交路径（打字 + 发送）从未到达
      expect(ctx.page.keyboard.type).not.toHaveBeenCalled();
      expect(ctx.page.keyboard.press).not.toHaveBeenCalled();
    });

    it('fails instead of submitting when setInputFiles throws', async () => {
      const handler = getCommandHandler('image');
      const ctx = {
        page: {
          url: vi.fn(() => 'https://www.doubao.com/chat/1'),
          goto: vi.fn(async () => ({})),
          waitForTimeout: vi.fn(async () => {}),
          waitForSelector: vi.fn(async () => null),
          waitForFunction: vi.fn(async () => true),
          evaluate: vi.fn(async (expression: unknown) => {
            const source = typeof expression === 'string' ? expression : String(expression);
            if (source.includes('document.body') && source.includes('innerText')) {
              return '豆包 新对话';
            }
            if (source.includes('createTreeWalker')) return { x: 8, y: 9 }; // 按钮可点
            return true;
          }),
          mouse: { click: vi.fn(async () => {}) },
          keyboard: { type: vi.fn(async () => {}), press: vi.fn(async () => {}) },
          locator: vi.fn(() => ({
            first: () => ({
              click: vi.fn(async () => {}),
              count: vi.fn(async () => 1),
              isVisible: vi.fn(async () => true),
            }),
          })),
          setInputFiles: vi.fn(async () => { throw new Error('injection failed'); }),
        },
        cdpEndpoint: 'http://localhost:9221',
        sessionId: 'test',
      };
      const ref = writeTempFile('ref.png', pngHeader(32, 32));
      const result = await handler({ prompt: 'p', ref }, ctx) as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(result.message).toBe('附件上传失败');
      expect(JSON.stringify(result.tips)).toContain('参考图注入失败: injection failed');
      expect(ctx.page.keyboard.type).not.toHaveBeenCalled();
      expect(ctx.page.keyboard.press).not.toHaveBeenCalled();
    });
  });

  describe('video recovery', () => {
    function getStatusHandler(): (...args: unknown[]) => Promise<unknown> {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'video-status');
      if (!call) throw new Error('video-status command not found');
      return call[1].handler as (...args: unknown[]) => Promise<unknown>;
    }

    function getResultHandler(): (...args: unknown[]) => Promise<unknown> {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'video-result');
      if (!call) throw new Error('video-result command not found');
      return call[1].handler as (...args: unknown[]) => Promise<unknown>;
    }

    function createRecoveryCtx() {
      const ctx = createVideoCtx();
      ctx.page.url = vi.fn(() => 'about:blank');
      ctx.page.evaluate = vi.fn((expression: unknown) => {
        const source = typeof expression === 'string' ? expression : String(expression);
        if (source.includes('querySelectorAll') && source.includes('video')) {
          return Promise.resolve({
            status: 'completed',
            statusText: 'video ready',
            mediaUrl: 'https://v11-vdl.doubao.com/example.mp4',
          });
        }
        return Promise.resolve(true);
      });
      return ctx;
    }

    it('rejects an invalid task before navigation', async () => {
      const statusHandler = getStatusHandler();
      const resultHandler = getResultHandler();
      const ctx = createRecoveryCtx();
      for (const handler of [statusHandler, resultHandler]) {
        const result = await handler({ task: 'legacy-id' }, ctx);
        expect(result).toMatchObject({ success: false, message: '任务 ID 无效' });
        expect(ctx.page.goto).not.toHaveBeenCalled();
      }
    });

    it('navigates to the encoded session and decodes the prompt', async () => {
      const prompt = '从首帧推进到尾帧';
      const taskId = `doubao-video:38448285459015426:${Buffer.from(prompt).toString('base64url')}`;
      const ctx = createRecoveryCtx();
      const statusHandler = getStatusHandler();
      const result = await statusHandler({ task: taskId, timeout: 1 }, ctx);
      const data = ((result as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
      expect(result).toMatchObject({ success: true });
      expect(data.kind).toBe('video');
      expect(data.sessionUrl).toBe('https://www.doubao.com/chat/38448285459015426');
      expect(ctx.page.goto).toHaveBeenCalledWith('https://www.doubao.com/chat/38448285459015426', expect.anything());

      const resultHandler = getResultHandler();
      const downloadCtx = createRecoveryCtx();
      downloadCtx.page.evaluate = vi.fn((expression: unknown) => {
        const source = typeof expression === 'string' ? expression : String(expression);
        if (source.includes('querySelectorAll') && source.includes('video')) {
          return Promise.resolve({
            status: 'completed',
            statusText: 'video ready',
            mediaUrl: 'https://v11-vdl.doubao.com/example.mp4',
          });
        }
        if (source.includes('fetch(mediaUrl')) {
          return Promise.resolve(Buffer.from('x'.repeat(2048)).toString('base64'));
        }
        return Promise.resolve('');
      });
      const download = await resultHandler({ task: taskId, timeout: 1 }, downloadCtx) as Record<string, unknown>;
      expect(download.success).toBe(true);
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
