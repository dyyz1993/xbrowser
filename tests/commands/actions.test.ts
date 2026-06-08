import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from '../../src/browser-shim.js';
import type { BrowserCommandContext } from '../../src/context.js';

function createMockPage(overrides?: Partial<Page>): Page {
  return {
    goto: vi.fn().mockResolvedValue({ status: () => 200 }),
    url: vi.fn().mockReturnValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Example Page'),
    waitForSelector: vi.fn().mockResolvedValue({}),
    click: vi.fn().mockResolvedValue(undefined),
    $$eval: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
    keyboard: {
      type: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
    },
    locator: vi.fn().mockReturnValue({
      evaluate: vi.fn().mockResolvedValue(undefined),
    }),
    evaluate: vi.fn().mockResolvedValue(undefined),
    innerHTML: vi.fn().mockResolvedValue('<h1>Hello</h1>'),
    pdf: vi.fn().mockResolvedValue(Buffer.from('fake-pdf')),
    ...overrides,
  } as unknown as Page;
}

function createMockContext(page: Page): BrowserCommandContext {
  return {
    page,
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
    output: { mode: 'text' as const, showTips: false, color: false, emoji: false },
    error: vi.fn(),
    config: {},
    site: {} as never,
    cliName: 'xbrowser',
  } as unknown as BrowserCommandContext;
}

async function getHandler() {
  const { actionsCommand } = await import('../../src/commands/actions.js');
  return actionsCommand;
}

describe('actions command', () => {
  let mockPage: Page;
  let ctx: BrowserCommandContext;

  beforeEach(() => {
    mockPage = createMockPage();
    ctx = createMockContext(mockPage);
  });

  describe('wait action', () => {
    it('should execute wait with milliseconds', async () => {
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'wait', milliseconds: 500 }], output: 'json' },
        ctx,
      );
      const data = (result as { data: { results: unknown[] } }).data;
      expect(data.results).toEqual([{ type: 'success' }]);
    });

    it('should execute wait with selector', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'wait', selector: '#main' }], output: 'json' },
        ctx,
      );
      expect(mockPage.waitForSelector).toHaveBeenCalledWith('#main', { timeout: 30000 });
    });

    it('should reject wait without both milliseconds and selector via validation', async () => {
      const cmd = await getHandler();
      const parsed = cmd.parameters!.safeParse({
        url: 'https://example.com',
        actions: [{ type: 'wait' }],
        output: 'json',
      });
      expect(parsed.success).toBe(false);
    });

    it('should reject wait with both milliseconds and selector via validation', async () => {
      const cmd = await getHandler();
      const parsed = cmd.parameters!.safeParse({
        url: 'https://example.com',
        actions: [{ type: 'wait', milliseconds: 1000, selector: '#main' }],
        output: 'json',
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('click action', () => {
    it('should click a single element', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'click', selector: '#btn' }], output: 'json' },
        ctx,
      );
      expect(mockPage.click).toHaveBeenCalledWith('#btn');
    });

    it('should click all matching elements when all=true', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'click', selector: '.item', all: true }], output: 'json' },
        ctx,
      );
      expect(mockPage.$$eval).toHaveBeenCalledWith('.item', expect.any(Function));
    });

    it('should default all to undefined (single click)', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'click', selector: '#btn' }], output: 'json' },
        ctx,
      );
      expect(mockPage.click).toHaveBeenCalledWith('#btn');
      expect(mockPage.$$eval).not.toHaveBeenCalled();
    });
  });

  describe('screenshot action', () => {
    it('should take a screenshot with defaults', async () => {
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'screenshot' }], output: 'json' },
        ctx,
      );
      expect(mockPage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ fullPage: false, type: 'jpeg', quality: 80 }),
      );
      const data = (result as { data: { results: { type: string; result: string }[] } }).data;
      expect(data.results[0]).toEqual({ type: 'screenshot', result: expect.any(String) });
    });

    it('should take fullPage screenshot', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'screenshot', fullPage: true }], output: 'json' },
        ctx,
      );
      expect(mockPage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ fullPage: true }),
      );
    });

    it('should take screenshot with quality', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'screenshot', quality: 50 }], output: 'json' },
        ctx,
      );
      expect(mockPage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ quality: 50 }),
      );
    });

    it('should take screenshot with viewport clip', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'screenshot', viewport: { width: 1280, height: 720 } }], output: 'json' },
        ctx,
      );
      expect(mockPage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ clip: { x: 0, y: 0, width: 1280, height: 720 } }),
      );
    });
  });

  describe('write action', () => {
    it('should type text via keyboard', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'write', text: 'hello world' }], output: 'json' },
        ctx,
      );
      expect(mockPage.keyboard.type).toHaveBeenCalledWith('hello world');
    });
  });

  describe('press action', () => {
    it('should press a key', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'press', key: 'Enter' }], output: 'json' },
        ctx,
      );
      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Enter');
    });

    it('should press special keys', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'press', key: 'Control+a' }], output: 'json' },
        ctx,
      );
      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Control+a');
    });
  });

  describe('scroll action', () => {
    it('should scroll down by default', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'scroll' }], output: 'json' },
        ctx,
      );
      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), 500);
    });

    it('should scroll down explicitly', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'scroll', direction: 'down' }], output: 'json' },
        ctx,
      );
      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), 500);
    });

    it('should scroll up', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'scroll', direction: 'up' }], output: 'json' },
        ctx,
      );
      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), -500);
    });

    it('should scroll within a specific element via selector', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'scroll', selector: '#container', direction: 'down' }], output: 'json' },
        ctx,
      );
      expect(mockPage.locator).toHaveBeenCalledWith('#container');
    });

    it('should scroll up within a specific element', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'scroll', selector: '#list', direction: 'up' }], output: 'json' },
        ctx,
      );
      expect(mockPage.locator).toHaveBeenCalledWith('#list');
    });
  });

  describe('scrape action', () => {
    it('should scrape page body HTML and current URL', async () => {
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'scrape' }], output: 'json' },
        ctx,
      );
      expect(mockPage.innerHTML).toHaveBeenCalledWith('body');
      const data = (result as { data: { results: { type: string; result: { url: string; html: string } }[] } }).data;
      expect(data.results[0]).toEqual({
        type: 'scrape',
        result: { url: 'https://example.com', html: '<h1>Hello</h1>' },
      });
    });
  });

  describe('executeJavascript action', () => {
    it('should return string result with correct type info', async () => {
      (mockPage.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce('page-title');
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'executeJavascript', script: 'document.title' }], output: 'json' },
        ctx,
      );
      expect(mockPage.evaluate).toHaveBeenCalledWith('document.title');
      const data = (result as { data: { results: { type: string; result: { type: string; value: string } }[] } }).data;
      expect(data.results[0]).toEqual({
        type: 'executeJavascript',
        result: { type: 'string', value: 'page-title' },
      });
    });

    it('should return number result', async () => {
      (mockPage.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(42);
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'executeJavascript', script: '1 + 41' }], output: 'json' },
        ctx,
      );
      const data = (result as { data: { results: { type: string; result: { type: string; value: number } }[] } }).data;
      expect(data.results[0]).toEqual({
        type: 'executeJavascript',
        result: { type: 'number', value: 42 },
      });
    });

    it('should return object result', async () => {
      const obj = { href: 'https://example.com', port: '' };
      (mockPage.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(obj);
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'executeJavascript', script: 'window.location' }], output: 'json' },
        ctx,
      );
      const data = (result as { data: { results: { type: string; result: { type: string; value: object } }[] } }).data;
      expect(data.results[0]).toEqual({
        type: 'executeJavascript',
        result: { type: 'object', value: obj },
      });
    });

    it('should return null result', async () => {
      (mockPage.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'executeJavascript', script: 'document.getElementById("nonexistent")' }], output: 'json' },
        ctx,
      );
      const data = (result as { data: { results: { type: string; result: { type: string; value: null } }[] } }).data;
      expect(data.results[0]).toEqual({
        type: 'executeJavascript',
        result: { type: 'object', value: null },
      });
    });

    it('should return boolean result', async () => {
      (mockPage.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'executeJavascript', script: 'document.readyState === "complete"' }], output: 'json' },
        ctx,
      );
      const data = (result as { data: { results: { type: string; result: { type: string; value: boolean } }[] } }).data;
      expect(data.results[0]).toEqual({
        type: 'executeJavascript',
        result: { type: 'boolean', value: true },
      });
    });
  });

  describe('pdf action', () => {
    it('should generate PDF with defaults', async () => {
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'pdf' }], output: 'json' },
        ctx,
      );
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ landscape: false, scale: 1, format: 'A4' }),
      );
      const data = (result as { data: { results: { type: string; result: string }[] } }).data;
      expect(data.results[0]).toEqual({ type: 'pdf', result: expect.any(String) });
    });

    it('should generate landscape PDF', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'pdf', landscape: true }], output: 'json' },
        ctx,
      );
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ landscape: true }),
      );
    });

    it('should generate PDF with custom format', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'pdf', format: 'Letter' }], output: 'json' },
        ctx,
      );
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'Letter' }),
      );
    });

    it('should generate PDF with custom scale', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'pdf', scale: 0.5 }], output: 'json' },
        ctx,
      );
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ scale: 0.5 }),
      );
    });
  });

  describe('multi-action sequences', () => {
    it('should execute multiple actions in sequence', async () => {
      const cmd = await getHandler();
      const result = await cmd.handler(
        {
          url: 'https://example.com',
          actions: [
            { type: 'wait', milliseconds: 100 },
            { type: 'write', text: 'test' },
            { type: 'click', selector: '#btn' },
            { type: 'scrape' },
          ],
          output: 'json',
        },
        ctx,
      );
      expect(mockPage.keyboard.type).toHaveBeenCalledWith('test');
      expect(mockPage.click).toHaveBeenCalledWith('#btn');

      const data = (result as { data: { results: unknown[] } }).data;
      expect(data.results).toHaveLength(4);
      expect(data.results[0]).toEqual({ type: 'success' });
      expect(data.results[1]).toEqual({ type: 'success' });
      expect(data.results[2]).toEqual({ type: 'success' });
      expect(data.results[3]).toEqual({ type: 'scrape', result: { url: 'https://example.com', html: '<h1>Hello</h1>' } });
    });

    it('should click then scrape (verifying scrape sees post-click state)', async () => {
      const callOrder: string[] = [];
      (mockPage.click as ReturnType<typeof vi.fn>).mockImplementation(async () => { callOrder.push('click'); });
      (mockPage.innerHTML as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('scrape');
        return '<h1>Clicked!</h1>';
      });
      const cmd = await getHandler();
      await cmd.handler(
        {
          url: 'https://example.com',
          actions: [
            { type: 'click', selector: '#btn' },
            { type: 'scrape' },
          ],
          output: 'json',
        },
        ctx,
      );
      expect(callOrder).toEqual(['click', 'scrape']);
    });

    it('should write then press (simulating form submission)', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        {
          url: 'https://example.com',
          actions: [
            { type: 'write', text: 'search query' },
            { type: 'press', key: 'Enter' },
          ],
          output: 'json',
        },
        ctx,
      );
      expect(mockPage.keyboard.type).toHaveBeenCalledWith('search query');
      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Enter');
    });

    it('should scroll then screenshot (verifying scroll happened before capture)', async () => {
      const callOrder: string[] = [];
      (mockPage.evaluate as ReturnType<typeof vi.fn>).mockImplementation(async () => { callOrder.push('scroll'); });
      (mockPage.screenshot as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('screenshot');
        return Buffer.from('scrolled-screenshot');
      });
      const cmd = await getHandler();
      await cmd.handler(
        {
          url: 'https://example.com',
          actions: [
            { type: 'scroll', direction: 'down' },
            { type: 'screenshot' },
          ],
          output: 'json',
        },
        ctx,
      );
      expect(callOrder).toEqual(['scroll', 'screenshot']);
    });

    it('should execute single action', async () => {
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'wait', milliseconds: 50 }], output: 'json' },
        ctx,
      );
      const data = (result as { data: { results: unknown[] } }).data;
      expect(data.results).toHaveLength(1);
      expect(data.results[0]).toEqual({ type: 'success' });
    });

    it('should execute consecutive screenshots', async () => {
      const cmd = await getHandler();
      const result = await cmd.handler(
        {
          url: 'https://example.com',
          actions: [
            { type: 'screenshot' },
            { type: 'scroll', direction: 'down' },
            { type: 'screenshot' },
          ],
          output: 'json',
        },
        ctx,
      );
      const data = (result as { data: { results: { type: string }[] } }).data;
      expect(data.results).toHaveLength(3);
      expect(data.results[0].type).toBe('screenshot');
      expect(data.results[1].type).toBe('success');
      expect(data.results[2].type).toBe('screenshot');
      expect(mockPage.screenshot).toHaveBeenCalledTimes(2);
    });
  });

  describe('output formats', () => {
    it('should return json output by default', async () => {
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'wait', milliseconds: 50 }], output: 'json' },
        ctx,
      );
      const data = (result as { data: Record<string, unknown> }).data;
      expect(data).toHaveProperty('results');
      expect(Array.isArray(data.results)).toBe(true);
    });

    it('should return text output when output=text', async () => {
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'wait', milliseconds: 50 }], output: 'text' },
        ctx,
      );
      const data = (result as { data: Record<string, unknown> }).data;
      expect(data).toHaveProperty('actions');
      expect(typeof data.actions).toBe('string');
      expect(data).not.toHaveProperty('results');
    });
  });

  describe('navigation and metadata', () => {
    it('should navigate to URL before executing actions', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'wait', milliseconds: 50 }], output: 'json' },
        ctx,
      );
      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', { waitUntil: 'domcontentloaded' });
    });

    it('should return final URL and title', async () => {
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'wait', milliseconds: 50 }], output: 'json' },
        ctx,
      );
      const data = (result as { data: { title: string; url: string } }).data;
      expect(data.title).toBe('Example Page');
      expect(data.url).toBe('https://example.com');
      expect(mockPage.title).toHaveBeenCalled();
    });
  });

  describe('validation and error handling', () => {
    it('should reject invalid action type via validation', async () => {
      const cmd = await getHandler();
      const parsed = cmd.parameters!.safeParse({
        url: 'https://example.com',
        actions: [{ type: 'flyAway' }],
        output: 'json',
      });
      expect(parsed.success).toBe(false);
    });

    it('should reject actions array exceeding MAX_ACTIONS (50)', async () => {
      const cmd = await getHandler();
      const manyActions = Array.from({ length: 51 }, () => ({ type: 'wait', milliseconds: 10 }));
      const parsed = cmd.parameters!.safeParse({
        url: 'https://example.com',
        actions: manyActions,
        output: 'json',
      });
      expect(parsed.success).toBe(false);
    });

    it('should accept empty actions array', async () => {
      const cmd = await getHandler();
      const parsed = cmd.parameters!.safeParse({
        url: 'https://example.com',
        actions: [],
        output: 'json',
      });
      expect(parsed.success).toBe(true);
    });

    it('should accept actions array at MAX_ACTIONS boundary (50)', async () => {
      const cmd = await getHandler();
      const boundaryActions = Array.from({ length: 50 }, () => ({ type: 'wait', milliseconds: 10 }));
      const parsed = cmd.parameters!.safeParse({
        url: 'https://example.com',
        actions: boundaryActions,
        output: 'json',
      });
      expect(parsed.success).toBe(true);
    });

    it('should propagate error when selector does not exist (click throws)', async () => {
      (mockPage.click as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Timeout waiting for selector "#nonexistent"'));
      const cmd = await getHandler();
      await expect(
        cmd.handler(
          { url: 'https://example.com', actions: [{ type: 'click', selector: '#nonexistent' }], output: 'json' },
          ctx,
        ),
      ).rejects.toThrow('Timeout waiting for selector "#nonexistent"');
    });

    it('should propagate error when waitForSelector times out', async () => {
      (mockPage.waitForSelector as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Timeout waiting for selector "#never-appears"'));
      const cmd = await getHandler();
      await expect(
        cmd.handler(
          { url: 'https://example.com', actions: [{ type: 'wait', selector: '#never-appears' }], output: 'json' },
          ctx,
        ),
      ).rejects.toThrow('Timeout waiting for selector "#never-appears"');
    });

    it('should propagate error when evaluate throws (executeJavascript)', async () => {
      (mockPage.evaluate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('SyntaxError: Unexpected token'));
      const cmd = await getHandler();
      await expect(
        cmd.handler(
          { url: 'https://example.com', actions: [{ type: 'executeJavascript', script: 'invalid{{' }], output: 'json' },
          ctx,
        ),
      ).rejects.toThrow('SyntaxError');
    });
  });

  describe('edge cases', () => {
    it('should handle executeJavascript returning undefined', async () => {
      (mockPage.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'executeJavascript', script: 'void 0' }], output: 'json' },
        ctx,
      );
      const data = (result as { data: { results: { type: string; result: { type: string; value: undefined } }[] } }).data;
      expect(data.results[0]).toEqual({
        type: 'executeJavascript',
        result: { type: 'undefined', value: undefined },
      });
    });

    it('should handle executeJavascript returning array', async () => {
      const arr = [1, 'two', true];
      (mockPage.evaluate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(arr);
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'executeJavascript', script: '[1, "two", true]' }], output: 'json' },
        ctx,
      );
      const data = (result as { data: { results: { type: string; result: { type: string; value: unknown } }[] } }).data;
      expect(data.results[0]).toEqual({
        type: 'executeJavascript',
        result: { type: 'object', value: arr },
      });
    });

    it('should return base64 encoded screenshot', async () => {
      const fakeBuf = Buffer.from('image-bytes');
      (mockPage.screenshot as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeBuf);
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'screenshot', base64: true }], output: 'json' },
        ctx,
      );
      const data = (result as { data: { results: { type: string; result: string }[] } }).data;
      expect(data.results[0].result).toBe(fakeBuf.toString('base64'));
    });

    it('should return base64 encoded pdf', async () => {
      const fakeBuf = Buffer.from('pdf-bytes');
      (mockPage.pdf as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeBuf);
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'pdf' }], output: 'json' },
        ctx,
      );
      const data = (result as { data: { results: { type: string; result: string }[] } }).data;
      expect(data.results[0].result).toBe(fakeBuf.toString('base64'));
    });

    it('should use default output=json when not specified', async () => {
      const cmd = await getHandler();
      const parsed = cmd.parameters!.safeParse({
        url: 'https://example.com',
        actions: [{ type: 'wait', milliseconds: 50 }],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.output).toBe('json');
      }
    });

    it('should handle scroll defaulting to down when direction omitted', async () => {
      const cmd = await getHandler();
      await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'scroll' }], output: 'json' },
        ctx,
      );
      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), 500);
    });
  });

  describe('timeout parameter', () => {
    it('should default timeout to 60 seconds', async () => {
      const cmd = await getHandler();
      const parsed = cmd.parameters!.safeParse({
        url: 'https://example.com',
        actions: [{ type: 'wait', milliseconds: 50 }],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.timeout).toBe(60);
      }
    });

    it('should accept custom timeout value', async () => {
      const cmd = await getHandler();
      const parsed = cmd.parameters!.safeParse({
        url: 'https://example.com',
        actions: [{ type: 'wait', milliseconds: 50 }],
        timeout: 120,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.timeout).toBe(120);
      }
    });

    it('should include timeout warning when not all actions complete', async () => {
      let resolveWait: () => void;
      const waitPromise = new Promise<void>((r) => { resolveWait = r; });
      (mockPage.waitForSelector as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        await waitPromise;
      });
      const cmd = await getHandler();
      const result = await cmd.handler(
        { url: 'https://example.com', actions: [{ type: 'wait', selector: '#slow' }, { type: 'click', selector: '#btn' }], output: 'json', timeout: 0 },
        ctx,
      );
      const data = (result as { data: Record<string, unknown> }).data;
      expect(data).toHaveProperty('warning');
      resolveWait!();
    });
  });
});
