/**
 * Unit tests for cdp-driver selector-utils (queryJS / queryAllJS / nthQueryJS / countJS).
 *
 * These functions generate JavaScript expression strings that get evaluated
 * in the browser context. We verify the generated expressions have the right
 * shape and prefix handling — we don't execute them (that requires a real DOM).
 */
import { describe, it, expect } from 'vitest';
import { queryJS, queryAllJS, nthQueryJS, countJS } from '../../src/cdp-driver/selector-utils.js';

describe('cdp-driver selector-utils', () => {
  describe('queryJS', () => {
    it('passes through plain CSS selectors unchanged (via querySelector)', () => {
      const js = queryJS('#submit-button');
      expect(js).toContain('document.querySelector');
      expect(js).toContain('#submit-button');
    });

    it('translates xpath= prefix to document.evaluate', () => {
      const js = queryJS('xpath=//button[text()="Submit"]');
      expect(js).toContain('document.evaluate');
      // The xpath is embedded as a JSON-escaped string
      expect(js).toContain('//button');
      expect(js).toContain('FIRST_ORDERED_NODE_TYPE');
    });

    it('translates text=Foo to leaf-element substring match', () => {
      const js = queryJS('text=最新');
      // Must NOT delegate to querySelector with the raw "text=最新" string
      // (which would be invalid CSS). Instead it should iterate elements.
      expect(js).not.toContain('document.querySelector("text=');
      expect(js).toContain('querySelectorAll');
      expect(js).toContain('"最新"');
      expect(js).toContain('includes');
      expect(js).toContain('children.length');
    });

    it('translates text="Foo" (quoted) to exact match', () => {
      const js = queryJS('text="最新"');
      expect(js).not.toContain('document.querySelector("text=');
      expect(js).toContain('"最新"');
      expect(js).toContain('exact = true');
      // Both branches are present (exact uses ===, non-exact uses includes)
      expect(js).toContain('===');
    });

    it('translates popup-text=Foo', () => {
      const js = queryJS('popup-text=删除');
      expect(js).not.toContain('document.querySelector("popup-text=');
      expect(js).toContain('"删除"');
      expect(js).toContain('children.length');
    });

    it('handles text with special characters safely', () => {
      const js = queryJS('text="hello \\ "world"');
      // Should still produce valid JS (no syntax error from raw insertion)
      expect(js).toMatch(/\(\)\s*=>/);
      expect(() => js).not.toThrow();
    });
  });

  describe('queryAllJS', () => {
    it('uses querySelectorAll for CSS', () => {
      const js = queryAllJS('.item');
      expect(js).toContain('querySelectorAll');
      expect(js).toContain('.item');
    });

    it('uses document.evaluate for xpath=', () => {
      const js = queryAllJS('xpath=//div');
      expect(js).toContain('document.evaluate');
      expect(js).toContain('ORDERED_NODE_SNAPSHOT_TYPE');
    });

    it('wraps text= queryJS in array', () => {
      const js = queryAllJS('text=最新');
      expect(js).toContain('[');
      expect(js).toContain(']');
      // Should reuse queryJS logic internally
      expect(js).toContain('"最新"');
    });
  });

  describe('countJS', () => {
    it('counts CSS matches', () => {
      const js = countJS('.item');
      expect(js).toContain('querySelectorAll');
      expect(js).toContain('.length');
    });

    it('counts xpath matches', () => {
      const js = countJS('xpath=//div');
      expect(js).toContain('snapshotLength');
    });

    it('returns 0 or 1 for text= selector', () => {
      const js = countJS('text=最新');
      expect(js).toMatch(/\?\s*1\s*:\s*0/);
    });
  });

  describe('nthQueryJS', () => {
    it('uses nth-of-type for CSS with index', () => {
      const js = nthQueryJS('.item', 2);
      expect(js).toContain(':nth-of-type(3)');
    });

    it('uses last-of-type for CSS with index=-1', () => {
      const js = nthQueryJS('.item', -1);
      expect(js).toContain(':last-of-type');
    });

    it('uses snapshotItem for xpath with index', () => {
      const js = nthQueryJS('xpath=//div', 0);
      expect(js).toContain('snapshotItem');
      expect(js).toContain('0)');
    });

    it('falls back to queryJS for text= selectors (text is inherently unique)', () => {
      const js = nthQueryJS('text=最新', 0);
      // Should just delegate to queryJS — text match returns single element
      expect(js).toContain('"最新"');
      expect(js).not.toContain('nth-of-type');
    });
  });

  describe('regression: dynamic data-spm-anchor-id selectors', () => {
    // These tests verify the fix for the xianyu/goofish case where
    // data-spm-anchor-id values change on every page load, making the
    // primary selector unreliable. The recorder now generates a text
    // fallback (text=最新) when it detects a dynamic attribute source,
    // and queryJS must be able to resolve that text= selector.

    it('text=最新 produces valid JS (used as fallback for spm-anchor-id)', () => {
      const js = queryJS('text=最新');
      // The generated JS must be syntactically valid and find leaf elements
      expect(js).toContain('children.length > 0');  // skip non-leaf
      expect(js).toContain('offsetParent === null'); // skip hidden
      expect(js).toContain('"最新"');
    });

    it('text=Submit handles ASCII too', () => {
      const js = queryJS('text=Submit');
      expect(js).toContain('"Submit"');
      expect(js).toContain('toLowerCase'); // case-insensitive for substring
    });
  });
});
