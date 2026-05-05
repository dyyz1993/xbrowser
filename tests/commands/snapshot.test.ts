import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserCommandContext } from '../../src/context.js';

function createMockContext(evaluateResult?: unknown): BrowserCommandContext {
  return {
    page: {
      screenshot: vi.fn().mockResolvedValue(Buffer.from('screenshot-data')),
      locator: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({
          screenshot: vi.fn().mockResolvedValue(Buffer.from('element-screenshot')),
        }),
      }),
      evaluate: vi.fn().mockResolvedValue(
        evaluateResult ?? [
          { ref: '@0', tag: 'body', role: '', text: 'Hello', attrs: {} },
          { ref: '@1', tag: 'button', role: 'button', text: 'Click', attrs: { id: 'btn' } },
        ]
      ),
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

describe('Snapshot Commands', () => {
  let ctx: BrowserCommandContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('screenshot', () => {
    it('should take full page screenshot', async () => {
      const { screenshotCommand } = await import('../../src/commands/snapshot.js');
      const result = await screenshotCommand.handler({ fullPage: true }, ctx);
      expect(ctx.page.screenshot).toHaveBeenCalledWith({ type: 'png', fullPage: true });
      expect(result).toMatchObject({
        success: true,
        data: {
          format: 'png',
        },
      });
      expect(typeof (result as any).data.size).toBe('number');
    });

    it('should take screenshot with jpeg type', async () => {
      const { screenshotCommand } = await import('../../src/commands/snapshot.js');
      const result = await screenshotCommand.handler({ type: 'jpeg' }, ctx);
      expect(ctx.page.screenshot).toHaveBeenCalledWith({ type: 'jpeg', fullPage: false });
      expect((result as any).data.format).toBe('jpeg');
    });

    it('should take element screenshot with selector', async () => {
      const { screenshotCommand } = await import('../../src/commands/snapshot.js');
      const result = await screenshotCommand.handler(
        { selector: '#chart' },
        ctx
      );
      expect(ctx.page.locator).toHaveBeenCalledWith('#chart');
      expect(result).toMatchObject({ success: true, data: { format: 'png' } });
    });

    it('should default to png format', async () => {
      const { screenshotCommand } = await import('../../src/commands/snapshot.js');
      await screenshotCommand.handler({}, ctx);
      expect(ctx.page.screenshot).toHaveBeenCalledWith({ type: 'png', fullPage: false });
    });
  });

  describe('snapshot', () => {
    it('should get page elements', async () => {
      const elements = [
        { ref: '@0', tag: 'body', role: '', text: 'Hello', attrs: {} },
      ];
      const snapCtx = createMockContext(elements);
      const { snapshotCommand } = await import('../../src/commands/snapshot.js');
      const result = await snapshotCommand.handler({}, snapCtx);
      expect((result as any).data.elements).toEqual(elements);
    });

    it('should pass interactiveOnly flag', async () => {
      const elements = [
        { ref: '@0', tag: 'button', role: 'button', text: 'Click', attrs: {} },
      ];
      const snapCtx = createMockContext(elements);
      const { snapshotCommand } = await import('../../src/commands/snapshot.js');
      const result = await snapshotCommand.handler(
        { interactiveOnly: true },
        snapCtx
      );
      expect(ctx.page.evaluate).not.toHaveBeenCalled();
      expect(snapCtx.page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ interactiveOnly: true })
      );
      expect((result as any).data.elements).toEqual(elements);
    });

    it('should pass selector to evaluate', async () => {
      const snapCtx = createMockContext([]);
      const { snapshotCommand } = await import('../../src/commands/snapshot.js');
      await snapshotCommand.handler({ selector: '#main' }, snapCtx);
      expect(snapCtx.page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ selector: '#main' })
      );
    });
  });
});
