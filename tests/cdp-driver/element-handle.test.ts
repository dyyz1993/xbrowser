import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { launch, type XBBrowser, type XBPage, type XBElementHandle } from '../../src/cdp-driver/index.js';

const TEST_TIMEOUT = 30_000;
const CDP_ENDPOINT = process.env.CDP_ENDPOINT || '';
const LAUNCH_OPTS = CDP_ENDPOINT
  ? { cdpEndpoint: CDP_ENDPOINT }
  : { headless: true, args: ['--no-sandbox', '--disable-gpu'] };

describe('CDP Driver ElementHandle', { timeout: TEST_TIMEOUT, hookTimeout: 60_000 }, () => {
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

  describe('$()', () => {
    it('should return an element handle for existing element', async () => {
      await page.goto('data:text/html,<html><body><div id="target">Hello</div></body></html>');
      const handle = await page.$('#target');
      expect(handle).not.toBeNull();
    });

    it('should return null for non-existent element', async () => {
      await page.goto('data:text/html,<html><body></body></html>');
      const handle = await page.$('#nonexistent');
      expect(handle).toBeNull();
    });
  });

  describe('$$()', () => {
    it('should return array of element handles', async () => {
      await page.goto(
        'data:text/html,<html><body><div class="item">A</div><div class="item">B</div><div class="item">C</div></body></html>',
      );
      const handles = await page.$$('.item');
      expect(handles).toHaveLength(3);
    });

    it('should return empty array for no matches', async () => {
      await page.goto('data:text/html,<html><body></body></html>');
      const handles = await page.$$('.nothing');
      expect(handles).toHaveLength(0);
    });
  });

  describe('click()', () => {
    it('should click an element', async () => {
      await page.goto(
        'data:text/html,<html><body><button id="btn" onclick="this.textContent=\'clicked\'">Click</button></body></html>',
      );
      const handle = await page.$('#btn');
      expect(handle).not.toBeNull();
      await handle!.click();
      const text = await page.evaluate<string>('document.getElementById("btn").textContent');
      expect(text).toBe('clicked');
    });

    it('should click with clickCount option for double-click', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="area" style="width:200px;height:200px;">0</div><script>let c=0;document.getElementById("area").addEventListener("click",()=>{c++;document.getElementById("area").textContent=c;})</script></body></html>',
      );
      const handle = await page.$('#area');
      expect(handle).not.toBeNull();
      await handle!.click({ clickCount: 2 });
      const count = await page.evaluate<string>('document.getElementById("area").textContent');
      expect(Number(count)).toBe(2);
    });

    it('should click with right button', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="area" style="width:200px;height:200px;">none</div><script>document.getElementById("area").addEventListener("contextmenu",e=>{e.preventDefault();document.getElementById("area").textContent="right";})</script></body></html>',
      );
      const handle = await page.$('#area');
      expect(handle).not.toBeNull();
      await handle!.click({ button: 'right' });
      const text = await page.evaluate<string>('document.getElementById("area").textContent');
      expect(text).toBe('right');
    });

    it('should throw on disposed element', async () => {
      await page.goto(
        'data:text/html,<html><body><button id="btn">Click</button></body></html>',
      );
      const handle = await page.$('#btn');
      expect(handle).not.toBeNull();
      handle!.dispose();
      await expect(handle!.click()).rejects.toThrow('Element handle disposed');
    });
  });

  describe('fill()', () => {
    it('should fill an input with text', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="inp" type="text"></body></html>',
      );
      const handle = await page.$('#inp');
      expect(handle).not.toBeNull();
      await handle!.fill('Hello World');
      const value = await page.evaluate<string>('document.getElementById("inp").value');
      expect(value).toBe('Hello World');
    });

    it('should overwrite existing value', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="inp" type="text" value="old"></body></html>',
      );
      const handle = await page.$('#inp');
      expect(handle).not.toBeNull();
      await handle!.fill('new');
      const value = await page.evaluate<string>('document.getElementById("inp").value');
      expect(value).toBe('new');
    });

    it('should throw on disposed element', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="inp" type="text"></body></html>',
      );
      const handle = await page.$('#inp');
      expect(handle).not.toBeNull();
      handle!.dispose();
      await expect(handle!.fill('test')).rejects.toThrow('Element handle disposed');
    });

    it('should fire input and change events', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="inp" type="text"><span id="log"></span><script>const i=document.getElementById("inp");const l=document.getElementById("log");i.addEventListener("input",()=>l.textContent+="i");i.addEventListener("change",()=>l.textContent+="c");</script></body></html>',
      );
      const handle = await page.$('#inp');
      expect(handle).not.toBeNull();
      await handle!.fill('test');
      const log = await page.evaluate<string>('document.getElementById("log").textContent');
      expect(log).toContain('i');
      expect(log).toContain('c');
    });
  });

  describe('hover()', () => {
    it('should hover over an element', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="hover" style="width:100px;height:100px;" onmouseenter="this.textContent=\'entered\'" onmouseleave="this.textContent=\'left\'">no</div></body></html>',
      );
      const handle = await page.$('#hover');
      expect(handle).not.toBeNull();
      await handle!.hover();
      const text = await page.evaluate<string>('document.getElementById("hover").textContent');
      expect(text).toBe('entered');
    });

    it('should throw if element has no box (display:none)', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="hidden" style="display:none;">Hidden</div></body></html>',
      );
      const handle = await page.$('#hidden');
      expect(handle).not.toBeNull();
      await expect(handle!.hover()).rejects.toThrow('Element has no box');
    });
  });

  describe('press()', () => {
    it('should press a key on focused element', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="inp" type="text"><div id="log"></div><script>document.getElementById("inp").addEventListener("keydown",e=>{document.getElementById("log").textContent+=e.key;})</script></body></html>',
      );
      const handle = await page.$('#inp');
      expect(handle).not.toBeNull();
      await handle!.press('a');
      await handle!.press('b');
      await handle!.press('c');
      const log = await page.evaluate<string>('document.getElementById("log").textContent');
      expect(log).toBe('abc');
    });

    it('should handle special keys', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="inp" type="text"><span id="log"></span><script>document.getElementById("inp").addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("log").textContent="enter";})</script></body></html>',
      );
      const handle = await page.$('#inp');
      expect(handle).not.toBeNull();
      await handle!.press('Enter');
      const log = await page.evaluate<string>('document.getElementById("log").textContent');
      expect(log).toBe('enter');
    });
  });

  describe('screenshot()', () => {
    it('should take element screenshot and return Buffer', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="target" style="width:200px;height:100px;background:red;">Content</div></body></html>',
      );
      const handle = await page.$('#target');
      expect(handle).not.toBeNull();
      const buf = await handle!.screenshot();
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
    });

    it('should throw if element has no box', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="hidden" style="display:none;">x</div></body></html>',
      );
      const handle = await page.$('#hidden');
      expect(handle).not.toBeNull();
      await expect(handle!.screenshot()).rejects.toThrow('Element has no box');
    });
  });

  describe('boundingBox()', () => {
    it('should return {x, y, width, height} for visible element', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="target" style="width:150px;height:75px;margin:10px;">Box</div></body></html>',
      );
      const handle = await page.$('#target');
      expect(handle).not.toBeNull();
      const box = await handle!.boundingBox();
      expect(box).not.toBeNull();
      expect(typeof box!.x).toBe('number');
      expect(typeof box!.y).toBe('number');
      expect(box!.width).toBeCloseTo(150, 0);
      expect(box!.height).toBeCloseTo(75, 0);
    });

    it('should return null for hidden element (display:none)', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="hidden" style="display:none;">x</div></body></html>',
      );
      const handle = await page.$('#hidden');
      expect(handle).not.toBeNull();
      const box = await handle!.boundingBox();
      expect(box).toBeNull();
    });
  });

  describe('isVisible()', () => {
    it('should return true for visible element', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="visible" style="width:100px;height:100px;">V</div></body></html>',
      );
      const handle = await page.$('#visible');
      expect(handle).not.toBeNull();
      const visible = await handle!.isVisible();
      expect(visible).toBe(true);
    });

    it('should return false for display:none element', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="dn" style="display:none;">x</div></body></html>',
      );
      const handle = await page.$('#dn');
      expect(handle).not.toBeNull();
      const visible = await handle!.isVisible();
      expect(visible).toBe(false);
    });

    it('should return false for visibility:hidden element', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="vh" style="visibility:hidden;width:50px;height:50px;">x</div></body></html>',
      );
      const handle = await page.$('#vh');
      expect(handle).not.toBeNull();
      const visible = await handle!.isVisible();
      expect(visible).toBe(false);
    });

    it('should return false for zero-size element', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="zero" style="width:0;height:0;overflow:hidden;">x</div></body></html>',
      );
      const handle = await page.$('#zero');
      expect(handle).not.toBeNull();
      const visible = await handle!.isVisible();
      expect(visible).toBe(false);
    });
  });

  describe('isEnabled()', () => {
    it('should return true for enabled element', async () => {
      await page.goto(
        'data:text/html,<html><body><button id="btn">Enabled</button></body></html>',
      );
      const handle = await page.$('#btn');
      expect(handle).not.toBeNull();
      expect(await handle!.isEnabled()).toBe(true);
    });

    it('should return false for disabled element', async () => {
      await page.goto(
        'data:text/html,<html><body><button id="btn" disabled>Disabled</button></body></html>',
      );
      const handle = await page.$('#btn');
      expect(handle).not.toBeNull();
      expect(await handle!.isEnabled()).toBe(false);
    });

    it('should return true for enabled input', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="inp" type="text"></body></html>',
      );
      const handle = await page.$('#inp');
      expect(handle).not.toBeNull();
      expect(await handle!.isEnabled()).toBe(true);
    });

    it('should return false for disabled input', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="inp" type="text" disabled></body></html>',
      );
      const handle = await page.$('#inp');
      expect(handle).not.toBeNull();
      expect(await handle!.isEnabled()).toBe(false);
    });
  });

  describe('textContent()', () => {
    it('should return text content of element', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="target">Hello Text</div></body></html>',
      );
      const handle = await page.$('#target');
      expect(handle).not.toBeNull();
      const text = await handle!.textContent();
      expect(text).toBe('Hello Text');
    });

    it('should return nested text content', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="outer"><span>A</span><span>B</span></div></body></html>',
      );
      const handle = await page.$('#outer');
      expect(handle).not.toBeNull();
      const text = await handle!.textContent();
      expect(text).toBe('AB');
    });

    it('should return null for empty element', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="empty"></div></body></html>',
      );
      const handle = await page.$('#empty');
      expect(handle).not.toBeNull();
      const text = await handle!.textContent();
      expect(text).toBe('');
    });
  });

  describe('innerText()', () => {
    it('should return inner text of element', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="target">Inner Text</div></body></html>',
      );
      const handle = await page.$('#target');
      expect(handle).not.toBeNull();
      const text = await handle!.innerText();
      expect(text).toBe('Inner Text');
    });

    it('should return text with line breaks for block elements', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="target"><p>Line1</p><p>Line2</p></div></body></html>',
      );
      const handle = await page.$('#target');
      expect(handle).not.toBeNull();
      const text = await handle!.innerText();
      expect(text).toContain('Line1');
      expect(text).toContain('Line2');
    });
  });

  describe('innerHTML()', () => {
    it('should return inner HTML of element', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="target"><span class="inner">text</span></div></body></html>',
      );
      const handle = await page.$('#target');
      expect(handle).not.toBeNull();
      const html = await handle!.innerHTML();
      expect(html).toContain('<span class="inner">text</span>');
    });

    it('should return empty for element with no children', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="empty"></div></body></html>',
      );
      const handle = await page.$('#empty');
      expect(handle).not.toBeNull();
      const html = await handle!.innerHTML();
      expect(html).toBe('');
    });
  });

  describe('getAttribute()', () => {
    it('should return existing attribute value', async () => {
      await page.goto(
        'data:text/html,<html><body><a id="link" href="https://example.com" target="_blank">Link</a></body></html>',
      );
      const handle = await page.$('#link');
      expect(handle).not.toBeNull();
      expect(await handle!.getAttribute('href')).toBe('https://example.com');
      expect(await handle!.getAttribute('target')).toBe('_blank');
    });

    it('should return null for non-existent attribute', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="target">x</div></body></html>',
      );
      const handle = await page.$('#target');
      expect(handle).not.toBeNull();
      expect(await handle!.getAttribute('data-missing')).toBeNull();
    });

    it('should handle special characters in attribute values', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="target" title="Hello &amp; &quot;World&quot;">x</div></body></html>',
      );
      const handle = await page.$('#target');
      expect(handle).not.toBeNull();
      const title = await handle!.getAttribute('title');
      expect(title).toContain('Hello');
      expect(title).toContain('World');
    });
  });

  describe('scrollIntoViewIfNeeded()', () => {
    it('should not throw for visible element', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="target" style="width:50px;height:50px;">x</div></body></html>',
      );
      const handle = await page.$('#target');
      expect(handle).not.toBeNull();
      await expect(handle!.scrollIntoViewIfNeeded()).resolves.toBeUndefined();
    });

    it('should scroll element into view', async () => {
      await page.goto(
        'data:text/html,<html><body><div style="height:2000px;"></div><div id="bottom" style="width:50px;height:50px;">Bottom</div></body></html>',
      );
      await page.setViewportSize({ width: 800, height: 600 });
      const handle = await page.$('#bottom');
      expect(handle).not.toBeNull();
      await handle!.scrollIntoViewIfNeeded();
      const scrollY = await page.evaluate<number>('window.scrollY');
      expect(scrollY).toBeGreaterThan(0);
    });

    it('should not throw on disposed element', async () => {
      await page.goto(
        'data:text/html,<html><body><div id="target">x</div></body></html>',
      );
      const handle = await page.$('#target');
      expect(handle).not.toBeNull();
      handle!.dispose();
      await expect(handle!.scrollIntoViewIfNeeded()).resolves.toBeUndefined();
    });
  });

  describe('dispose()', () => {
    it('should mark handle as disposed', async () => {
      await page.goto(
        'data:text/html,<html><body><button id="btn">Click</button></body></html>',
      );
      const handle = await page.$('#btn');
      expect(handle).not.toBeNull();
      handle!.dispose();
      await expect(handle!.click()).rejects.toThrow('Element handle disposed');
    });

    it('should not affect other handles of same element', async () => {
      await page.goto(
        'data:text/html,<html><body><button id="btn" onclick="this.textContent=\'ok\'">Click</button></body></html>',
      );
      const handle1 = await page.$('#btn');
      const handle2 = await page.$('#btn');
      expect(handle1).not.toBeNull();
      expect(handle2).not.toBeNull();
      handle1!.dispose();
      await expect(handle1!.click()).rejects.toThrow('Element handle disposed');
      await handle2!.click();
      const text = await page.evaluate<string>('document.getElementById("btn").textContent');
      expect(text).toBe('ok');
    });

    it('should cause fill() to throw', async () => {
      await page.goto(
        'data:text/html,<html><body><input id="inp" type="text"></body></html>',
      );
      const handle = await page.$('#inp');
      expect(handle).not.toBeNull();
      handle!.dispose();
      await expect(handle!.fill('test')).rejects.toThrow('Element handle disposed');
    });
  });

  describe('multiple handles via $$()', () => {
    it('should interact with each handle independently', async () => {
      await page.goto(
        'data:text/html,<html><body><input class="inp" type="text" value=""><input class="inp" type="text" value=""><input class="inp" type="text" value=""></body></html>',
      );
      const handles = await page.$$('.inp');
      expect(handles).toHaveLength(3);
      await handles[0].fill('first');
      await handles[1].fill('second');
      await handles[2].fill('third');
      const values = await page.evaluate<string[]>(
        'Array.from(document.querySelectorAll(".inp")).map(i=>i.value)',
      );
      expect(values).toEqual(['first', 'second', 'third']);
    });
  });
});
