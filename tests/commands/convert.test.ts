import { describe, it, expect } from 'vitest';

import {
  generateJSScript,
  generatePythonScript,
  generateBashScript,
} from '../../src/commands/convert.js';
import type { Recording } from '../../src/commands/definitions.js';

const baseRecording: Recording = {
  startUrl: 'https://example.com',
  events: [],
};

describe('convert', () => {
  describe('generateJSScript', () => {
    it('should generate a valid JS script with shebang', () => {
      const script = generateJSScript(baseRecording);
      expect(script).toContain('#!/usr/bin/env node');
      expect(script).toContain("import { chromium } from 'playwright'");
    });

    it('should include start URL in script', () => {
      const script = generateJSScript(baseRecording);
      expect(script).toContain('https://example.com');
    });

    it('should generate click events', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'click', selector: '#btn' }],
      };
      const script = generateJSScript(rec);
      expect(script).toContain("page.click('#btn')");
    });

    it('should generate input/type events', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'type', selector: '#input', data: { value: 'hello' } }],
      };
      const script = generateJSScript(rec);
      expect(script).toContain("page.fill('#input', 'hello')");
    });

    it('should generate Enter keypress events', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'keydown', data: { key: 'Enter' } }],
      };
      const script = generateJSScript(rec);
      expect(script).toContain("keyboard.press('Enter')");
    });

    it('should skip non-Enter keypress events', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'keydown', data: { key: 'Tab' } }],
      };
      const script = generateJSScript(rec);
      expect(script).not.toContain('keyboard.press');
    });

    it('should generate scroll events', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'scroll', data: { x: 100, y: 200 } }],
      };
      const script = generateJSScript(rec);
      expect(script).toContain('scrollTo(100, 200)');
    });

    it('should escape special characters in selectors', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'click', selector: "#btn[data-id='test']" }],
      };
      const script = generateJSScript(rec);
      expect(script).toContain("\\'");
    });

    it('should skip navigate/page_load events', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'navigate' }, { type: 'page_load' }],
      };
      const script = generateJSScript(rec);
      expect(script).not.toContain('Runtime.evaluate');
    });

    it('should handle empty events', () => {
      const script = generateJSScript(baseRecording);
      expect(script).toContain('Replay completed');
      expect(script).toContain('browser.close');
    });
  });

  describe('generatePythonScript', () => {
    it('should generate a valid Python script with shebang', () => {
      const script = generatePythonScript(baseRecording);
      expect(script).toContain('#!/usr/bin/env python3');
      expect(script).toContain('from playwright.async_api import async_playwright');
    });

    it('should generate click events in Python', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'click', selector: '.btn' }],
      };
      const script = generatePythonScript(rec);
      expect(script).toContain("page.click('.btn')");
    });

    it('should generate input events in Python', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'input', selector: '#field', data: { value: 'test' } }],
      };
      const script = generatePythonScript(rec);
      expect(script).toContain("page.fill('#field', 'test')");
    });

    it('should generate Enter keypress in Python', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'keypress', data: { key: 'Enter' } }],
      };
      const script = generatePythonScript(rec);
      expect(script).toContain("keyboard.press('Enter')");
    });

    it('should skip non-Enter keypress in Python', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'keypress', data: { key: 'Escape' } }],
      };
      const script = generatePythonScript(rec);
      expect(script).not.toContain('keyboard.press');
    });
  });

  describe('generateBashScript', () => {
    it('should generate a valid Bash script with shebang', () => {
      const script = generateBashScript(baseRecording);
      expect(script).toContain('#!/bin/bash');
      expect(script).toContain('CDP_URL');
    });

    it('should generate click events via curl', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'click', selector: '#btn' }],
      };
      const script = generateBashScript(rec);
      expect(script).toContain('document.querySelector');
      expect(script).toContain('#btn');
    });

    it('should generate input events via curl', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [{ type: 'input', selector: '#field', data: { value: 'hello' } }],
      };
      const script = generateBashScript(rec);
      expect(script).toContain('#field');
      expect(script).toContain('hello');
    });

    it('should handle empty events', () => {
      const script = generateBashScript(baseRecording);
      expect(script).toContain('Replay completed');
    });
  });

  describe('aggregateEvents', () => {
    it('should aggregate consecutive input events into fill', () => {
      const rec: Recording = {
        ...baseRecording,
        events: [
          { type: 'input', selector: '#f', data: { value: 'a' } },
          { type: 'input', selector: '#f', data: { value: 'ab' } },
        ],
      };
      const script = generateJSScript(rec);
      expect(script).toContain("page.fill('#f', 'ab')");
    });
  });
});
