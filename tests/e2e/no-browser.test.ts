import { describe, it, expect } from 'vitest';
import {
  parseCommandChain,
  splitCommand,
  parseCommandArgs,
  normalizeSelector,
  generateJSScript,
  generatePythonScript,
  generateBashScript,
  extractRecording,
  filterRecording,
  parseExcludeTypes,
} from '../../src/index.js';
import type { Recording } from '../../src/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

describe('E2E: Chain Parser - Real-world inputs', () => {
  it('should parse a typical automation chain', () => {
    const input = "goto https://example.com && title && click '#btn'";
    const result = parseCommandChain(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('and');
    expect(result[0].pipeline).toEqual([
      'goto https://example.com',
      'title',
      "click '#btn'",
    ]);
  });

  it('should parse fill + submit chain', () => {
    const input = "goto https://google.com && fill -s '#search' -v 'playwright' && click -s '#btn'";
    const result = parseCommandChain(input);
    expect(result).toHaveLength(1);
    expect(result[0].pipeline).toHaveLength(3);

    const fillParts = splitCommand("fill -s '#search' -v 'playwright'");
    expect(fillParts).toEqual(["fill", "-s", "'#search'", "-v", "'playwright'"]);

    const fillArgs = parseCommandArgs('fill', ["-s", "#search", "-v", "playwright"]);
    expect(fillArgs.params.selector).toBe('#search');
    expect(fillArgs.params.value).toBe('playwright');
  });

  it('should parse OR chains for fallback', () => {
    const input = "click '#btn1' || click '#btn2' || click '#btn3'";
    const result = parseCommandChain(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('or');
    expect(result[0].pipeline).toHaveLength(3);
  });

  it('should parse semicolon-separated sequences', () => {
    const input = "goto https://a.com ; goto https://b.com";
    const result = parseCommandChain(input);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('and');
    expect(result[1].type).toBe('and');
  });

  it('should handle complex chain with eval', () => {
    const input = "goto https://example.com && eval 'document.querySelectorAll(\"a\").length'";
    const result = parseCommandChain(input);
    expect(result[0].pipeline).toHaveLength(2);

    const evalParts = splitCommand("eval 'document.querySelectorAll(\"a\").length'");
    expect(evalParts[0]).toBe('eval');
  });

  it('should handle quoted selectors with special chars', () => {
    const parts = splitCommand("click '[data-testid=\"submit-btn\"]'");
    expect(parts[0]).toBe('click');
    expect(parts[1]).toContain('data-testid');
  });
});

describe('E2E: Selector Normalization', () => {
  it('should auto-prefix bare words with #', () => {
    expect(normalizeSelector('btn')).toBe('#btn');
    expect(normalizeSelector('username')).toBe('#username');
  });

  it('should not modify ID selectors', () => {
    expect(normalizeSelector('#btn')).toBe('#btn');
  });

  it('should not modify class selectors', () => {
    expect(normalizeSelector('.submit')).toBe('.submit');
  });

  it('should not modify attribute selectors', () => {
    expect(normalizeSelector('[data-id=x]')).toBe('[data-id=x]');
  });

  it('should not modify pseudo selectors', () => {
    expect(normalizeSelector(':nth-child(2)')).toBe(':nth-child(2)');
  });

  it('should not modify xpath-like selectors', () => {
    expect(normalizeSelector('//div')).toBe('//div');
  });

  it('should return empty string for empty input', () => {
    expect(normalizeSelector('')).toBe('');
  });
});

describe('E2E: Convert recording to scripts', () => {
    const recording: Recording = {
      startUrl: 'https://example.com',
      id: 'test-rec',
      name: 'Test',
      events: [
        { type: 'click', selector: '#btn', timestamp: 1000 },
        { type: 'input', selector: '#input', data: { value: 'hello' }, timestamp: 2000 },
        { type: 'keydown', data: { key: 'Enter' }, timestamp: 2500 },
        { type: 'scroll', data: { x: 0, y: 300 }, timestamp: 3000 },
      ],
    };

    const recordingWithEnter: Recording = {
      startUrl: 'https://example.com',
      events: [
        { type: 'keydown', data: { key: 'Enter' }, timestamp: 1000 },
      ],
    };

  it('should generate a valid JavaScript replay script', () => {
    const script = generateJSScript(recording);
    expect(script).toContain("import { launch } from '@xbrowser/cli'");
    expect(script).toContain("const START_URL = 'https://example.com'");
    expect(script).toContain("page.click('#btn')");
    expect(script).toContain("page.fill('#input', 'hello')");
    expect(script).toContain('scrollTo(0, 300)');
  });

  it('FIXED: aggregateEvents preserves standalone Enter/Tab keydown events', () => {
    const enterRecording: Recording = {
      startUrl: 'https://example.com',
      events: [
        { type: 'keydown', data: { key: 'Enter' }, timestamp: 1000 },
      ],
    };
    const script = generateJSScript(enterRecording);
    expect(script).toContain("keyboard.press('Enter')");
  });

  it('should generate a valid Python replay script', () => {
    const script = generatePythonScript(recording);
    expect(script).toContain('from playwright.async_api import async_playwright');
    expect(script).toContain("await page.click('#btn')");
    expect(script).toContain("await page.fill('#input', 'hello')");
  });

  it('should generate a valid Bash replay script', () => {
    const script = generateBashScript(recording);
    expect(script).toContain('#!/bin/bash');
    expect(script).toContain('CDP_URL');
    expect(script).toContain('example.com');
  });

  it('should escape special characters in generated scripts', () => {
    const recordingWithSpecial: Recording = {
      startUrl: "https://example.com?foo='bar'",
      events: [
        { type: 'input', selector: "#input", data: { value: "it's a \"test\"" }, timestamp: 1000 },
      ],
    };
    const js = generateJSScript(recordingWithSpecial);
    expect(js).toContain("it\\'s a \\\"test\\\"");
  });
});

describe('E2E: Extract recording summary', () => {
  const fixturePath = path.join(FIXTURES_DIR, 'sample-recording.yaml');

  it('should extract a summary from a recording file', () => {
    const summary = extractRecording(fixturePath);
    expect(summary.startUrl).toBe('https://example.com');
    expect(summary.totalEvents).toBe(6);
    expect(summary.keyEventsCount).toBeGreaterThan(0);
    expect(summary.operations.length).toBeGreaterThan(0);
  });

  it('should count event types correctly', () => {
    const summary = extractRecording(fixturePath);
    expect(summary.eventTypes.click).toBe(2);
    expect(summary.eventTypes.input).toBe(1);
    expect(summary.eventTypes.scroll).toBe(1);
  });

  it('should include operation details', () => {
    const summary = extractRecording(fixturePath);
    const clickOp = summary.operations.find((op) => op.type === 'click');
    expect(clickOp).toBeDefined();
    expect(clickOp!.selector).toBe('#btn');
  });
});

describe('E2E: Filter recording events', () => {
  const fixturePath = path.join(FIXTURES_DIR, 'sample-recording.yaml');

  it('should parse exclude types from CLI args', () => {
    expect(parseExcludeTypes(['--exclude-types=scroll,keydown'])).toEqual(['scroll', 'keydown']);
    expect(parseExcludeTypes([])).toBeUndefined();
  });

  it('should filter out specified event types', () => {
    const outputPath = path.join(FIXTURES_DIR, 'filtered-output.yaml');
    const result = filterRecording(fixturePath, outputPath, ['scroll', 'keydown']);
    expect(result.filteredCount).toBeGreaterThan(0);
    expect(result.originalCount).toBe(6);
    expect(result.removed).toBeGreaterThan(0);
  });
});

describe('E2E: Command argument parsing', () => {
  it('should parse goto with URL as positional', () => {
    const { params } = parseCommandArgs('goto', ['https://example.com']);
    expect(params.url).toBe('https://example.com');
  });

  it('should parse click with selector flag', () => {
    const { params } = parseCommandArgs('click', ['-s', '#btn']);
    expect(params.selector).toBe('#btn');
  });

  it('should parse fill with selector and value flags', () => {
    const { params } = parseCommandArgs('fill', ['-s', '#input', '-v', 'hello']);
    expect(params.selector).toBe('#input');
    expect(params.value).toBe('hello');
  });

  it('should parse screenshot with full-page flag', () => {
    const { params } = parseCommandArgs('screenshot', ['--full-page']);
    expect(params['full-page']).toBe(true);
  });

  it('should parse scroll with direction and distance', () => {
    const { params } = parseCommandArgs('scroll', ['down', '--distance', '300']);
    expect(params.direction).toBe('down');
    expect(params.distance).toBe(300);
  });

  it('should parse eval with quoted expression', () => {
    const { params } = parseCommandArgs('eval', ["document.title"]);
    expect(params.expression).toBe('document.title');
  });

  it('should parse click with positional selector', () => {
    const { params } = parseCommandArgs('click', ['btn']);
    expect(params.selector).toBe('btn');
  });

  it('should parse fill with positional selector and value', () => {
    const { params } = parseCommandArgs('fill', ['#search', 'hello world']);
    expect(params.selector).toBe('#search');
    expect(params.value).toBe('hello world');
  });

  it('should coerce numeric values', () => {
    const { params } = parseCommandArgs('scroll', ['down', '--distance', '500']);
    expect(params.distance).toBe(500);
    expect(typeof params.distance).toBe('number');
  });

  it('should coerce boolean values', () => {
    const { params } = parseCommandArgs('click', ['--delay', '100']);
    expect(params.delay).toBe(100);
  });
});
