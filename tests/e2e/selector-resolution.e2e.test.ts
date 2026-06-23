import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from '../../src/browser-shim.js';
import { launch } from '../../src/browser-shim.js';
import { transformSync } from 'esbuild';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let browser: Browser;
let page: Page;

function extractFn(): string {
  const src = readFileSync(resolve(__dirname, '../../src/utils/resolve-selector.ts'), 'utf-8');
  const start = src.indexOf('export function buildElementSelector(el: Element): string {');
  const end = src.indexOf('\n\nexport function extractRefs');
  if (start === -1 || end === -1) throw new Error('Cannot extract buildElementSelector');
  const tsFn = src.slice(start, end);
  const js = transformSync(tsFn, { loader: 'ts', target: 'es2020' });
  return js.code.replace('export function', 'function');
}

let fnSource = '';

async function resolveSelector(selector: string): Promise<string> {
  return page.evaluate(({ fnSrc, sel }) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('Element not found: ' + sel);
    const fn = new Function('el', fnSrc + '\nreturn buildElementSelector(el);');
    return fn(el);
  }, { fnSrc: fnSource, sel: selector });
}

async function resolveSelectorForAll(selector: string): Promise<string[]> {
  return page.evaluate(({ fnSrc, sel }) => {
    const els = document.querySelectorAll(sel);
    const fn = new Function('el', fnSrc + '\nreturn buildElementSelector(el);');
    return Array.from(els).map(el => fn(el));
  }, { fnSrc: fnSource, sel: selector });
}

const TEST_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
  <div id="app">
    <header id="top-bar">
      <nav class="nav-main">
        <a href="/home" class="nav-link active">Home</a>
        <a href="/about" class="nav-link">About</a>
        <a href="/contact" class="nav-link">Contact</a>
      </nav>
    </header>

    <main>
      <form id="login-form" name="login" data-testid="login-form">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" aria-label="用户名" data-testid="input-user" />

        <label for="password">Password</label>
        <input type="password" id="password" name="password" aria-label="密码" />

        <label for="email">Email</label>
        <input type="email" name="email" class="input-field email-field" />

        <button type="submit" id="submit-btn" name="submit" aria-label="提交表单">Submit</button>
        <button type="button" name="cancel" class="btn btn-secondary">Cancel</button>
      </form>

      <div class="card-list">
        <div class="card">
          <h2 class="card-title">Card One</h2>
          <p class="card-desc">First card description</p>
        </div>
        <div class="card">
          <h2 class="card-title">Card Two</h2>
          <p class="card-desc">Second card description</p>
        </div>
        <div class="card">
          <h2 class="card-title">Card Three</h2>
          <p class="card-desc">Third card description</p>
        </div>
      </div>

      <ul id="item-list">
        <li>Item 1</li>
        <li>Item 2</li>
        <li>Item 3</li>
        <li>Item 4</li>
        <li>Item 5</li>
      </ul>

      <table id="data-table">
        <thead><tr><th>Name</th><th>Age</th><th>City</th></tr></thead>
        <tbody>
          <tr><td>Alice</td><td>30</td><td>Beijing</td></tr>
          <tr><td>Bob</td><td>25</td><td>Shanghai</td></tr>
          <tr><td>Charlie</td><td>35</td><td>Guangzhou</td></tr>
        </tbody>
      </table>

      <div id="special.chars" class="foo bar baz" data-testid="special.element">
        Special element with dots in ID
      </div>

      <div class="deep">
        <div class="deep">
          <div class="deep">
            <span class="deep-target">Deeply nested target</span>
          </div>
        </div>
      </div>

      <div class="no-unique-attrs">
        <span>Span A</span>
        <span>Span B</span>
        <span>Span C</span>
      </div>

      <footer class="site-footer">
        <p class="copyright">Copyright 2024</p>
        <a href="/privacy">Privacy Policy</a>
        <a href="/terms">Terms of Service</a>
      </footer>
    </main>
  </div>
</body></html>`;

// This E2E test uses Playwright-compatible API pattern (page.setContent, etc.)
// that our CDP driver doesn't fully support yet. Skip on CI.
// Run locally with `npm run test:e2e` when Chrome is available.
const isCI = process.env.CI === 'true' || process.env.XBROWSER_CHROMIUM_PATH === '';
const describeOrSkip = isCI ? describe.skip : describe;

describeOrSkip('buildElementSelector e2e', () => {
  beforeAll(async () => {
    fnSource = extractFn();
    try {
      const launched = await launch({ headless: true });
      browser = launched.browser;
      const ctx = await browser.newContext();
      page = await ctx.newPage();
      await page.setContent(TEST_HTML);
    } catch (e) {
      // CI environment may not have Chromium installed — skip all tests
      console.warn('Skipping selector-resolution E2E: no Chromium available');
      throw e;
    }
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  describe('ID selector', () => {
    it('returns #id for unique id', async () => {
      const sel = await resolveSelector('#username');
      expect(sel).toBe('#username');
    });

    it('returns #submit-btn for submit button', async () => {
      const sel = await resolveSelector('#submit-btn');
      expect(sel).toBe('#submit-btn');
    });

    it('handles special chars in id with CSS.escape', async () => {
      const sel = await resolveSelector('[id="special.chars"]');
      const count = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
      expect(count).toBe(1);
    });
  });

  describe('name attribute', () => {
    it('returns [name="x"] when name is unique', async () => {
      const sel = await resolveSelector('[name="email"]');
      expect(sel).toBe('[name="email"]');
    });

    it('prefers #id over [name] (shorter)', async () => {
      const sel = await resolveSelector('#password');
      expect(sel).toBe('#password');
    });
  });

  describe('aria-label', () => {
    it('returns [aria-label="x"] for unique aria-label', async () => {
      const sel = await resolveSelector('[aria-label="提交表单"]');
      const count = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
      expect(count).toBe(1);
    });

    it('handles Chinese characters in aria-label', async () => {
      const sel = await resolveSelector('[aria-label="用户名"]');
      const count = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
      expect(count).toBe(1);
    });
  });

  describe('data-testid', () => {
    it('returns [data-testid="x"] for unique testid', async () => {
      const sel = await resolveSelector('[data-testid="special.element"]');
      const count = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
      expect(count).toBe(1);
    });

    it('prefers #id over data-testid when id is shorter', async () => {
      const sel = await resolveSelector('#login-form');
      expect(sel).toBe('#login-form');
    });
  });

  describe('class selector', () => {
    it('returns tag.class for unique single class', async () => {
      const sel = await resolveSelector('.copyright');
      expect(sel).toBe('p.copyright');
    });

    it('prefers unique class over non-unique', async () => {
      const sel = await resolveSelector('.email-field');
      const count = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
      expect(count).toBe(1);
      expect(sel.length).toBeLessThanOrEqual('input.email-field'.length);
    });

    it('handles multiple cards - each resolves uniquely', async () => {
      const sels = await resolveSelectorForAll('.card-title');
      expect(sels).toHaveLength(3);
      for (const s of sels) {
        const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, s);
        expect(count).toBe(1);
      }
      expect(new Set(sels).size).toBe(3);
    });

    it('handles nav links with same classes', async () => {
      const sels = await resolveSelectorForAll('.nav-link');
      expect(sels).toHaveLength(3);
      expect(new Set(sels).size).toBe(3);
    });
  });

  describe('text content', () => {
    it('uses has-text or path for leaf element with unique text', async () => {
      const sel = await resolveSelector('#item-list li:first-child');
      const count = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
      expect(count).toBe(1);
    });

    it('distinguishes sibling list items by text', async () => {
      const sels = await resolveSelectorForAll('#item-list li');
      expect(sels).toHaveLength(5);
      expect(new Set(sels).size).toBe(5);
    });
  });

  describe('nth-of-type and DOM path', () => {
    it('uses nth-of-type for duplicate siblings without distinguishing attributes', async () => {
      const sel = await resolveSelector('.no-unique-attrs span:nth-of-type(2)');
      expect(sel).toContain('nth-of-type');
    });

    it('uses last-of-type for last sibling', async () => {
      const sel = await resolveSelector('.no-unique-attrs span:last-of-type');
      expect(sel).toContain('last-of-type');
    });

    it('table rows resolve uniquely', async () => {
      const sels = await resolveSelectorForAll('#data-table tbody tr');
      expect(sels).toHaveLength(3);
      expect(new Set(sels).size).toBe(3);
    });
  });

  describe('anchor-based path', () => {
    it('deeply nested element uses nearest anchor', async () => {
      const sel = await resolveSelector('.deep-target');
      expect(sel.length).toBeLessThan(60);
    });
  });

  describe('shortest unique guarantee', () => {
    it('picks #id over [data-testid] when id is shorter', async () => {
      const sel = await resolveSelector('#submit-btn');
      expect(sel).toBe('#submit-btn');
      expect(sel.length).toBeLessThan('[data-testid="submit-btn"]'.length);
    });

    it('picks shortest class among multiple unique classes', async () => {
      const sel = await resolveSelector('[name="cancel"]');
      expect(sel.length).toBeLessThanOrEqual('button.btn.btn-secondary'.length);
    });

    it('each card desc has a unique selector shorter than full path', async () => {
      const sels = await resolveSelectorForAll('.card-desc');
      for (const s of sels) {
        expect(s.length).toBeLessThan(80);
      }
    });
  });

  describe('uniqueness verification', () => {
    it('every resolved selector matches exactly 1 element', async () => {
      const allSelectors = [
        '#username', '#password', '#submit-btn',
        '[name="email"]', '[name="cancel"]',
        '[aria-label="用户名"]', '[aria-label="密码"]', '[aria-label="提交表单"]',
        '.copyright', '.email-field',
        '#item-list li', '.card-title', '.nav-link',
        '.no-unique-attrs span',
        '#data-table tbody tr',
        '.deep-target',
        '.card-desc',
      ];

      for (const sel of allSelectors) {
        const resolved = await resolveSelectorForAll(sel);
        for (const r of resolved) {
          const count = await page.evaluate((s) => document.querySelectorAll(s).length, r);
          expect(count).toBe(1);
        }
      }
    });

    it('all list item selectors are distinct', async () => {
      const sels = await resolveSelectorForAll('#item-list li');
      expect(new Set(sels).size).toBe(sels.length);
    });

    it('all nav link selectors are distinct', async () => {
      const sels = await resolveSelectorForAll('.nav-link');
      expect(new Set(sels).size).toBe(sels.length);
    });

    it('all table row selectors are distinct', async () => {
      const sels = await resolveSelectorForAll('#data-table tbody tr');
      expect(new Set(sels).size).toBe(sels.length);
    });

    it('all card title selectors are distinct', async () => {
      const sels = await resolveSelectorForAll('.card-title');
      expect(new Set(sels).size).toBe(sels.length);
    });
  });

  describe('edge cases', () => {
    it('handles element with id containing dots', async () => {
      const sel = await resolveSelector('[id="special.chars"]');
      const count = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
      expect(count).toBe(1);
    });

    it('handles Chinese aria-label', async () => {
      const sel = await resolveSelector('[aria-label="密码"]');
      const count = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
      expect(count).toBe(1);
    });

    it('footer links are distinguishable', async () => {
      const sels = await resolveSelectorForAll('.site-footer a');
      expect(sels).toHaveLength(2);
      expect(new Set(sels).size).toBe(2);
    });

    it('cancel button resolves despite sharing .btn class', async () => {
      const sel = await resolveSelector('[name="cancel"]');
      const count = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
      expect(count).toBe(1);
    });
  });
});
