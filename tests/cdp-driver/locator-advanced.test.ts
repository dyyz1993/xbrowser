/**
 * CDP Driver Locator Advanced Tests
 *
 * Comprehensive E2E tests for XBLocator methods NOT covered by smoke.test.ts.
 * Targets: press, pressSequentially, hover, type, check/uncheck, selectOption,
 * screenshot, waitFor, isHidden/isDisabled, boundingBox, innerText/innerHTML,
 * getAttribute, evaluate, first/last/nth, filter({visible}), all, focus, ariaSnapshot,
 * and VisibleFilteredLocator overrides.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { launch, type XBBrowser, type XBPage } from '../../src/cdp-driver/index.js';

const TEST_TIMEOUT = 30_000;
const CDP_ENDPOINT = process.env.CDP_ENDPOINT || '';
const LAUNCH_OPTS = CDP_ENDPOINT
  ? { cdpEndpoint: CDP_ENDPOINT }
  : { headless: true, args: ['--no-sandbox', '--disable-gpu'] };

describe('CDP Driver Locator Advanced', { timeout: TEST_TIMEOUT, hookTimeout: 60_000 }, () => {
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

  describe('press', () => {
    it('should focus element and press a character key', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="i" type="text"></body></html>',
      );
      await page.locator('#i').press('a');
      expect(
        await page.evaluate<string>('document.getElementById("i").value'),
      ).toBe('a');
    });

    it('should press multiple keys sequentially', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="i" type="text"></body></html>',
      );
      const loc = page.locator('#i');
      await loc.press('a');
      await loc.press('b');
      await loc.press('c');
      expect(
        await page.evaluate<string>('document.getElementById("i").value'),
      ).toBe('abc');
    });

    it('should press special keys (Enter) and trigger events', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <input id="i" type="text">
          <div id="out">none</div>
          <script>
            document.getElementById('i').addEventListener('keydown', (e) => {
              if (e.key === 'Enter') document.getElementById('out').textContent = 'enter';
            });
          </script>
        </body></html>`,
      );
      await page.locator('#i').press('Enter');
      expect(
        await page.evaluate<string>('document.getElementById("out").textContent'),
      ).toBe('enter');
    });
  });

  describe('pressSequentially', () => {
    it('should type characters one by one', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="i" type="text"></body></html>',
      );
      await page.locator('#i').pressSequentially('hello', { delay: 10 });
      expect(
        await page.evaluate<string>('document.getElementById("i").value'),
      ).toBe('hello');
    });

    it('should support longer text with delay', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="i" type="text"></body></html>',
      );
      await page.locator('#i').pressSequentially('foobar', { delay: 5 });
      expect(
        await page.evaluate<string>('document.getElementById("i").value'),
      ).toBe('foobar');
    });

    it('should work without delay option', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="i" type="text"></body></html>',
      );
      await page.locator('#i').pressSequentially('xyz');
      expect(
        await page.evaluate<string>('document.getElementById("i").value'),
      ).toBe('xyz');
    });
  });

  describe('hover', () => {
    it('should hover an element and trigger mouseover', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div id="t" onmouseover="this.textContent='hovered'" style="width:100px;height:100px;">orig</div>
        </body></html>`,
      );
      await page.locator('#t').hover();
      expect(
        await page.evaluate<string>('document.getElementById("t").textContent'),
      ).toBe('hovered');
    });

    it('should hover with force:true skipping actionability', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div id="t" onmouseover="this.textContent='force'" style="width:100px;height:100px;">orig</div>
        </body></html>`,
      );
      await page.locator('#t').hover({ force: true });
      expect(
        await page.evaluate<string>('document.getElementById("t").textContent'),
      ).toBe('force');
    });
  });

  describe('type', () => {
    it('should be an alias of pressSequentially', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="i" type="text"></body></html>',
      );
      await page.locator('#i').type('typed', { delay: 5 });
      expect(
        await page.evaluate<string>('document.getElementById("i").value'),
      ).toBe('typed');
    });

    it('should type without delay option', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="i" type="text"></body></html>',
      );
      await page.locator('#i').type('abc');
      expect(
        await page.evaluate<string>('document.getElementById("i").value'),
      ).toBe('abc');
    });
  });

  describe('check / uncheck', () => {
    it('should check an unchecked checkbox', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="cb" type="checkbox"></body></html>',
      );
      await page.locator('#cb').check();
      expect(
        await page.evaluate<boolean>('document.getElementById("cb").checked'),
      ).toBe(true);
    });

    it('should not re-check an already checked checkbox', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="cb" type="checkbox" checked></body></html>',
      );
      const beforeChecks = await page.evaluate<number>(
        'window.__cbCount = 0; document.getElementById("cb").addEventListener("click", () => window.__cbCount++); document.getElementById("cb").checked',
      );
      expect(beforeChecks).toBe(true);
      await page.locator('#cb').check();
      expect(
        await page.evaluate<boolean>('document.getElementById("cb").checked'),
      ).toBe(true);
      expect(await page.evaluate<number>('window.__cbCount')).toBe(0);
    });

    it('should uncheck a checked checkbox', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="cb" type="checkbox" checked></body></html>',
      );
      await page.locator('#cb').uncheck();
      expect(
        await page.evaluate<boolean>('document.getElementById("cb").checked'),
      ).toBe(false);
    });

    it('should not uncheck an already unchecked checkbox', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="cb" type="checkbox"></body></html>',
      );
      await page.evaluate(
        'window.__uCount = 0; document.getElementById("cb").addEventListener("click", () => window.__uCount++)',
      );
      expect(
        await page.evaluate<boolean>('document.getElementById("cb").checked'),
      ).toBe(false);
      await page.locator('#cb').uncheck();
      expect(
        await page.evaluate<boolean>('document.getElementById("cb").checked'),
      ).toBe(false);
      expect(await page.evaluate<number>('window.__uCount')).toBe(0);
    });
  });

  describe('selectOption', () => {
    it('should select option by value string', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <select id="s">
            <option value="a">Apple</option>
            <option value="b">Banana</option>
            <option value="c">Cherry</option>
          </select>
        </body></html>`,
      );
      const sel = await page.locator('#s').selectOption('b');
      expect(sel).toEqual(['b']);
      expect(
        await page.evaluate<string>('document.getElementById("s").value'),
      ).toBe('b');
    });

    it('should select option by label string (matching option label)', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <select id="s">
            <option value="a">Apple</option>
            <option value="b">Banana</option>
          </select>
        </body></html>`,
      );
      const sel = await page.locator('#s').selectOption('Banana');
      expect(sel).toEqual(['b']);
    });

    it('should select option by {label}', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <select id="s">
            <option value="a">Apple</option>
            <option value="b">Banana</option>
            <option value="c">Cherry</option>
          </select>
        </body></html>`,
      );
      const sel = await page.locator('#s').selectOption({ label: 'Cherry' });
      expect(sel).toEqual(['c']);
    });

    it('should select option by {value}', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <select id="s">
            <option value="a">Apple</option>
            <option value="b">Banana</option>
          </select>
        </body></html>`,
      );
      const sel = await page.locator('#s').selectOption({ value: 'a' });
      expect(sel).toEqual(['a']);
    });

    it('should select option by {index}', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <select id="s">
            <option value="a">Apple</option>
            <option value="b">Banana</option>
            <option value="c">Cherry</option>
          </select>
        </body></html>`,
      );
      const sel = await page.locator('#s').selectOption({ index: 2 });
      expect(sel).toEqual(['c']);
    });

    it('should select multiple options when given an array', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <select id="s" multiple>
            <option value="a">Apple</option>
            <option value="b">Banana</option>
            <option value="c">Cherry</option>
          </select>
        </body></html>`,
      );
      const sel = await page.locator('#s').selectOption(['a', 'c']);
      expect(sel).toEqual(expect.arrayContaining(['a', 'c']));
    });
  });

  describe('screenshot (locator)', () => {
    it('should take a screenshot of an element', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="t" style="width:200px;height:100px;background:red">Content</div></body></html>',
      );
      const buf = await page.locator('#t').screenshot();
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
    });

    it('should support jpeg format', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="t" style="width:200px;height:100px;background:blue">Content</div></body></html>',
      );
      const buf = await page.locator('#t').screenshot({ type: 'jpeg', quality: 60 });
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
    });
  });

  describe('waitFor', () => {
    it('should wait for state=visible', async () => {
      await page.goto('data:text/html,<html><body></body></html>');
      page.evaluate(`
        setTimeout(() => {
          document.body.innerHTML = '<div id="t">late</div>';
        }, 100);
      `);
      await page.locator('#t').waitFor({ state: 'visible', timeout: 5000 });
      expect(await page.locator('#t').textContent()).toBe('late');
    });

    it('should wait for state=attached', async () => {
      await page.goto('data:text/html,<html><body></body></html>');
      page.evaluate(`
        setTimeout(() => {
          document.body.innerHTML = '<div id="t">hi</div>';
        }, 100);
      `);
      await page.locator('#t').waitFor({ state: 'attached', timeout: 5000 });
      expect(await page.locator('#t').textContent()).toBe('hi');
    });

    it('should wait for state=hidden when element becomes hidden', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div id="t">x</div>
          <script>
            setTimeout(() => { document.getElementById('t').style.display = 'none'; }, 100);
          </script>
        </body></html>`,
      );
      await page.locator('#t').waitFor({ state: 'hidden', timeout: 5000 });
      expect(await page.locator('#t').isVisible()).toBe(false);
    });

    it('should wait for state=detached when element is removed', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div id="t">x</div>
          <script>
            setTimeout(() => { document.getElementById('t').remove(); }, 100);
          </script>
        </body></html>`,
      );
      await page.locator('#t').waitFor({ state: 'detached', timeout: 5000 });
      expect(await page.locator('#t').count()).toBe(0);
    });
  });

  describe('isHidden', () => {
    it('should return true for display:none element', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="t" style="display:none">x</div></body></html>',
      );
      expect(await page.locator('#t').isHidden()).toBe(true);
    });

    it('should return false for a visible element', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="t">x</div></body></html>',
      );
      expect(await page.locator('#t').isHidden()).toBe(false);
    });

    it('should return true for a non-existent element', async () => {
      await page.goto('data:text/html,<html><body></body></html>');
      expect(await page.locator('#nope').isHidden()).toBe(true);
    });
  });

  describe('isDisabled', () => {
    it('should return true for disabled input', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="i" disabled></body></html>',
      );
      expect(await page.locator('#i').isDisabled()).toBe(true);
    });

    it('should return false for enabled input', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="i"></body></html>',
      );
      expect(await page.locator('#i').isDisabled()).toBe(false);
    });

    it('isEnabled should return opposite of isDisabled', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="i" disabled></body></html>',
      );
      expect(await page.locator('#i').isEnabled()).toBe(false);
      expect(await page.locator('#i').isDisabled()).toBe(true);
    });
  });

  describe('boundingBox', () => {
    it('should return a non-null box with width/height', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="t" style="width:120px;height:80px;">x</div></body></html>',
      );
      const box = await page.locator('#t').boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(100);
      expect(box!.height).toBeGreaterThanOrEqual(60);
      expect(typeof box!.x).toBe('number');
      expect(typeof box!.y).toBe('number');
    });

    it('should return null for a non-existent element', async () => {
      await page.goto('data:text/html,<html><body></body></html>');
      expect(await page.locator('#nope').boundingBox()).toBeNull();
    });
  });

  describe('innerText', () => {
    it('should return visible inner text', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div id="t">
            <span>Hello</span>
            <span> World</span>
          </div>
        </body></html>`,
      );
      const txt = await page.locator('#t').innerText();
      expect(txt).toContain('Hello');
      expect(txt).toContain('World');
    });

    it('should throw when element does not exist', async () => {
      await page.goto('data:text/html,<html><body></body></html>');
      await expect(page.locator('#nope').innerText()).rejects.toThrow();
    });
  });

  describe('innerHTML', () => {
    it('should return inner HTML', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="t"><span>hi</span><b>x</b></div></body></html>',
      );
      const html = await page.locator('#t').innerHTML();
      expect(html).toContain('<span>hi</span>');
      expect(html).toContain('<b>x</b>');
    });

    it('should throw when element does not exist', async () => {
      await page.goto('data:text/html,<html><body></body></html>');
      await expect(page.locator('#nope').innerHTML()).rejects.toThrow();
    });
  });

  describe('getAttribute', () => {
    it('should return an existing attribute', async () => {
      await page.goto(
        'data:text/html,<html><body><a id="a" href="https://example.com" target="_blank">x</a></body></html>',
      );
      expect(await page.locator('#a').getAttribute('href')).toBe(
        'https://example.com',
      );
      expect(await page.locator('#a').getAttribute('target')).toBe('_blank');
    });

    it('should return null for missing attribute', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="t">x</div></body></html>',
      );
      expect(await page.locator('#t').getAttribute('data-missing')).toBeNull();
    });

    it('should return null for non-existent element', async () => {
      await page.goto('data:text/html,<html><body></body></html>');
      expect(await page.locator('#nope').getAttribute('id')).toBeNull();
    });
  });

  describe('evaluate (locator-scoped)', () => {
    it('should evaluate a function with the element as first arg', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="t" data-x="42">x</div></body></html>',
      );
      const v = await page
        .locator('#t')
        .evaluate<number>((el: HTMLElement) => Number(el.getAttribute('data-x')));
      expect(v).toBe(42);
    });

    it('should support string function body', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="i" value="hello"></body></html>',
      );
      const v = await page
        .locator('#i')
        .evaluate<string>('(el) => el.value');
      expect(v).toBe('hello');
    });

    it('should throw when element does not exist', async () => {
      await page.goto('data:text/html,<html><body></body></html>');
      await expect(
        page.locator('#nope').evaluate('(el) => el.tagName'),
      ).rejects.toThrow();
    });

    it('should accept extra arguments', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="t">3</div></body></html>',
      );
      const v = await page
        .locator('#t')
        .evaluate<number>(
          (el: HTMLElement, multiplier: number) =>
            Number(el.textContent!) * multiplier,
          10,
        );
      expect(v).toBe(30);
    });
  });

  describe('first / last / nth', () => {
    it('first() should resolve to the first matching element', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div><div class="i">A</div><div class="i">B</div><div class="i">C</div></div>
        </body></html>`,
      );
      expect(await page.locator('.i').first().textContent()).toBe('A');
    });

    it('last() should resolve to the last matching element', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div><div class="i">A</div><div class="i">B</div><div class="i">C</div></div>
        </body></html>`,
      );
      expect(await page.locator('.i').last().textContent()).toBe('C');
    });

    it('nth(1) should resolve to the second matching element', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div><div class="i">A</div><div class="i">B</div><div class="i">C</div></div>
        </body></html>`,
      );
      expect(await page.locator('.i').nth(1).textContent()).toBe('B');
    });

    it('should click first() of multiple buttons', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div>
            <button class="b" onclick="this.textContent='1'">A</button>
            <button class="b" onclick="this.textContent='2'">B</button>
            <button class="b" onclick="this.textContent='3'">C</button>
          </div>
        </body></html>`,
      );
      await page.locator('.b').first().click();
      expect(await page.locator('.b').first().textContent()).toBe('1');
    });

    it('should fill first() of multiple inputs', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div>
            <input class="ip" type="text">
            <input class="ip" type="text">
          </div>
        </body></html>`,
      );
      await page.locator('.ip').first().fill('first-val');
      expect(
        await page.evaluate<string>(
          'document.querySelectorAll(".ip")[0].value',
        ),
      ).toBe('first-val');
    });
  });

  describe('filter({ visible })', () => {
    it('should return a VisibleFilteredLocator when visible:true', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div class="t">V1</div>
          <div class="t" style="display:none">H1</div>
        </body></html>`,
      );
      const f = page.locator('.t').filter({ visible: true });
      expect(await f.count()).toBe(1);
    });

    it('should return regular locator when visible is false/undefined', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div class="t">V1</div>
          <div class="t" style="display:none">H1</div>
        </body></html>`,
      );
      expect(await page.locator('.t').filter({ visible: false }).count()).toBe(
        2,
      );
    });
  });

  describe('all', () => {
    it('should return an array of locators for all matches', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div><div class="row">1</div><div class="row">2</div><div class="row">3</div></div>
        </body></html>`,
      );
      const all = await page.locator('.row').all();
      expect(all).toHaveLength(3);
      expect(await all[0].textContent()).toBe('1');
      expect(await all[1].textContent()).toBe('2');
      expect(await all[2].textContent()).toBe('3');
    });

    it('should return empty array when no matches', async () => {
      await page.goto('data:text/html,<html><body></body></html>');
      const all = await page.locator('.nothing').all();
      expect(all).toHaveLength(0);
    });
  });

  describe('focus', () => {
    it('should focus an element', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="i" type="text"></body></html>',
      );
      await page.locator('#i').focus();
      expect(
        await page.evaluate<boolean>(
          'document.activeElement === document.getElementById("i")',
        ),
      ).toBe(true);
    });

    it('should focus a focusable div with tabindex', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="d" tabindex="0">x</div></body></html>',
      );
      await page.locator('#d').focus();
      expect(
        await page.evaluate<boolean>(
          'document.activeElement === document.getElementById("d")',
        ),
      ).toBe(true);
    });
  });

  describe('ariaSnapshot', () => {
    it('should return a non-empty string for a page with content', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <h1>Title</h1>
          <button>Submit</button>
          <a href="#">Link</a>
        </body></html>`,
      );
      const snap = await page.locator('body').ariaSnapshot();
      expect(typeof snap).toBe('string');
      expect(snap.length).toBeGreaterThan(0);
    });

    it('should contain role entries', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <h1>Heading</h1>
          <button>Action</button>
        </body></html>`,
      );
      const snap = await page.locator('body').ariaSnapshot();
      expect(snap).toMatch(/:/);
    });
  });

  describe('VisibleFilteredLocator', () => {
    const MIXED_HTML = `data:text/html,<html><body>
      <div id="host">
        <div class="t" id="a">VA</div>
        <div class="t" id="b" style="display:none">HB</div>
        <div class="t" id="c" style="visibility:hidden">HC</div>
        <div class="t" id="d">VD</div>
      </div>
    </body></html>`;

    it('count() should count only visible elements', async () => {
      await page.goto(MIXED_HTML);
      expect(await page.locator('.t').count()).toBe(4);
      const vis = page.locator('.t').filter({ visible: true });
      expect(await vis.count()).toBe(2);
    });

    it('isVisible() should return true when at least one is visible', async () => {
      await page.goto(MIXED_HTML);
      expect(
        await page.locator('.t').filter({ visible: true }).isVisible(),
      ).toBe(true);
    });

    it('isVisible() should return false when all are hidden', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div class="h" style="display:none">A</div>
          <div class="h" style="display:none">B</div>
        </body></html>`,
      );
      expect(
        await page.locator('.h').filter({ visible: true }).isVisible(),
      ).toBe(false);
    });

    it('textContent() should return text of first visible', async () => {
      await page.goto(MIXED_HTML);
      expect(
        await page.locator('.t').filter({ visible: true }).textContent(),
      ).toBe('VA');
    });

    it('innerText() should return inner text of first visible', async () => {
      await page.goto(MIXED_HTML);
      const t = await page
        .locator('.t')
        .filter({ visible: true })
        .innerText();
      expect(t).toContain('VA');
    });

    it('click() should click the first visible element', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div id="host">
            <div class="t" id="a" onclick="this.textContent='CLICKED'">VA</div>
            <div class="t" id="b" style="display:none">HB</div>
            <div class="t" id="c" onclick="this.textContent='WRONG'">VC</div>
          </div>
        </body></html>`,
      );
      await page.locator('.t').filter({ visible: true }).click();
      expect(
        await page.evaluate<string>('document.getElementById("a").textContent'),
      ).toBe('CLICKED');
      expect(
        await page.evaluate<string>('document.getElementById("c").textContent'),
      ).toBe('VC');
    });

    it('fill() should fill the first visible input', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div id="host">
            <input class="t" id="a" type="text">
            <input class="t" id="b" type="text" style="display:none">
            <input class="t" id="c" type="text">
          </div>
        </body></html>`,
      );
      await page.locator('.t').filter({ visible: true }).fill('hello');
      expect(
        await page.evaluate<string>('document.getElementById("a").value'),
      ).toBe('hello');
      expect(
        await page.evaluate<string>('document.getElementById("c").value'),
      ).toBe('');
    });

    it('press() should press on the first visible element', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div id="host">
            <input class="t" id="a" type="text">
            <input class="t" id="b" type="text" style="display:none">
            <input class="t" id="c" type="text">
          </div>
        </body></html>`,
      );
      await page.locator('.t').filter({ visible: true }).press('z');
      expect(
        await page.evaluate<string>('document.getElementById("a").value'),
      ).toBe('z');
    });

    it('hover() should hover the first visible element', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div id="host">
            <div class="t" id="a" onmouseover="this.textContent='HV'">A</div>
            <div class="t" id="b" style="display:none">B</div>
            <div class="t" id="c" onmouseover="this.textContent='WRONG'">C</div>
          </div>
        </body></html>`,
      );
      await page.locator('.t').filter({ visible: true }).hover();
      expect(
        await page.evaluate<string>('document.getElementById("a").textContent'),
      ).toBe('HV');
    });

    it('waitFor() should resolve when at least one is visible', async () => {
      await page.goto('data:text/html,<html><body></body></html>');
      page.evaluate(`
        setTimeout(() => {
          document.body.innerHTML = '<div class="t" style="display:none">A</div><div class="t">B</div>';
        }, 100);
      `);
      await page
        .locator('.t')
        .filter({ visible: true })
        .waitFor({ timeout: 5000 });
      expect(
        await page.locator('.t').filter({ visible: true }).count(),
      ).toBeGreaterThanOrEqual(1);
    });

    it('waitFor() should throw when no visible element appears in time', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div class="t" style="display:none">A</div>
        </body></html>`,
      );
      await expect(
        page.locator('.t').filter({ visible: true }).waitFor({ timeout: 500 }),
      ).rejects.toThrow(/visible/i);
    });

    it('should throw when no visible match exists for an action', async () => {
      await page.goto(
        `data:text/html,<html><body>
          <div class="t" style="display:none">A</div>
          <div class="t" style="display:none">B</div>
        </body></html>`,
      );
      await expect(
        page.locator('.t').filter({ visible: true }).click(),
      ).rejects.toThrow(/visible/i);
    });
  });
});
