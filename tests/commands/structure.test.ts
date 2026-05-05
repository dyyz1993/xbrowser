import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserCommandContext } from '../../src/context.js';

function createMockContext(evaluateResult?: unknown): BrowserCommandContext {
  return {
    page: {
      evaluate: vi.fn().mockResolvedValue(
        evaluateResult ?? {
          tag: 'body',
          role: '',
          text: 'Hello World',
          children: [
            { tag: 'div', role: '', text: 'Content', children: [] },
          ],
        }
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

describe('Structure Command', () => {
  let ctx: BrowserCommandContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('should get DOM structure with defaults', async () => {
    const tree = { tag: 'body', role: '', text: 'Hello', children: [] };
    const structCtx = createMockContext(tree);
    const { structureCommand } = await import('../../src/commands/structure.js');
    const result = await structureCommand.handler({}, structCtx);
    expect(structCtx.page.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      { sel: 'body', maxDepth: 5 }
    );
    expect((result as any).data.structure).toEqual(tree);
  });

  it('should pass selector parameter', async () => {
    const tree = { tag: 'div', role: 'main', text: '', children: [] };
    const structCtx = createMockContext(tree);
    const { structureCommand } = await import('../../src/commands/structure.js');
    await structureCommand.handler({ selector: '#app' }, structCtx);
    expect(structCtx.page.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      { sel: '#app', maxDepth: 5 }
    );
  });

  it('should pass depth parameter', async () => {
    const { structureCommand } = await import('../../src/commands/structure.js');
    await structureCommand.handler({ depth: 3 }, ctx);
    expect(ctx.page.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      { sel: 'body', maxDepth: 3 }
    );
  });

  it('should pass both selector and depth', async () => {
    const { structureCommand } = await import('../../src/commands/structure.js');
    await structureCommand.handler({ selector: '#main', depth: 2 }, ctx);
    expect(ctx.page.evaluate).toHaveBeenCalledWith(
      expect.any(Function),
      { sel: '#main', maxDepth: 2 }
    );
  });

  it('should handle nested structure result', async () => {
    const nested = {
      tag: 'html',
      role: '',
      text: 'Page',
      children: [
        {
          tag: 'body',
          role: '',
          text: 'Content',
          children: [
            { tag: 'div', role: 'main', text: 'Main', children: [] },
            { tag: 'footer', role: '', text: 'Footer', children: [] },
          ],
        },
      ],
    };
    const structCtx = createMockContext(nested);
    const { structureCommand } = await import('../../src/commands/structure.js');
    const result = await structureCommand.handler({ depth: 10 }, structCtx);
    expect((result as any).data.structure).toEqual(nested);
  });
});
