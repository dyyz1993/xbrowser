import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserCommandContext } from '../../src/context.js';

function createMockFrame(name: string, url: string) {
  return {
    name: vi.fn().mockReturnValue(name),
    url: vi.fn().mockReturnValue(url),
  };
}

function createMockContext(): BrowserCommandContext {
  const frames = [
    createMockFrame('', 'https://example.com'),
    createMockFrame('iframe-1', 'https://example.com/embed'),
    createMockFrame('iframe-2', 'https://other.com/widget'),
  ];

  return {
    page: {
      frames: vi.fn().mockReturnValue(frames),
      url: vi.fn().mockReturnValue('https://example.com'),
      evaluate: vi.fn().mockResolvedValue(JSON.stringify([{ src: 'https://example.com/embed', name: 'iframe-1' }])),
      evaluateInFrame: vi.fn().mockResolvedValue('[]'),
    },
    browser: {},
    browserContext: {
      cookies: vi.fn().mockResolvedValue([]),
      addCookies: vi.fn().mockResolvedValue(undefined),
      clearCookies: vi.fn().mockResolvedValue(undefined),
    },
    sessionId: 'test-session',
    args: [],
    options: {},
    cwd: '/tmp',
    storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn(), keys: vi.fn() },
    output: { mode: 'text', showTips: false, color: false, emoji: false },
    error: vi.fn(),
    config: {},
    site: {} as any,
    cliName: 'xbrowser',
  } as unknown as BrowserCommandContext;
}

describe('Frame Commands', () => {
  let ctx: BrowserCommandContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('frames', () => {
    it('should list all frames', async () => {
      const { framesCommand } = await import('../../src/commands/frame.js');
      const result = await framesCommand.handler({}, ctx);
      expect((result as any).data.frames).toHaveLength(3);
      expect((result as any).data.frames[0]).toEqual({
        index: 0,
        name: '',
        url: 'https://example.com',
        parentUrl: null,
        depth: 0,
      });
      // 主页面的 iframe 子帧 src 可见 → 层级重建能标出 embed 的父级与深度
      expect((result as any).data.frames[1]).toEqual({
        index: 1,
        name: 'iframe-1',
        url: 'https://example.com/embed',
        parentUrl: 'https://example.com',
        depth: 1,
      });
    });

    it('should handle empty frames list', async () => {
      const emptyCtx = createMockContext();
      (emptyCtx.page as any).frames = vi.fn().mockReturnValue([]);
      const { framesCommand } = await import('../../src/commands/frame.js');
      const result = await framesCommand.handler({}, emptyCtx);
      expect((result as any).data.frames).toEqual([]);
    });

    it('should append OOPIF targets from listFrameTargets (marked oopif + targetId)', async () => {
      const oopifCtx = createMockContext();
      (oopifCtx.page as any).listFrameTargets = vi.fn().mockResolvedValue([
        { url: 'https://captcha.gtimg.com/static/template/drag_ele.html', targetId: 'T-captcha' },
        { url: 'https://example.com/embed', targetId: 'T-dup' }, // 与 frame 树同 URL，应去重
      ]);
      // 主页面 DOM 里看得到 gtimg iframe 的 src → 层级重建标父级/深度
      (oopifCtx.page as any).evaluate = vi.fn().mockResolvedValue(
        JSON.stringify([{ src: 'https://captcha.gtimg.com/static/template/drag_ele.html', name: '' }]),
      );
      const { framesCommand } = await import('../../src/commands/frame.js');
      const result = await framesCommand.handler({}, oopifCtx);
      const frames = (result as any).data.frames;
      expect(frames).toHaveLength(4); // 3 个树内 frame + 1 个 OOPIF（去重后）
      const oopifEntry = frames[3];
      expect(oopifEntry).toEqual({
        index: 3,
        name: null,
        url: 'https://captcha.gtimg.com/static/template/drag_ele.html',
        oopif: true,
        targetId: 'T-captcha',
        parentUrl: 'https://example.com',
        depth: 1,
      });
    });

    it('should warn on URL substring ambiguity across frames', async () => {
      const ambCtx = createMockContext();
      (ambCtx.page as any).listFrameTargets = vi.fn().mockResolvedValue([
        { url: 'https://example.com', targetId: 'T-a' }, // 是主页 url 的子串 → 歧义
      ]);
      const { framesCommand } = await import('../../src/commands/frame.js');
      const result = await framesCommand.handler({}, ambCtx);
      const warnings = (result as any).data.warnings as string[];
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('歧义');
    });

    it('should tolerate pages without listFrameTargets (legacy mock)', async () => {
      const { framesCommand } = await import('../../src/commands/frame.js');
      const result = await framesCommand.handler({}, ctx);
      expect((result as any).data.frames).toHaveLength(3);
    });
  });

  describe('frame', () => {
    it('should get frame by index', async () => {
      const { frameCommand } = await import('../../src/commands/frame.js');
      const result = await frameCommand.handler({ index: 1 }, ctx);
      expect(result).toEqual({
        success: true,
        data: { name: 'iframe-1', url: 'https://example.com/embed' },
        tips: [],
      });
    });

    it('should get frame by name', async () => {
      const { frameCommand } = await import('../../src/commands/frame.js');
      const result = await frameCommand.handler({ name: 'iframe-2' }, ctx);
      expect(result).toEqual({
        success: true,
        data: { name: 'iframe-2', url: 'https://other.com/widget' },
        tips: [],
      });
    });

    it('should return error when no index or name provided', async () => {
      const { frameCommand } = await import('../../src/commands/frame.js');
      const result = await frameCommand.handler({}, ctx);
      expect(result).toEqual({ success: false, data: null, message: 'Must provide index or name', tips: [] });
    });

    it('should return error when frame not found by index', async () => {
      const { frameCommand } = await import('../../src/commands/frame.js');
      const result = await frameCommand.handler({ index: 99 }, ctx);
      expect(result).toEqual({ success: false, data: null, message: 'Frame not found', tips: [] });
    });

    it('should return error when frame not found by name', async () => {
      const { frameCommand } = await import('../../src/commands/frame.js');
      const result = await frameCommand.handler({ name: 'nonexistent' }, ctx);
      expect(result).toEqual({ success: false, data: null, message: 'Frame not found', tips: [] });
    });

    it('should get first frame by index 0', async () => {
      const { frameCommand } = await import('../../src/commands/frame.js');
      const result = await frameCommand.handler({ index: 0 }, ctx);
      expect(result).toEqual({
        success: true,
        data: { name: '', url: 'https://example.com' },
        tips: [],
      });
    });
  });
});
