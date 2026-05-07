import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserCommandContext } from '../../src/context.js';
import type { Page, Locator } from 'playwright';

function createMockLocator(overrides: Partial<Locator> = {}): Locator {
  return {
    waitFor: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(true),
    isChecked: vi.fn().mockResolvedValue(false),
    isEnabled: vi.fn().mockResolvedValue(true),
    count: vi.fn().mockResolvedValue(1),
    first: vi.fn().mockReturnValue({
      getAttribute: vi.fn().mockResolvedValue(''),
      evaluate: vi.fn().mockResolvedValue(''),
      isEnabled: vi.fn().mockResolvedValue(true),
      isChecked: vi.fn().mockResolvedValue(false),
    }),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
    ...overrides,
  } as unknown as Locator;
}

function createMockPage(overrides: Record<string, unknown> = {}): Page {
  const locator = createMockLocator();
  return {
    url: vi.fn().mockReturnValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Example Domain'),
    textContent: vi.fn().mockResolvedValue('Hello World'),
    locator: vi.fn().mockReturnValue(locator),
    goto: vi.fn().mockResolvedValue({ status: () => 200 }),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue({}),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
    evaluate: vi.fn().mockResolvedValue({}),
    reload: vi.fn().mockResolvedValue(null),
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

describe('UI Test Commands', () => {
  describe('assertCommand', () => {
    let mockPage: Page;
    let ctx: BrowserCommandContext;

    beforeEach(() => {
      mockPage = createMockPage();
      ctx = createMockContext(mockPage);
    });

    it('text: should pass when page contains expected text', async () => {
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'text', value: 'Hello', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: { passed: true, type: 'text', actual: 'Hello World', message: 'Page text contains "Hello"' },
        tips: [],
      });
    });

    it('text: should fail when page does not contain expected text', async () => {
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'text', value: 'Goodbye', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: false, type: 'text' }),
        tips: [],
      });
    });

    it('visible: should pass when element is visible', async () => {
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'visible', selector: '#btn', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: { passed: true, type: 'visible', actual: 'visible', message: 'Element "#btn" is visible' },
        tips: [],
      });
    });

    it('visible: should fail when element wait throws', async () => {
      const failingLocator = createMockLocator({
        waitFor: vi.fn().mockRejectedValue(new Error('timeout exceeded')),
      });
      (mockPage.locator as ReturnType<typeof vi.fn>).mockReturnValue(failingLocator);
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'visible', selector: '#missing', timeout: 1000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: false, type: 'visible' }),
        tips: [],
      });
    });

    it('hidden: should pass when element is hidden', async () => {
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'hidden', selector: '.hidden-el', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: { passed: true, type: 'hidden', actual: 'hidden', message: 'Element ".hidden-el" is hidden' },
        tips: [],
      });
    });

    it('hidden: should fail when element wait throws', async () => {
      const failingLocator = createMockLocator({
        waitFor: vi.fn().mockRejectedValue(new Error('still visible')),
      });
      (mockPage.locator as ReturnType<typeof vi.fn>).mockReturnValue(failingLocator);
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'hidden', selector: '.always-visible', timeout: 1000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: false, type: 'hidden' }),
        tips: [],
      });
    });

    it('url: should pass when URL contains expected value', async () => {
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'url', value: 'example.com', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: { passed: true, type: 'url', actual: 'https://example.com', message: 'URL contains "example.com"' },
        tips: [],
      });
    });

    it('url: should fail when URL does not contain expected value', async () => {
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'url', value: 'google.com', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: false, type: 'url' }),
        tips: [],
      });
    });

    it('title: should pass when title contains expected value', async () => {
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'title', value: 'Example', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: { passed: true, type: 'title', actual: 'Example Domain', message: 'Title contains "Example"' },
        tips: [],
      });
    });

    it('title: should fail when title does not contain expected value', async () => {
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'title', value: 'Google', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: false, type: 'title' }),
        tips: [],
      });
    });

    it('count: should pass when element count matches expected', async () => {
      const locator5 = createMockLocator({ count: vi.fn().mockResolvedValue(5) });
      (mockPage.locator as ReturnType<typeof vi.fn>).mockReturnValue(locator5);
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'count', selector: 'li', expected: 5, timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: { passed: true, type: 'count', actual: '5', message: 'Element count: 5 == 5' },
        tips: [],
      });
    });

    it('count: should fail when element count does not match', async () => {
      const locator3 = createMockLocator({ count: vi.fn().mockResolvedValue(3) });
      (mockPage.locator as ReturnType<typeof vi.fn>).mockReturnValue(locator3);
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'count', selector: 'li', expected: 5, timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: false, type: 'count' }),
        tips: [],
      });
    });

    it('attribute: should pass when attribute value matches', async () => {
      const attrLocator = createMockLocator({
        first: vi.fn().mockReturnValue({
          getAttribute: vi.fn().mockResolvedValue('active'),
          evaluate: vi.fn().mockResolvedValue(''),
          isEnabled: vi.fn().mockResolvedValue(true),
          isChecked: vi.fn().mockResolvedValue(false),
        }),
      });
      (mockPage.locator as ReturnType<typeof vi.fn>).mockReturnValue(attrLocator);
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'attribute', selector: '#btn', value: 'class', expected: 'active', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: { passed: true, type: 'attribute', actual: 'active', message: 'Attribute "class": "active" == "active"' },
        tips: [],
      });
    });

    it('attribute: should fail when attribute value does not match', async () => {
      const attrLocator = createMockLocator({
        first: vi.fn().mockReturnValue({
          getAttribute: vi.fn().mockResolvedValue('inactive'),
          evaluate: vi.fn().mockResolvedValue(''),
          isEnabled: vi.fn().mockResolvedValue(true),
          isChecked: vi.fn().mockResolvedValue(false),
        }),
      });
      (mockPage.locator as ReturnType<typeof vi.fn>).mockReturnValue(attrLocator);
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'attribute', selector: '#btn', value: 'class', expected: 'active', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: false, type: 'attribute' }),
        tips: [],
      });
    });

    it('css: should pass when CSS property matches', async () => {
      const cssLocator = createMockLocator({
        first: vi.fn().mockReturnValue({
          getAttribute: vi.fn().mockResolvedValue(''),
          evaluate: vi.fn().mockResolvedValue('rgb(255, 0, 0)'),
          isEnabled: vi.fn().mockResolvedValue(true),
          isChecked: vi.fn().mockResolvedValue(false),
        }),
      });
      (mockPage.locator as ReturnType<typeof vi.fn>).mockReturnValue(cssLocator);
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'css', selector: '#box', value: 'color', expected: 'rgb(255, 0, 0)', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: { passed: true, type: 'css', actual: 'rgb(255, 0, 0)', message: 'CSS "color": "rgb(255, 0, 0)" == "rgb(255, 0, 0)"' },
        tips: [],
      });
    });

    it('css: should fail when CSS property does not match', async () => {
      const cssLocator = createMockLocator({
        first: vi.fn().mockReturnValue({
          getAttribute: vi.fn().mockResolvedValue(''),
          evaluate: vi.fn().mockResolvedValue('rgb(0, 0, 0)'),
          isEnabled: vi.fn().mockResolvedValue(true),
          isChecked: vi.fn().mockResolvedValue(false),
        }),
      });
      (mockPage.locator as ReturnType<typeof vi.fn>).mockReturnValue(cssLocator);
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'css', selector: '#box', value: 'color', expected: 'rgb(255, 0, 0)', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: false, type: 'css' }),
        tips: [],
      });
    });

    it('enabled: should pass when element is enabled', async () => {
      const enabledLocator = createMockLocator({
        first: vi.fn().mockReturnValue({
          getAttribute: vi.fn().mockResolvedValue(''),
          evaluate: vi.fn().mockResolvedValue(''),
          isEnabled: vi.fn().mockResolvedValue(true),
          isChecked: vi.fn().mockResolvedValue(false),
        }),
      });
      (mockPage.locator as ReturnType<typeof vi.fn>).mockReturnValue(enabledLocator);
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'enabled', selector: '#btn', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: { passed: true, type: 'enabled', actual: 'true', message: 'Element "#btn" is enabled' },
        tips: [],
      });
    });

    it('enabled: should fail when element is disabled', async () => {
      const disabledLocator = createMockLocator({
        first: vi.fn().mockReturnValue({
          getAttribute: vi.fn().mockResolvedValue(''),
          evaluate: vi.fn().mockResolvedValue(''),
          isEnabled: vi.fn().mockResolvedValue(false),
          isChecked: vi.fn().mockResolvedValue(false),
        }),
      });
      (mockPage.locator as ReturnType<typeof vi.fn>).mockReturnValue(disabledLocator);
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'enabled', selector: '#btn', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: { passed: false, type: 'enabled', actual: 'false', expected: '', message: 'Element "#btn" is disabled' },
        tips: [],
      });
    });

    it('checked: should pass when element is checked', async () => {
      const checkedLocator = createMockLocator({
        first: vi.fn().mockReturnValue({
          getAttribute: vi.fn().mockResolvedValue(''),
          evaluate: vi.fn().mockResolvedValue(''),
          isEnabled: vi.fn().mockResolvedValue(true),
          isChecked: vi.fn().mockResolvedValue(true),
        }),
      });
      (mockPage.locator as ReturnType<typeof vi.fn>).mockReturnValue(checkedLocator);
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'checked', selector: '#checkbox', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: { passed: true, type: 'checked', actual: 'true', message: 'Element "#checkbox" is checked' },
        tips: [],
      });
    });

    it('checked: should fail when element is unchecked', async () => {
      const uncheckedLocator = createMockLocator({
        first: vi.fn().mockReturnValue({
          getAttribute: vi.fn().mockResolvedValue(''),
          evaluate: vi.fn().mockResolvedValue(''),
          isEnabled: vi.fn().mockResolvedValue(true),
          isChecked: vi.fn().mockResolvedValue(false),
        }),
      });
      (mockPage.locator as ReturnType<typeof vi.fn>).mockReturnValue(uncheckedLocator);
      const { assertCommand } = await import('../../src/commands/ui-test.js');
      const result = await assertCommand.handler({ type: 'checked', selector: '#checkbox', timeout: 5000 }, ctx);
      expect(result).toEqual({
        success: true,
        data: { passed: false, type: 'checked', actual: 'false', expected: '', message: 'Element "#checkbox" is unchecked' },
        tips: [],
      });
    });
  });

  describe('visualDiffCommand', () => {
    let mockPage: Page;
    let ctx: BrowserCommandContext;

    beforeEach(() => {
      vi.resetModules();
    });

    it('should fail when baseline file does not exist', async () => {
      vi.doMock('node:fs', () => ({
        readFileSync: vi.fn().mockImplementation(() => {
          const err = new Error('ENOENT') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }),
        writeFileSync: vi.fn(),
      }));

      mockPage = createMockPage();
      ctx = createMockContext(mockPage);
      const { visualDiffCommand } = await import('../../src/commands/ui-test.js');
      const result = await visualDiffCommand.handler(
        { baseline: '/tmp/missing.png', threshold: 0.1, fullPage: false },
        ctx,
      );
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          passed: false,
          diffPercentage: 100,
          message: 'Baseline file not found: /tmp/missing.png',
        }),
        tips: [],
      });
    });

    it('should fail when baseline file is unreadable', async () => {
      vi.doMock('node:fs', () => ({
        readFileSync: vi.fn().mockImplementation(() => {
          const err = new Error('Permission denied') as NodeJS.ErrnoException;
          err.code = 'EACCES';
          throw err;
        }),
        writeFileSync: vi.fn(),
      }));

      mockPage = createMockPage();
      ctx = createMockContext(mockPage);
      const { visualDiffCommand } = await import('../../src/commands/ui-test.js');
      const result = await visualDiffCommand.handler(
        { baseline: '/tmp/no-access.png', threshold: 0.1, fullPage: false },
        ctx,
      );
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          passed: false,
          message: 'Baseline file unreadable: /tmp/no-access.png',
        }),
        tips: [],
      });
    });

    it('should pass when diff is within threshold', async () => {
      vi.doMock('node:fs', () => ({
        readFileSync: vi.fn().mockReturnValue(Buffer.from('baseline-png')),
        writeFileSync: vi.fn(),
      }));

      mockPage = createMockPage({
        evaluate: vi.fn().mockResolvedValue({
          diffPercentage: 3.5,
          diffPixels: 350,
          totalPixels: 10000,
          diffBase64: 'diffbase64data',
        }),
      });
      ctx = createMockContext(mockPage);
      const { visualDiffCommand } = await import('../../src/commands/ui-test.js');
      const result = await visualDiffCommand.handler(
        { baseline: '/tmp/baseline.png', threshold: 0.1, fullPage: false },
        ctx,
      );
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          passed: true,
          diffPercentage: 3.5,
          message: expect.stringContaining('Visual test passed'),
        }),
        tips: [],
      });
    });

    it('should fail when diff exceeds threshold', async () => {
      vi.doMock('node:fs', () => ({
        readFileSync: vi.fn().mockReturnValue(Buffer.from('baseline-png')),
        writeFileSync: vi.fn(),
      }));

      mockPage = createMockPage({
        evaluate: vi.fn().mockResolvedValue({
          diffPercentage: 25.0,
          diffPixels: 2500,
          totalPixels: 10000,
          diffBase64: 'diffbase64data',
        }),
      });
      ctx = createMockContext(mockPage);
      const { visualDiffCommand } = await import('../../src/commands/ui-test.js');
      const result = await visualDiffCommand.handler(
        { baseline: '/tmp/baseline.png', threshold: 0.1, fullPage: false },
        ctx,
      );
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          passed: false,
          diffPercentage: 25,
          message: expect.stringContaining('Visual test FAILED'),
        }),
        tips: [],
      });
    });

    it('should save diff image when output path provided', async () => {
      const writeFileSync = vi.fn();
      vi.doMock('node:fs', () => ({
        readFileSync: vi.fn().mockReturnValue(Buffer.from('baseline-png')),
        writeFileSync,
      }));

      mockPage = createMockPage({
        evaluate: vi.fn().mockResolvedValue({
          diffPercentage: 5.0,
          diffPixels: 500,
          totalPixels: 10000,
          diffBase64: 'diffbase64data',
        }),
      });
      ctx = createMockContext(mockPage);
      const { visualDiffCommand } = await import('../../src/commands/ui-test.js');
      const result = await visualDiffCommand.handler(
        { baseline: '/tmp/baseline.png', threshold: 0.1, fullPage: false, output: '/tmp/diff.png' },
        ctx,
      );
      expect(writeFileSync).toHaveBeenCalledWith('/tmp/diff.png', expect.any(Buffer));
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ diffImage: '/tmp/diff.png' }),
        tips: [],
      });
    });

    it('should use element screenshot when selector provided', async () => {
      vi.doMock('node:fs', () => ({
        readFileSync: vi.fn().mockReturnValue(Buffer.from('baseline-png')),
        writeFileSync: vi.fn(),
      }));

      const elementScreenshot = vi.fn().mockResolvedValue(Buffer.from('element-png'));
      const locatorWithScreenshot = createMockLocator({ screenshot: elementScreenshot });
      mockPage = createMockPage({
        locator: vi.fn().mockReturnValue(locatorWithScreenshot),
        evaluate: vi.fn().mockResolvedValue({
          diffPercentage: 0,
          diffPixels: 0,
          totalPixels: 10000,
          diffBase64: '',
        }),
      });
      ctx = createMockContext(mockPage);
      const { visualDiffCommand } = await import('../../src/commands/ui-test.js');
      await visualDiffCommand.handler(
        { baseline: '/tmp/baseline.png', threshold: 0.1, selector: '#hero', fullPage: false },
        ctx,
      );
      expect(elementScreenshot).toHaveBeenCalledWith({ type: 'png', fullPage: false });
    });
  });

  describe('testSuiteCommand', () => {
    let mockPage: Page;
    let ctx: BrowserCommandContext;

    beforeEach(() => {
      mockPage = createMockPage();
      ctx = createMockContext(mockPage);
    });

    it('should execute goto step', async () => {
      const { testSuiteCommand } = await import('../../src/commands/ui-test.js');
      const result = await testSuiteCommand.handler(
        { steps: [{ action: 'goto', url: 'https://example.com' }], stopOnFailure: true },
        ctx,
      );
      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', { waitUntil: 'domcontentloaded' });
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          passed: true,
          totalSteps: 1,
          passedSteps: 1,
          failedSteps: 0,
        }),
        tips: [],
      });
    });

    it('should execute click step', async () => {
      const { testSuiteCommand } = await import('../../src/commands/ui-test.js');
      const result = await testSuiteCommand.handler(
        { steps: [{ action: 'click', selector: '#btn' }], stopOnFailure: true },
        ctx,
      );
      expect(mockPage.click).toHaveBeenCalledWith('#btn');
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: true }),
        tips: [],
      });
    });

    it('should execute fill step', async () => {
      const { testSuiteCommand } = await import('../../src/commands/ui-test.js');
      const result = await testSuiteCommand.handler(
        { steps: [{ action: 'fill', selector: '#input', value: 'hello' }], stopOnFailure: true },
        ctx,
      );
      expect(mockPage.fill).toHaveBeenCalledWith('#input', 'hello');
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: true }),
        tips: [],
      });
    });

    it('should execute wait step with selector', async () => {
      const { testSuiteCommand } = await import('../../src/commands/ui-test.js');
      const result = await testSuiteCommand.handler(
        { steps: [{ action: 'wait', selector: '.loaded', timeout: 5000 }], stopOnFailure: true },
        ctx,
      );
      expect(mockPage.waitForSelector).toHaveBeenCalledWith('.loaded', { timeout: 5000 });
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: true }),
        tips: [],
      });
    });

    it('should execute wait step with timeout value', async () => {
      const { testSuiteCommand } = await import('../../src/commands/ui-test.js');
      const result = await testSuiteCommand.handler(
        { steps: [{ action: 'wait', value: '2000' }], stopOnFailure: true },
        ctx,
      );
      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(2000);
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: true }),
        tips: [],
      });
    });

    it('should execute assert step with title', async () => {
      const { testSuiteCommand } = await import('../../src/commands/ui-test.js');
      const result = await testSuiteCommand.handler(
        { steps: [{ action: 'assert', value: 'title', selector: 'Example' }], stopOnFailure: true },
        ctx,
      );
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: true }),
        tips: [],
      });
    });

    it('should execute assert step with url', async () => {
      const { testSuiteCommand } = await import('../../src/commands/ui-test.js');
      const result = await testSuiteCommand.handler(
        { steps: [{ action: 'assert', value: 'url', selector: 'example.com' }], stopOnFailure: true },
        ctx,
      );
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: true }),
        tips: [],
      });
    });

    it('should execute assert step with visible', async () => {
      const { testSuiteCommand } = await import('../../src/commands/ui-test.js');
      const result = await testSuiteCommand.handler(
        { steps: [{ action: 'assert', value: 'visible', selector: '#btn' }], stopOnFailure: true },
        ctx,
      );
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: true }),
        tips: [],
      });
    });

    it('should execute screenshot step', async () => {
      const { testSuiteCommand } = await import('../../src/commands/ui-test.js');
      const result = await testSuiteCommand.handler(
        { steps: [{ action: 'screenshot', value: '/tmp/shot.png' }], stopOnFailure: true },
        ctx,
      );
      expect(mockPage.screenshot).toHaveBeenCalledWith({ path: '/tmp/shot.png' });
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: true }),
        tips: [],
      });
    });

    it('should execute eval step', async () => {
      const evalPage = createMockPage({ evaluate: vi.fn().mockResolvedValue(42) });
      const evalCtx = createMockContext(evalPage);
      const { testSuiteCommand } = await import('../../src/commands/ui-test.js');
      const result = await testSuiteCommand.handler(
        { steps: [{ action: 'eval', value: '1+1' }], stopOnFailure: true },
        evalCtx,
      );
      expect(evalPage.evaluate).toHaveBeenCalledWith('1+1');
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({ passed: true }),
        tips: [],
      });
    });

    it('should stop on failure when stopOnFailure is true', async () => {
      const failingPage = createMockPage({
        goto: vi.fn().mockRejectedValue(new Error('navigation failed')),
      });
      const failingCtx = createMockContext(failingPage);
      const { testSuiteCommand } = await import('../../src/commands/ui-test.js');
      const result = await testSuiteCommand.handler(
        {
          steps: [
            { action: 'goto', url: 'https://fail.com' },
            { action: 'click', selector: '#btn' },
          ],
          stopOnFailure: true,
        },
        failingCtx,
      );
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          passed: false,
          totalSteps: 2,
          passedSteps: 0,
          failedSteps: 1,
        }),
        tips: [],
      });
      expect(failingPage.click).not.toHaveBeenCalled();
    });

    it('should continue on failure when stopOnFailure is false', async () => {
      const mixedPage = createMockPage({
        goto: vi.fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValueOnce({ status: () => 200 }),
      });
      const mixedCtx = createMockContext(mixedPage);
      const { testSuiteCommand } = await import('../../src/commands/ui-test.js');
      const result = await testSuiteCommand.handler(
        {
          steps: [
            { action: 'goto', url: 'https://fail.com' },
            { action: 'goto', url: 'https://ok.com' },
          ],
          stopOnFailure: false,
        },
        mixedCtx,
      );
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          passed: false,
          totalSteps: 2,
          passedSteps: 1,
          failedSteps: 1,
        }),
        tips: [],
      });
      expect(mixedPage.goto).toHaveBeenCalledTimes(2);
    });

    it('should execute multiple steps in sequence', async () => {
      const { testSuiteCommand } = await import('../../src/commands/ui-test.js');
      const result = await testSuiteCommand.handler(
        {
          steps: [
            { action: 'goto', url: 'https://example.com' },
            { action: 'fill', selector: '#search', value: 'test' },
            { action: 'click', selector: '#submit' },
          ],
          stopOnFailure: true,
        },
        ctx,
      );
      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', { waitUntil: 'domcontentloaded' });
      expect(mockPage.fill).toHaveBeenCalledWith('#search', 'test');
      expect(mockPage.click).toHaveBeenCalledWith('#submit');
      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          passed: true,
          totalSteps: 3,
          passedSteps: 3,
          failedSteps: 0,
        }),
        tips: [],
      });
    });

    it('should report correct step durations', async () => {
      const { testSuiteCommand } = await import('../../src/commands/ui-test.js');
      const result = await testSuiteCommand.handler(
        { steps: [{ action: 'goto', url: 'https://example.com' }], stopOnFailure: true },
        ctx,
      );
      const data = (result as { data: { results: Array<{ duration: number }> } }).data;
      expect(data.results[0].duration).toBeGreaterThanOrEqual(0);
    });
  });
});
