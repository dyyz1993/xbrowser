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
      });
      expect((result as any).data.frames[1]).toEqual({
        index: 1,
        name: 'iframe-1',
        url: 'https://example.com/embed',
      });
    });

    it('should handle empty frames list', async () => {
      const emptyCtx = createMockContext();
      (emptyCtx.page as any).frames = vi.fn().mockReturnValue([]);
      const { framesCommand } = await import('../../src/commands/frame.js');
      const result = await framesCommand.handler({}, emptyCtx);
      expect((result as any).data.frames).toEqual([]);
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
