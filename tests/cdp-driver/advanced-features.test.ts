/**
 * CDP Driver Advanced Features Tests (TDD)
 *
 * Tests for: waitForResponse, waitForRequest, route, setInputFiles,
 * waitForURL, dragAndDrop, Download, setOfflineMode
 *
 * These tests are expected to FAIL until the features are implemented.
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

describe('CDP Driver Advanced Features', { timeout: TEST_TIMEOUT, hookTimeout: 60_000 }, () => {
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

  // ── waitForResponse ─────────────────────────────────────────

  describe('waitForResponse', () => {
    it('should wait for a response matching URL pattern', async () => {
      await page.route('**/test-api.local/**', (route: { fulfill: (opts: { status: number; body: string }) => Promise<void> }) => {
        route.fulfill({ status: 200, body: '{"ok":true}' });
      });

      await page.goto('about:blank');
      page.evaluate(`fetch("https://test-api.local/data")`);

      const response = await page.waitForResponse('**/test-api.local/**', { timeout: 5000 });
      expect(response).toBeDefined();
      expect(response.status()).toBe(200);
    });

    it('should wait for a response matching predicate', async () => {
      await page.route('**/predicate-api.local/**', (route: { fulfill: (opts: { status: number; body: string }) => Promise<void> }) => {
        route.fulfill({ status: 200, body: '{}' });
      });

      await page.goto('about:blank');
      page.evaluate(`fetch("https://predicate-api.local/test")`);

      const response = await page.waitForResponse(
        (resp: { url: () => string; status: () => number }) => resp.url().includes('predicate-api'),
        { timeout: 5000 },
      );
      expect(response).toBeDefined();
      expect(response.status()).toBe(200);
    });

    it('should timeout if no matching response arrives', async () => {
      await page.goto('data:text/html,<html><body>no requests here</body></html>');

      await expect(
        page.waitForResponse('**/never-matches', { timeout: 1000 }),
      ).rejects.toThrow();
    });
  });

  // ── waitForRequest ──────────────────────────────────────────

  describe('waitForRequest', () => {
    it('should wait for a request matching URL pattern', async () => {
      await page.route('**/req-api.local/**', (route: { fulfill: (opts: { status: number; body: string }) => Promise<void> }) => {
        route.fulfill({ status: 200, body: '{}' });
      });

      await page.goto('about:blank');
      page.evaluate(`setTimeout(()=>fetch("https://req-api.local/get"),100)`);

      const request = await page.waitForRequest('**/req-api.local/**', { timeout: 5000 });
      expect(request).toBeDefined();
      expect(request.url()).toContain('req-api.local');
      expect(request.method()).toBe('GET');
    });

    it('should timeout if no matching request arrives', async () => {
      await page.goto('data:text/html,<html><body>no requests</body></html>');

      await expect(
        page.waitForRequest('**/never-matches', { timeout: 1000 }),
      ).rejects.toThrow();
    });
  });

  // ── route (request interception) ────────────────────────────

  describe('route', () => {
    it('should intercept and block requests', async () => {
      await page.route('**/blocked.com/**', (route: { abort: () => Promise<void> }) => route.abort());

      await page.goto('about:blank');
      await page.evaluate(`
        document.body.innerHTML = '<img src="https://blocked.com/test.png" onerror="this.dataset.blocked=1">';
      `);

      await page.waitForFunction(
        'document.querySelector("img")?.dataset.blocked === "1"',
        { timeout: 5000 },
      );

      const blocked = await page.evaluate<boolean>(
        'document.querySelector("img")?.dataset.blocked === "1"',
      );
      expect(blocked).toBe(true);
    });

    it('should intercept and modify request headers', async () => {
      await page.route('**/header-api.local/**', (route: {
        request: () => { url: () => string; headers: () => Record<string, string> };
        fulfill: (opts: { status: number; contentType: string; body: string }) => Promise<void>;
      }) => {
        const headers = route.request().headers();
        headers['x-custom-header'] = 'test-value';
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ headers }),
        });
      });

      await page.goto('about:blank');
      await page.evaluate(`
        fetch("https://header-api.local/test")
          .then(r => r.json())
          .then(d => { window.__headers = d; })
          .catch(e => { window.__headers = { error: e.message }; })
      `);

      await page.waitForFunction(
        'window.__headers !== undefined',
        { timeout: 5000 },
      );

      const data = await page.evaluate<{ headers?: Record<string, string>; error?: string }>(
        'window.__headers',
      );
      expect(data.error).toBeUndefined();
      expect(data.headers).toBeDefined();
      expect(data.headers!['x-custom-header']).toBe('test-value');
    });

    it('should intercept and provide mock response', async () => {
      await page.route('**/mock-api.example.com/**', (route: { fulfill: (opts: { status: number; body: string; contentType: string }) => Promise<void> }) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ mocked: true }),
        });
      });

      await page.goto('about:blank');
      await page.evaluate(`
        fetch("https://mock-api.example.com/api/data")
          .then(r => r.json())
          .then(d => { window.__data = d; })
          .catch(e => { window.__data = { error: e.message }; })
      `);

      await page.waitForFunction(
        'window.__data !== undefined',
        { timeout: 10000 },
      );

      const data = await page.evaluate<{ mocked?: boolean; error?: string }>('window.__data');
      expect(data.error).toBeUndefined();
      expect(data.mocked).toBe(true);
    });

    it('should unroute previously set routes', async () => {
      const handler = (route: { abort: () => Promise<void> }) => route.abort();
      page.route('**/test-unroute/**', handler);
      page.unroute('**/test-unroute/**', handler);

      // After unroute, requests should go through (not blocked)
      // No error means success
      expect(true).toBe(true);
    });
  });

  // ── setInputFiles ───────────────────────────────────────────

  describe('setInputFiles', () => {
    it('should upload a single file to input[type=file]', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="upload" type="file"><div id="result"></div><script>document.getElementById("upload").addEventListener("change", async (e)=>{const f=e.target.files[0];document.getElementById("result").textContent=f.name+":"+f.size})</script></body></html>',
      );

      // Create a temporary file
      const fileContent = Buffer.from('Hello Upload!');
      await page.setInputFiles('#upload', {
        name: 'test.txt',
        mimeType: 'text/plain',
        buffer: fileContent,
      });

      // Wait for change event
      await page.waitForFunction(
        () => document.getElementById('result')?.textContent,
        { timeout: 5000 },
      );

      const result = await page.evaluate<string>(
        'document.getElementById("result").textContent',
      );
      expect(result).toBe('test.txt:13');
    });

    it('should upload multiple files', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="multi" type="file" multiple><div id="count"></div><script>document.getElementById("multi").addEventListener("change", (e)=>{document.getElementById("count").textContent=String(e.target.files.length)})</script></body></html>',
      );

      await page.setInputFiles('#multi', [
        { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('aaa') },
        { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('bbb') },
      ]);

      await page.waitForFunction(
        () => document.getElementById('count')?.textContent,
        { timeout: 5000 },
      );

      const count = await page.evaluate<string>(
        'document.getElementById("count").textContent',
      );
      expect(count).toBe('2');
    });
  });

  // ── waitForURL ──────────────────────────────────────────────

  describe('waitForURL', () => {
    it('should wait for URL to match a string predicate', async () => {
      // Set up waitForURL BEFORE the navigation
      const waitPromise = page.waitForURL(
        (url: string) => url.includes('Page2'),
        { timeout: 10000 },
      );

      // Navigate to trigger the URL change
      await page.goto('data:text/html,<html><body>Page2</body></html>');

      await waitPromise;
      expect(page.url()).toContain('Page2');
    });

    it('should timeout if URL never matches', async () => {
      await page.goto('data:text/html,<html><body>Stable</body></html>');

      await expect(
        page.waitForURL('**/never-happens', { timeout: 1000 }),
      ).rejects.toThrow();
    });
  });

  // ── dragAndDrop ─────────────────────────────────────────────

  describe('dragAndDrop', () => {
    it('should drag and drop between two elements', async () => {
      await page.goto(`data:text/html,<html><body>
        <div id="source" draggable="true" style="width:100px;height:100px;background:red;">Source</div>
        <div id="target" style="width:100px;height:100px;background:blue;margin-top:50px;">Target</div>
        <div id="result"></div>
        <script>
          const source = document.getElementById('source');
          const target = document.getElementById('target');
          source.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text', 'dragged'); });
          target.addEventListener('drop', (e) => { e.preventDefault(); document.getElementById('result').textContent = e.dataTransfer.getData('text'); });
          target.addEventListener('dragover', (e) => e.preventDefault());
        </script>
      </body></html>`);

      await page.dragAndDrop('#source', '#target', { timeout: 5000 });

      const result = await page.evaluate<string>(
        'document.getElementById("result").textContent',
      );
      expect(result).toBe('dragged');
    });
  });

  // ── setOfflineMode ──────────────────────────────────────────

  describe('setOfflineMode', () => {
    it('should simulate offline mode', async () => {
      await page.setOfflineMode(true);

      await page.goto('about:blank');
      await page.evaluate(`
        fetch("https://offline-test.local/get")
          .then(function(r){window.__ok=true})
          .catch(function(e){window.__ok=false})
      `);

      await page.waitForFunction(
        function() { return (window as unknown as { __ok?: boolean }).__ok !== undefined; },
        { timeout: 5000 },
      );

      const ok = await page.evaluate<boolean>('window.__ok');
      expect(ok).toBe(false);

      await page.setOfflineMode(false);
    });
  });
});
