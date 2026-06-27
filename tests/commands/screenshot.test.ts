import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { BrowserCommandContext } from '../../src/context.js';

function createMockContext(): BrowserCommandContext {
  return {
    page: {
      screenshot: vi.fn().mockResolvedValue(Buffer.from('screenshot-data')),
      locator: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({
          screenshot: vi.fn().mockResolvedValue(Buffer.from('element-screenshot')),
        }),
      }),
      evaluate: vi.fn().mockResolvedValue([]),
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

describe('Screenshot Commands', () => {
  let ctx: BrowserCommandContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('screenshot', () => {
    it('should take full page screenshot', async () => {
      const { screenshotCommand } = await import('../../src/commands/screenshot.js');
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
      const { screenshotCommand } = await import('../../src/commands/screenshot.js');
      const result = await screenshotCommand.handler({ type: 'jpeg' }, ctx);
      expect(ctx.page.screenshot).toHaveBeenCalledWith({ type: 'jpeg', fullPage: false });
      expect((result as any).data.format).toBe('jpeg');
    });

    it('should take element screenshot with selector', async () => {
      const { screenshotCommand } = await import('../../src/commands/screenshot.js');
      const result = await screenshotCommand.handler(
        { selector: '#chart' },
        ctx
      );
      expect(ctx.page.locator).toHaveBeenCalledWith('#chart');
      expect(result).toMatchObject({ success: true, data: { format: 'png' } });
    });

    it('should default to png format', async () => {
      const { screenshotCommand } = await import('../../src/commands/screenshot.js');
      await screenshotCommand.handler({}, ctx);
      expect(ctx.page.screenshot).toHaveBeenCalledWith({ type: 'png', fullPage: false });
    });

    it('should return base64 data in screenshot result', async () => {
      const { screenshotCommand } = await import('../../src/commands/screenshot.js');
      const result = await screenshotCommand.handler({ base64: true }, ctx);
      expect(typeof (result as any).data.data).toBe('string');
      expect((result as any).data.data.length).toBeGreaterThan(0);
    });

    it('should return size of buffer in screenshot result', async () => {
      const { screenshotCommand } = await import('../../src/commands/screenshot.js');
      const result = await screenshotCommand.handler({}, ctx);
      expect((result as any).data.size).toBeGreaterThan(0);
    });

    it('should create nested parent dirs for --output automatically', async () => {
      const { screenshotCommand } = await import('../../src/commands/screenshot.js');
      const tmp = mkdtempSync(join(tmpdir(), 'xb-shot-'));
      // Deeply nested path whose dirs do not exist yet
      const out = join(tmp, 'a/b/c/shot.png');
      try {
        const result = await screenshotCommand.handler({ output: out }, ctx);
        expect(result.success).toBe(true);
        expect(existsSync(out)).toBe(true);
        expect(readFileSync(out, 'utf-8')).toBe('screenshot-data');
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('should return fail (not throw) when --output path is unwritable', async () => {
      const { screenshotCommand } = await import('../../src/commands/screenshot.js');
      // Root path is not writable as a file under it — ensureParentDir skips it
      // and writeFileSync throws EACCES/EISDIR. Must come back as fail, not throw.
      const result = await screenshotCommand.handler({ output: '/' }, ctx);
      expect(result.success).toBe(false);
      expect((result as any).message).toMatch(/Failed to write screenshot|Cannot create directory/);
    });
  });
});
