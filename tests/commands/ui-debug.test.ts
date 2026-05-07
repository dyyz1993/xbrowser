import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserCommandContext } from '../../src/context.js';
import type { Page, CDPSession, BrowserContext } from 'playwright';

function createMockCDPSession(): CDPSession {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    detach: vi.fn().mockResolvedValue(undefined),
    emit(event: string, ...args: unknown[]) {
      (listeners[event] || []).forEach((h) => h(...args));
    },
  } as unknown as CDPSession & { emit: (event: string, ...args: unknown[]) => void };
}

function createMockPage(evaluateResult?: unknown, overrides: Record<string, unknown> = {}): Page {
  const cdpSession = createMockCDPSession();
  const mockContext = {
    newCDPSession: vi.fn().mockResolvedValue(cdpSession),
  } as unknown as BrowserContext;

  return {
    url: vi.fn().mockReturnValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Example Domain'),
    goto: vi.fn().mockResolvedValue({ status: () => 200 }),
    reload: vi.fn().mockResolvedValue(null),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(evaluateResult ?? {}),
    context: vi.fn().mockReturnValue(mockContext),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
    waitForSelector: vi.fn().mockResolvedValue({}),
    locator: vi.fn().mockReturnValue({
      isVisible: vi.fn().mockResolvedValue(true),
      waitFor: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(1),
    }),
    content: vi.fn().mockResolvedValue('<html></html>'),
    ...overrides,
  } as unknown as Page;
}

function createMockContext(page: Page): BrowserCommandContext {
  return {
    page,
    browser: {} as BrowserCommandContext['browser'],
    browserContext: {} as BrowserCommandContext['browserContext'],
    sessionId: 'test-session',
    args: [],
    options: {},
    cwd: '/tmp',
    storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), clear: vi.fn(), keys: vi.fn() },
    output: { mode: 'text', showTips: false, color: false, emoji: false },
    error: vi.fn(),
    config: {},
  } as unknown as BrowserCommandContext;
}

describe('UI Debug Commands', () => {
  describe('consoleCheckCommand', () => {
    let mockPage: Page;
    let ctx: BrowserCommandContext;

    it('should collect console messages and return summary', async () => {
      const consoleMessages = [
        { type: 'log', text: 'hello', location: 'app.js:1', timestamp: '2026-01-01T00:00:00.000Z', stack: '' },
        { type: 'error', text: 'oops', location: 'app.js:5', timestamp: '2026-01-01T00:00:00.000Z', stack: 'Error stack' },
        { type: 'warning', text: 'careful', location: 'app.js:10', timestamp: '2026-01-01T00:00:00.000Z', stack: '' },
      ];
      mockPage = createMockPage(consoleMessages);
      ctx = createMockContext(mockPage);
      const { consoleCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await consoleCheckCommand.handler({ duration: 5000, filter: 'all' }, ctx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          total: 3,
          errors: 1,
          warnings: 1,
          passed: false,
          summary: '3 messages (1 errors, 1 warnings)',
        }),
        tips: [],
      });
    });

    it('should filter by error type', async () => {
      const consoleMessages = [
        { type: 'log', text: 'hello', location: '', timestamp: '', stack: '' },
        { type: 'error', text: 'fail', location: '', timestamp: '', stack: '' },
      ];
      mockPage = createMockPage(consoleMessages);
      ctx = createMockContext(mockPage);
      const { consoleCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await consoleCheckCommand.handler({ duration: 5000, filter: 'error' }, ctx);
      const data = (result as { data: { messages: Array<{ type: string }> } }).data;
      expect(data.messages.length).toBe(1);
      expect(data.messages[0].type).toBe('error');
    });

    it('should filter by warning type', async () => {
      const consoleMessages = [
        { type: 'log', text: 'hello', location: '', timestamp: '', stack: '' },
        { type: 'warning', text: 'careful', location: '', timestamp: '', stack: '' },
      ];
      mockPage = createMockPage(consoleMessages);
      ctx = createMockContext(mockPage);
      const { consoleCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await consoleCheckCommand.handler({ duration: 5000, filter: 'warning' }, ctx);
      const data = (result as { data: { messages: Array<{ type: string }> } }).data;
      expect(data.messages.length).toBe(1);
      expect(data.messages[0].type).toBe('warning');
    });

    it('should pass when no errors exist', async () => {
      const consoleMessages = [
        { type: 'log', text: 'hello', location: '', timestamp: '', stack: '' },
      ];
      mockPage = createMockPage(consoleMessages);
      ctx = createMockContext(mockPage);
      const { consoleCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await consoleCheckCommand.handler({ duration: 5000, filter: 'all' }, ctx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: true, errors: 0 }),
        tips: [],
      });
    });

    it('should exclude stack traces when includeStackTraces is false', async () => {
      const consoleMessages = [
        { type: 'error', text: 'fail', location: '', timestamp: '', stack: 'Error stack' },
      ];
      mockPage = createMockPage(consoleMessages);
      ctx = createMockContext(mockPage);
      const { consoleCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await consoleCheckCommand.handler({ duration: 5000, filter: 'all', includeStackTraces: false }, ctx);
      const data = (result as { data: { messages: Array<Record<string, unknown>> } }).data;
      expect(data.messages[0]).not.toHaveProperty('stack');
    });

    it('should navigate to URL when provided', async () => {
      mockPage = createMockPage([]);
      ctx = createMockContext(mockPage);
      const { consoleCheckCommand } = await import('../../src/commands/ui-debug.js');
      await consoleCheckCommand.handler({ url: 'https://test.com', duration: 5000, filter: 'all' }, ctx);
      expect(mockPage.goto).toHaveBeenCalledWith('https://test.com', { waitUntil: 'domcontentloaded' });
    });

    it('should return empty messages when no console output', async () => {
      mockPage = createMockPage([]);
      ctx = createMockContext(mockPage);
      const { consoleCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await consoleCheckCommand.handler({ duration: 5000, filter: 'all' }, ctx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ total: 0, passed: true }),
        tips: [],
      });
    });
  });

  describe('networkCheckCommand', () => {
    let mockPage: Page;
    let ctx: BrowserCommandContext;

    beforeEach(() => {
      mockPage = createMockPage();
      ctx = createMockContext(mockPage);
    });

    it('should enable network monitoring via CDP', async () => {
      const { networkCheckCommand } = await import('../../src/commands/ui-debug.js');
      await networkCheckCommand.handler({ duration: 1000, filter: 'all' }, ctx);
      const cdpSession = await (mockPage.context() as unknown as { newCDPSession: () => Promise<CDPSession> }).newCDPSession();
      expect(cdpSession.send).toHaveBeenCalledWith('Network.enable');
    });

    it('should navigate to URL when provided', async () => {
      const { networkCheckCommand } = await import('../../src/commands/ui-debug.js');
      await networkCheckCommand.handler({ url: 'https://test.com', duration: 1000, filter: 'all' }, ctx);
      expect(mockPage.goto).toHaveBeenCalledWith('https://test.com', { waitUntil: 'domcontentloaded' });
    });

    it('should reload page when no URL provided', async () => {
      const { networkCheckCommand } = await import('../../src/commands/ui-debug.js');
      await networkCheckCommand.handler({ duration: 1000, filter: 'all' }, ctx);
      expect(mockPage.reload).toHaveBeenCalledWith({ waitUntil: 'domcontentloaded' });
    });

    it('should return network summary with zero requests', async () => {
      const { networkCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await networkCheckCommand.handler({ duration: 1000, filter: 'all' }, ctx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          totalRequests: 0,
          failedRequests: 0,
          passed: true,
        }),
        tips: [],
      });
    });

    it('should detach CDP session after completion', async () => {
      const { networkCheckCommand } = await import('../../src/commands/ui-debug.js');
      await networkCheckCommand.handler({ duration: 1000, filter: 'all' }, ctx);
      const cdpSession = await (mockPage.context() as unknown as { newCDPSession: () => Promise<CDPSession> }).newCDPSession();
      expect(cdpSession.detach).toHaveBeenCalled();
    });

    it('should capture requests from CDP events', async () => {
      const cdpSession = createMockCDPSession();
      const contextWithCdp = {
        newCDPSession: vi.fn().mockResolvedValue(cdpSession),
      } as unknown as BrowserContext;

      let resolveWait: () => void;
      const waitPromise = new Promise<void>((resolve) => { resolveWait = resolve; });

      const pageWithCdp = createMockPage(undefined, {
        context: vi.fn().mockReturnValue(contextWithCdp),
        waitForTimeout: vi.fn().mockReturnValue(waitPromise),
      });
      const ctxWithCdp = createMockContext(pageWithCdp);

      const { networkCheckCommand } = await import('../../src/commands/ui-debug.js');

      const handlerPromise = networkCheckCommand.handler({ duration: 1000, filter: 'all' }, ctxWithCdp);

      await vi.waitFor(() => {
        expect(cdpSession.on).toHaveBeenCalledWith('Network.requestWillBeSent', expect.any(Function));
      });

      (cdpSession as unknown as { emit: (e: string, ...a: unknown[]) => void }).emit('Network.requestWillBeSent', {
        requestId: '1',
        request: { url: 'https://example.com/style.css', method: 'GET' },
        type: 'stylesheet',
      });

      (cdpSession as unknown as { emit: (e: string, ...a: unknown[]) => void }).emit('Network.responseReceived', {
        requestId: '1',
        response: { status: 200, mimeType: 'text/css', encodedDataLength: 1024 },
      });

      resolveWait!();
      const result = await handlerPromise;
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          totalRequests: 1,
          failedRequests: 0,
        }),
        tips: [],
      });
    });

    it('should capture failed requests from CDP events', async () => {
      const cdpSession = createMockCDPSession();
      const contextWithCdp = {
        newCDPSession: vi.fn().mockResolvedValue(cdpSession),
      } as unknown as BrowserContext;

      let resolveWait: () => void;
      const waitPromise = new Promise<void>((resolve) => { resolveWait = resolve; });

      const pageWithCdp = createMockPage(undefined, {
        context: vi.fn().mockReturnValue(contextWithCdp),
        waitForTimeout: vi.fn().mockReturnValue(waitPromise),
      });
      const ctxWithCdp = createMockContext(pageWithCdp);

      const { networkCheckCommand } = await import('../../src/commands/ui-debug.js');

      const handlerPromise = networkCheckCommand.handler({ duration: 1000, filter: 'all' }, ctxWithCdp);

      await vi.waitFor(() => {
        expect(cdpSession.on).toHaveBeenCalledWith('Network.requestWillBeSent', expect.any(Function));
      });

      (cdpSession as unknown as { emit: (e: string, ...a: unknown[]) => void }).emit('Network.requestWillBeSent', {
        requestId: '2',
        request: { url: 'https://example.com/missing.js', method: 'GET' },
        type: 'script',
      });

      (cdpSession as unknown as { emit: (e: string, ...a: unknown[]) => void }).emit('Network.loadingFailed', {
        requestId: '2',
        errorText: 'net::ERR_CONNECTION_REFUSED',
      });

      resolveWait!();
      const result = await handlerPromise;
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          totalRequests: 1,
          failedRequests: 1,
          passed: false,
        }),
        tips: [],
      });
    });

    it('should filter by failed requests', async () => {
      const { networkCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await networkCheckCommand.handler({ duration: 1000, filter: 'failed' }, ctx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: true }),
        tips: [],
      });
    });

    it('should filter by slow requests', async () => {
      const { networkCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await networkCheckCommand.handler({ duration: 1000, filter: 'slow', slowThreshold: 3000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: true }),
        tips: [],
      });
    });
  });

  describe('perfCheckCommand', () => {
    let mockPage: Page;
    let ctx: BrowserCommandContext;

    beforeEach(() => {
      mockPage = createMockPage();
      ctx = createMockContext(mockPage);
    });

    it('should return performance metrics', async () => {
      const perfData = {
        ttfb: 120,
        domContentLoaded: 500,
        loadComplete: 800,
        fcp: 300,
        lcp: 600,
        domInteractive: 400,
        transferSize: 50000,
        decodedBodySize: 150000,
        resourceStats: { total: 10, totalSize: 50000, byType: {} },
      };
      const perfPage = createMockPage(perfData);
      const perfCtx = createMockContext(perfPage);
      const { perfCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await perfCheckCommand.handler({ iterations: 1 }, perfCtx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          passed: true,
          iterations: 1,
          metrics: perfData,
          summary: 'TTFB: 120ms | FCP: 300ms | Load: 800ms',
        }),
        tips: [],
      });
    });

    it('should navigate to URL when provided', async () => {
      const perfPage = createMockPage({
        ttfb: 100, domContentLoaded: 300, loadComplete: 500,
        fcp: 200, lcp: 400, domInteractive: 250,
        transferSize: 1000, decodedBodySize: 2000,
        resourceStats: { total: 0, totalSize: 0, byType: {} },
      });
      const perfCtx = createMockContext(perfPage);
      const { perfCheckCommand } = await import('../../src/commands/ui-debug.js');
      await perfCheckCommand.handler({ url: 'https://test.com', iterations: 1 }, perfCtx);
      expect(perfPage.goto).toHaveBeenCalledWith('https://test.com', { waitUntil: 'load' });
    });

    it('should reload page when no URL provided', async () => {
      const perfPage = createMockPage({
        ttfb: 100, domContentLoaded: 300, loadComplete: 500,
        fcp: 200, lcp: 400, domInteractive: 250,
        transferSize: 1000, decodedBodySize: 2000,
        resourceStats: { total: 0, totalSize: 0, byType: {} },
      });
      const perfCtx = createMockContext(perfPage);
      const { perfCheckCommand } = await import('../../src/commands/ui-debug.js');
      await perfCheckCommand.handler({ iterations: 1 }, perfCtx);
      expect(perfPage.reload).toHaveBeenCalledWith({ waitUntil: 'load' });
    });

    it('should average metrics across multiple iterations', async () => {
      let callCount = 0;
      const evaluateReturns = [
        { ttfb: 100, domContentLoaded: 200, loadComplete: 300, fcp: 150, lcp: 250, domInteractive: 180, transferSize: 1000, decodedBodySize: 2000, resourceStats: { total: 0, totalSize: 0, byType: {} } },
        undefined,
        { ttfb: 200, domContentLoaded: 400, loadComplete: 600, fcp: 300, lcp: 500, domInteractive: 360, transferSize: 2000, decodedBodySize: 4000, resourceStats: { total: 2, totalSize: 1000, byType: {} } },
      ];
      const multiPage = createMockPage();
      (multiPage.evaluate as ReturnType<typeof vi.fn>).mockImplementation(() => {
        const result = evaluateReturns[callCount];
        callCount++;
        return Promise.resolve(result);
      });
      const multiCtx = createMockContext(multiPage);
      const { perfCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await perfCheckCommand.handler({ iterations: 2 }, multiCtx);
      const data = (result as { data: { metrics: Record<string, unknown>; allIterations: unknown[] } }).data;
      expect(data.metrics.ttfb).toBe(150);
      expect(data.metrics.domContentLoaded).toBe(300);
      expect(data.allIterations).toBeDefined();
      expect(data.allIterations!.length).toBe(2);
    });

    it('should handle null navigation timing entries', async () => {
      const nullPerfData = {
        ttfb: null, domContentLoaded: null, loadComplete: null,
        fcp: null, lcp: null, domInteractive: null,
        transferSize: 0, decodedBodySize: 0,
        resourceStats: { total: 0, totalSize: 0, byType: {} },
      };
      const nullPage = createMockPage(nullPerfData);
      const nullCtx = createMockContext(nullPage);
      const { perfCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await perfCheckCommand.handler({ iterations: 1 }, nullCtx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          passed: true,
          summary: 'TTFB: nullms | FCP: nullms | Load: nullms',
        }),
        tips: [],
      });
    });

    it('should not include allIterations for single run', async () => {
      const perfData = {
        ttfb: 100, domContentLoaded: 200, loadComplete: 300,
        fcp: 150, lcp: 250, domInteractive: 180,
        transferSize: 1000, decodedBodySize: 2000,
        resourceStats: { total: 0, totalSize: 0, byType: {} },
      };
      const singlePage = createMockPage(perfData);
      const singleCtx = createMockContext(singlePage);
      const { perfCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await perfCheckCommand.handler({ iterations: 1 }, singleCtx);
      const data = (result as { data: { allIterations: unknown } }).data;
      expect(data.allIterations).toBeUndefined();
    });
  });

  describe('healthCheckCommand', () => {
    let mockPage: Page;
    let ctx: BrowserCommandContext;

    beforeEach(() => {
      mockPage = createMockPage();
      ctx = createMockContext(mockPage);
    });

    it('should navigate to URL when provided', async () => {
      const healthPage = createMockPage({ issues: [], url: 'https://test.com', title: 'Test' });
      const healthCtx = createMockContext(healthPage);
      const { healthCheckCommand } = await import('../../src/commands/ui-debug.js');
      await healthCheckCommand.handler({ url: 'https://test.com', checkLinks: false, checkImages: true, checkMeta: true }, healthCtx);
      expect(healthPage.goto).toHaveBeenCalledWith('https://test.com', { waitUntil: 'load' });
    });

    it('should return passing result with no issues', async () => {
      const healthPage = createMockPage({ issues: [], url: 'https://example.com', title: 'Good Page' });
      const healthCtx = createMockContext(healthPage);
      const { healthCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await healthCheckCommand.handler({ checkLinks: false, checkImages: true, checkMeta: true }, healthCtx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          passed: true,
          totalIssues: 0,
          errors: 0,
          warnings: 0,
        }),
        tips: [],
      });
    });

    it('should detect image issues', async () => {
      const healthPage = createMockPage({
        issues: [
          { severity: 'error', category: 'images', message: 'Broken image: broken.png', element: '<img src="broken.png">' },
        ],
        url: 'https://example.com',
        title: 'Bad Images',
      });
      const healthCtx = createMockContext(healthPage);
      const { healthCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await healthCheckCommand.handler({ checkLinks: false, checkImages: true, checkMeta: false }, healthCtx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          passed: false,
          errors: 1,
          totalIssues: 1,
        }),
        tips: [],
      });
    });

    it('should detect SEO issues', async () => {
      const healthPage = createMockPage({
        issues: [
          { severity: 'error', category: 'seo', message: 'Missing <title> tag' },
          { severity: 'warning', category: 'seo', message: 'Missing meta description' },
        ],
        url: 'https://example.com',
        title: 'No SEO',
      });
      const healthCtx = createMockContext(healthPage);
      const { healthCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await healthCheckCommand.handler({ checkLinks: false, checkImages: false, checkMeta: true }, healthCtx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          passed: false,
          errors: 1,
          warnings: 1,
        }),
        tips: [],
      });
    });

    it('should detect broken links', async () => {
      const healthPage = createMockPage({
        issues: [
          { severity: 'error', category: 'links', message: 'Broken link (404): https://example.com/missing' },
        ],
        url: 'https://example.com',
        title: 'Broken Links',
      });
      const healthCtx = createMockContext(healthPage);
      const { healthCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await healthCheckCommand.handler({ checkLinks: true, checkImages: false, checkMeta: false }, healthCtx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          passed: false,
          errors: 1,
        }),
        tips: [],
      });
    });

    it('should respect checkLinks=false to skip link checking', async () => {
      const healthPage = createMockPage({ issues: [], url: 'https://example.com', title: 'OK' });
      const healthCtx = createMockContext(healthPage);
      const { healthCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await healthCheckCommand.handler({ checkLinks: false, checkImages: false, checkMeta: false }, healthCtx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: true }),
        tips: [],
      });
    });

    it('should report info-level issues', async () => {
      const healthPage = createMockPage({
        issues: [
          { severity: 'info', category: 'seo', message: 'Missing canonical URL' },
        ],
        url: 'https://example.com',
        title: 'No Canonical',
      });
      const healthCtx = createMockContext(healthPage);
      const { healthCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await healthCheckCommand.handler({ checkLinks: false, checkImages: false, checkMeta: true }, healthCtx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          passed: true,
          info: 1,
          totalIssues: 1,
        }),
        tips: [],
      });
    });

    it('should pass maxLinks to evaluate', async () => {
      const healthPage = createMockPage({ issues: [], url: 'https://example.com', title: 'OK' });
      const healthCtx = createMockContext(healthPage);
      const { healthCheckCommand } = await import('../../src/commands/ui-debug.js');
      await healthCheckCommand.handler({ checkLinks: true, checkImages: false, checkMeta: false, maxLinks: 10 }, healthCtx);
      const evalCalls = (healthPage.evaluate as ReturnType<typeof vi.fn>).mock.calls;
      expect(evalCalls[0][1]).toEqual(expect.objectContaining({ maxLinks: 10 }));
    });

    it('should return correct summary format', async () => {
      const healthPage = createMockPage({
        issues: [
          { severity: 'error', category: 'images', message: 'broken' },
          { severity: 'warning', category: 'seo', message: 'no meta' },
        ],
        url: 'https://example.com',
        title: 'Issues',
      });
      const healthCtx = createMockContext(healthPage);
      const { healthCheckCommand } = await import('../../src/commands/ui-debug.js');
      const result = await healthCheckCommand.handler({ checkLinks: false, checkImages: true, checkMeta: true }, healthCtx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          summary: '2 issues found (1 errors, 1 warnings)',
        }),
        tips: [],
      });
    });
  });
});
