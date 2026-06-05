/**
 * CDP Driver Smoke Tests
 *
 * End-to-end tests that launch a real Chrome process and verify
 * the driver can perform basic automation operations.
 *
 * Run: npx vitest run tests/cdp-driver/smoke.test.ts
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { launch, type XBBrowser, type XBPage } from '../../src/cdp-driver/index.js';

const TEST_TIMEOUT = 30_000;
const CDP_ENDPOINT = process.env.CDP_ENDPOINT || '';
const LAUNCH_OPTS = CDP_ENDPOINT
  ? { cdpEndpoint: CDP_ENDPOINT }
  : {
      headless: true,
      args: ['--no-sandbox', '--disable-gpu'],
    };

describe('CDP Driver Smoke Tests', { timeout: TEST_TIMEOUT, hookTimeout: 60_000 }, () => {
  let browser: XBBrowser;
  let page: XBPage;

  beforeAll(async () => {
    const result = await launch(LAUNCH_OPTS);
    browser = result.browser;
    const context = await browser.newContext();
    page = await context.newPage();
  }, 60_000);

  afterAll(async () => {
    if (browser) await browser.close();
  }, 30_000);

  describe('Navigation', () => {
    it('should navigate to a page and get URL', async () => {
      await page.goto('data:text/html,<html><title>Test</title><body>Hello</body></html>');
      expect(page.url()).toContain('data:text/html');
    });

    it('should get page title', async () => {
      const title = await page.title();
      expect(title).toBe('Test');
    });

    it('should get page content', async () => {
      const content = await page.content();
      expect(content).toContain('<body>Hello</body>');
    });
  });

  describe('Evaluation', () => {
    it('should evaluate simple expression', async () => {
      const result = await page.evaluate<number>('1 + 2');
      expect(result).toBe(3);
    });

    it('should evaluate function', async () => {
      const result = await page.evaluate<string>(() => document.body.textContent ?? '');
      expect(result).toBe('Hello');
    });

    it('should evaluate with arguments', async () => {
      const result = await page.evaluate((a: number, b: number) => a + b, 10, 20);
      expect(result).toBe(30);
    });

    it('should handle evaluation errors', async () => {
      await expect(page.evaluate('throw new Error("test error")')).rejects.toThrow();
    });
  });

  describe('Page DOM', () => {
    it('should handle complex HTML', async () => {
      await page.goto('data:text/html,<html><body><div id="test">Test Div</div><button class="btn">Click</button></body></html>');

      const divText = await page.evaluate<string>(
        'document.getElementById("test")?.textContent ?? ""',
      );
      expect(divText).toBe('Test Div');

      const btnExists = await page.evaluate<boolean>(
        '!!document.querySelector(".btn")',
      );
      expect(btnExists).toBe(true);
    });
  });

  describe('Screenshot', () => {
    it('should take a screenshot', async () => {
      await page.goto('data:text/html,<html><body><h1>Screenshot Test</h1></body></html>');
      const buf = await page.screenshot();
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
    });

    it('should take JPEG screenshot', async () => {
      const buf = await page.screenshot({ type: 'jpeg', quality: 50 });
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
    });
  });

  describe('Mouse', () => {
    it('should move mouse', async () => {
      await page.mouse.move(100, 200);
      await page.mouse.move(200, 300, { steps: 5 });
      // No assertion needed — just verify no errors
    });

    it('should click at coordinates', async () => {
      await page.goto('data:text/html,<html><body><div id="area" onclick="this.textContent=\'clicked\'" style="width:200px;height:200px;">Area</div></body></html>');
      await page.evaluate('document.getElementById("area").getBoundingClientRect()');
      await page.mouse.click(50, 50);
      const text = await page.evaluate<string>('document.getElementById("area").textContent');
      expect(text).toBe('clicked');
    });
  });

  describe('Keyboard', () => {
    it('should type text', async () => {
      await page.goto('data:text/html,<html><body><input id="input" type="text"></body></html>');
      await page.locator('#input').click();
      await page.keyboard.type('Hello World');
      const value = await page.evaluate<string>('document.getElementById("input").value');
      expect(value).toBe('Hello World');
    });

    it('should press keys', async () => {
      await page.goto('data:text/html,<html><body><input id="input" type="text"></body></html>');
      await page.locator('#input').click();
      await page.keyboard.press('a');
      await page.keyboard.press('b');
      await page.keyboard.press('c');
      const value = await page.evaluate<string>('document.getElementById("input").value');
      expect(value).toBe('abc');
    });
  });

  describe('Locator', () => {
    it('should find element and click via locator', async () => {
      await page.goto('data:text/html,<html><body><button id="btn" onclick="this.textContent=\'Clicked!\'">Click Me</button></body></html>');
      await page.locator('#btn').click();
      const text = await page.evaluate<string>('document.getElementById("btn").textContent');
      expect(text).toBe('Clicked!');
    });

    it('should fill input via locator', async () => {
      await page.goto('data:text/html,<html><body><input id="name" type="text"></body></html>');
      await page.locator('#name').fill('John Doe');
      const value = await page.evaluate<string>('document.getElementById("name").value');
      expect(value).toBe('John Doe');
    });

    it('should check element visibility', async () => {
      await page.goto('data:text/html,<html><body><div id="visible">Visible</div><div id="hidden" style="display:none">Hidden</div></body></html>');
      expect(await page.locator('#visible').isVisible()).toBe(true);
      expect(await page.locator('#hidden').isVisible()).toBe(false);
    });

    it('should get text content', async () => {
      await page.goto('data:text/html,<html><body><p id="text">Hello Text</p></body></html>');
      const text = await page.locator('#text').textContent();
      expect(text).toBe('Hello Text');
    });

    it('should count elements', async () => {
      await page.goto('data:text/html,<html><body><div class="item">1</div><div class="item">2</div><div class="item">3</div></body></html>');
      const count = await page.locator('.item').count();
      expect(count).toBe(3);
    });
  });

  describe('waitForSelector', () => {
    it('should wait for selector to appear', async () => {
      await page.goto('data:text/html,<html><body></body></html>');

      // Add element after 200ms
      page.evaluate(`
        setTimeout(() => {
          document.body.innerHTML = '<div id="late">Late Element</div>';
        }, 200)
      `);

      await page.waitForSelector('#late', { timeout: 5000 });
      const text = await page.locator('#late').textContent();
      expect(text).toBe('Late Element');
    });
  });
});
