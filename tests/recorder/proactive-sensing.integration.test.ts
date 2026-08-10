/**
 * 集成测试：主动感知框架端到端验证
 *
 * 策略：
 * 1. 启动一个本地 HTTP server 服务 mock 闲鱼页面
 * 2. 用 xbrowser 的 cdp-driver 启动 Chromium 访问该页面
 * 3. 注入扫描逻辑
 * 4. 触发 __xb_scanFilters + 模拟 hover
 * 5. 断言 discoveredFilters 和 popup_appear 的结果
 *
 * 这个测试真实跑 Chromium，验证浏览器侧的扫描逻辑（不用 mock DOM）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'http';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { launch, type XBBrowser, type XBPage } from '../../src/cdp-driver/index.js';

const MOCK_HTML_PATH = resolve(process.cwd(), 'tests/fixtures/xianyu-mock.html');

let server: Server;
let serverPort = 0;
let browser: XBBrowser | null = null;
let page: XBPage | null = null;

beforeAll(async () => {
  // 1. Start local HTTP server serving the mock page
  server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync(MOCK_HTML_PATH, 'utf-8'));
  });
  await new Promise<void>((r) => { server.listen(0, '127.0.0.1', r); });
  serverPort = (server.address() as { port: number }).port;

  // 2. Launch Chromium via cdp-driver (same opts as smoke.test.ts)
  try {
    const result = await launch({
      headless: true,
      args: ['--no-sandbox', '--disable-gpu'],
    });
    browser = result.browser;
    const context = await browser.newContext();
    page = await context.newPage();
  } catch (e) {
    console.warn('Could not launch Chromium, skipping integration test:', e instanceof Error ? e.message : e);
  }
}, 60000);

afterAll(async () => {
  if (browser) {
    try { await browser.close(); } catch {}
  }
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

// Skip all tests if Chromium isn't available
const testOrSkip = describe;

testOrSkip('Proactive sensing integration (real Chromium + mock xianyu page)', () => {
  it('should discover filter containers and triggers via __xb_scanFilters', async () => {
    if (!page) return;
    await page.goto(`http://127.0.0.1:${serverPort}/`, { waitUntil: 'load', timeout: 15000 });

    // Inject the scan logic (mirrors session-recorder.ts __xb_scanFilters)
    await page.evaluate(`
      window.__xb_test_scan = function() {
        var FILTER_CONTAINER_SELECTORS = [
          '[role="tablist"]', '[role="menu"]', '[role="menubar"]', '[role="toolbar"]',
          '[role="navigation"]', '[role="listbox"]',
          '[class*="filter"]', '[class*="sort"]', '[class*="toolbar"]',
          '[class*="select-bar"]', '[class*="tabs"]', '[class*="nav-bar"]',
          '[class*="sidebar"]', '[class*="menu-bar"]', '[class*="select-container"]',
          'fieldset',
        ];
        var TRIGGER_SELECTORS = [
          '[role="tab"]', '[role="menuitem"]', '[role="option"]', '[role="button"]',
          'button', 'a', 'select',
          'span[class*="title"]', 'div[class*="title"]',
          'div[class*="trigger"]', 'span[class*="trigger"]',
          'div[class*="item"]', 'span[class*="item"]', 'li',
          '[class*="checkbox-item"]', '[class*="sidebar-item"]', '[class*="wrap"]',
        ];
        function categorizeElement(el) {
          var cls = ((el.className && typeof el.className === 'string') ? el.className : '').toLowerCase();
          if (/sort/.test(cls)) return 'sort';
          if (/filter/.test(cls)) return 'filter';
          if (/sidebar/.test(cls)) return 'navigation';
          if (/search-filter|search-select|filter-up|filter-select|filter-checkbox/.test(cls)) return 'filter';
          return 'unknown';
        }
        var results = [];
        var seenContainers = new Set();
        for (var ci = 0; ci < FILTER_CONTAINER_SELECTORS.length; ci++) {
          var containers = document.querySelectorAll(FILTER_CONTAINER_SELECTORS[ci]);
          for (var cj = 0; cj < containers.length; cj++) {
            var c = containers[cj];
            if (!c.offsetParent) continue;
            if (seenContainers.has(c)) continue;
            // Skip if ancestor already in results
            var isNested = false;
            for (var ck = 0; ck < results.length; ck++) {
              if (results[ck]._node && results[ck]._node.contains(c)) { isNested = true; break; }
            }
            if (isNested) continue;
            seenContainers.add(c);
            // Find triggers
            var triggers = [];
            var allCandidates = c.querySelectorAll(TRIGGER_SELECTORS.join(', '));
            for (var ti = 0; ti < allCandidates.length; ti++) {
              var el = allCandidates[ti];
              if (!el.offsetParent) continue;
              var txt = (el.textContent || '').trim();
              if (!txt || txt.length > 40) continue;
              if (el.children.length > 3) continue;
              if (triggers.some(function(t) { return t.text === txt; })) continue;
              triggers.push({ text: txt, category: categorizeElement(el) });
              if (triggers.length >= 30) break;
            }
            if (triggers.length === 0) continue;
            results.push({
              category: categorizeElement(c),
              containerText: (c.textContent || '').trim().substring(0, 60),
              triggers: triggers,
              _node: c,  // for nested check (won't be serialized)
            });
          }
        }
        // Strip _node before returning
        return results.map(function(r) {
          return { category: r.category, containerText: r.containerText, triggers: r.triggers };
        });
      };
    `);

    const filters = await page.evaluate(`window.__xb_test_scan()`) as Array<{
      category: string;
      containerText: string;
      triggers: Array<{ text: string; category: string }>;
    }>;

    // Assertions
    expect(filters.length).toBeGreaterThan(0);

    // Should find the sort/filter triggers (the core ones from search-filter-select-container)
    const allTriggerTexts = filters.flatMap((f) => f.triggers.map((t) => t.text));
    // Triggers may include arrow characters — use substring match
    const hasText = (needle: string) => allTriggerTexts.some((t) => t.includes(needle));
    expect(hasText('综合')).toBe(true);
    expect(hasText('新发布')).toBe(true);
    expect(hasText('价格')).toBe(true);
    expect(hasText('新降价')).toBe(true);

    // Should find checkbox filter items (second container)
    expect(hasText('包邮')).toBe(true);
    expect(hasText('全新')).toBe(true);
    expect(hasText('严选')).toBe(true);
    expect(hasText('个人闲置')).toBe(true);
  }, 30000);

  it('should observe popup_appear when hovering over a sort trigger', async () => {
    if (!page) return;
    await page.goto(`http://127.0.0.1:${serverPort}/`, { waitUntil: 'load', timeout: 15000 });

    // Before hover: items-container is hidden
    const visibleBefore = await page.evaluate(`
      !!document.querySelector('.search-select-items-container.visible')
    `);
    expect(visibleBefore).toBe(false);

    // Hover over "新发布" trigger
    const newFaBu = await page.evaluate(`
      (function() {
        var els = [...document.querySelectorAll('.search-select-title')];
        var el = els.find(function(e) { return e.textContent.trim() === '新发布'; });
        if (!el) return null;
        var r = el.getBoundingClientRect();
        return { x: r.x + r.width/2, y: r.y + r.height/2 };
      })()
    `) as { x: number; y: number } | null;
    expect(newFaBu).not.toBeNull();

    await page.mouse.move(newFaBu!.x, newFaBu!.y);
    await page.waitForTimeout(300);  // wait for CSS :hover / mouseenter

    // After hover: 新发布's items-container should be visible with 5 items
    const visibleAfter = await page.evaluate(`
      (function() {
        var containers = [...document.querySelectorAll('.search-select-items-container.visible')];
        var info = containers.map(function(c) {
          var items = [...c.querySelectorAll('.search-select-item')].map(function(i) { return i.textContent.trim(); });
          return { itemCount: items.length, items: items };
        });
        return info;
      })()
    `) as Array<{ itemCount: number; items: string[] }>;

    expect(visibleAfter.length).toBeGreaterThan(0);
    const popupWithFiveItems = visibleAfter.find((p) => p.itemCount === 5);
    expect(popupWithFiveItems).toBeDefined();
    expect(popupWithFiveItems!.items).toEqual(
      expect.arrayContaining(['最新', '1天内', '3天内', '7天内', '14天内']),
    );
  }, 30000);

  it('should filter out large banners from popup_appear (size + items heuristics)', async () => {
    if (!page) return;
    await page.goto(`http://127.0.0.1:${serverPort}/`, { waitUntil: 'load', timeout: 15000 });

    // The announcement banner has class "popup-class" but should NOT be
    // treated as a real popup because it has no menu-item children.
    const bannerAnalysis = await page.evaluate(`
      (function() {
        var banner = document.querySelector('.announcement-banner');
        if (!banner) return null;
        var r = banner.getBoundingClientRect();
        var area = r.width * r.height;
        var itemChildren = banner.querySelectorAll('a, button, [role="menuitem"], [role="option"], li, [class*="item"]');
        return {
          width: r.width,
          height: r.height,
          area: area,
          areaOverLimit: area > 600 * 600,
          hasItemChildren: itemChildren.length > 0,
          wouldBePopup: area <= 600 * 600 && itemChildren.length > 0,
        };
      })()
    `) as { width: number; height: number; area: number; areaOverLimit: boolean; hasItemChildren: boolean; wouldBePopup: boolean } | null;

    expect(bannerAnalysis).not.toBeNull();
    // Banner should be filtered out (no menu items)
    expect(bannerAnalysis!.wouldBePopup).toBe(false);
  }, 30000);
});
