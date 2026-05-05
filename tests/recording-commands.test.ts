import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateJSScript, generatePythonScript, generateBashScript } from '../src/commands/convert.js';
import { extractRecording, extractAndSave } from '../src/commands/extract.js';
import { filterRecording, parseExcludeTypes } from '../src/commands/filter.js';
import type { Recording } from '../src/commands/definitions.js';

const sampleRecording: Recording = {
  startUrl: 'https://example.com',
  events: [
    { type: 'click', selector: '#btn', timestamp: 100, data: { x: 10, y: 20 } },
    { type: 'input', selector: '#search', timestamp: 200, data: { value: 'hello' } },
    { type: 'keydown', selector: '#search', timestamp: 250, data: { key: 'Enter' } },
    { type: 'mousemove', timestamp: 300, data: { x: 100, y: 200 } },
    { type: 'click', selector: '#link', timestamp: 400 },
    { type: 'blur', selector: '#search', timestamp: 500 },
    { type: 'focus', selector: '#input2', timestamp: 600 },
    { type: 'scroll', timestamp: 700, data: { x: 0, y: 500 } },
  ],
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xbrowser-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('generateJSScript', () => {
  it('generates a valid Node.js script', () => {
    const script = generateJSScript(sampleRecording);
    expect(script).toContain('#!/usr/bin/env node');
    expect(script).toContain("const START_URL = 'https://example.com'");
    expect(script).toContain("await page.click('#btn')");
    expect(script).toContain("await page.fill('#search', 'hello')");
    expect(script).toContain('await browser.close()');
  });

  it('aggregates input + keydown events', () => {
    const script = generateJSScript(sampleRecording);
    const fillCount = (script.match(/page\.fill/g) || []).length;
    expect(fillCount).toBe(1);
  });
});

describe('generatePythonScript', () => {
  it('generates a valid Python script', () => {
    const script = generatePythonScript(sampleRecording);
    expect(script).toContain('#!/usr/bin/env python3');
    expect(script).toContain('from playwright.async_api import async_playwright');
    expect(script).toContain("await page.click('#btn')");
    expect(script).toContain("await page.fill('#search', 'hello')");
  });
});

describe('generateBashScript', () => {
  it('generates a valid Bash script', () => {
    const script = generateBashScript(sampleRecording);
    expect(script).toContain('#!/bin/bash');
    expect(script).toContain('CDP_URL=');
    expect(script).toContain("document.querySelector('#btn').click()");
  });
});

describe('extractRecording', () => {
  it('extracts summary from recording file', () => {
    const yamlPath = path.join(tmpDir, 'test.yaml');
    const yaml = require('yaml');
    fs.writeFileSync(yamlPath, yaml.stringify(sampleRecording));

    const summary = extractRecording(yamlPath);
    expect(summary.startUrl).toBe('https://example.com');
    expect(summary.totalEvents).toBe(8);
    expect(summary.keyEventsCount).toBe(4);
    expect(summary.eventTypes.click).toBe(2);
    expect(summary.eventTypes.input).toBe(1);
    expect(summary.operations).toHaveLength(4);
    expect(summary.operations[0].type).toBe('click');
    expect(summary.operations[0].selector).toBe('#btn');
  });

  it('saves summary JSON file', () => {
    const yaml = require('yaml');
    const yamlPath = path.join(tmpDir, 'test.yaml');
    fs.writeFileSync(yamlPath, yaml.stringify(sampleRecording));

    const { summary, outputPath } = extractAndSave(yamlPath);
    expect(outputPath).toBe(path.join(tmpDir, 'test-summary.json'));
    expect(fs.existsSync(outputPath)).toBe(true);
    const json = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    expect(json.startUrl).toBe('https://example.com');
  });
});

describe('filterRecording', () => {
  it('filters out default excluded types', () => {
    const yaml = require('yaml');
    const inputPath = path.join(tmpDir, 'input.yaml');
    const outputPath = path.join(tmpDir, 'output.yaml');
    fs.writeFileSync(inputPath, yaml.stringify(sampleRecording));

    const result = filterRecording(inputPath, outputPath);
    expect(result.originalCount).toBe(8);
    expect(result.filteredCount).toBe(6);
    expect(result.removed).toBe(2);

    const filtered = yaml.parse(fs.readFileSync(outputPath, 'utf-8'));
    const types = filtered.events.map((e: { type: string }) => e.type);
    expect(types).not.toContain('blur');
    expect(types).not.toContain('focus');
    expect(types).toContain('click');
    expect(types).toContain('input');
  });

  it('filters custom exclude types', () => {
    const yaml = require('yaml');
    const inputPath = path.join(tmpDir, 'input.yaml');
    const outputPath = path.join(tmpDir, 'output.yaml');
    fs.writeFileSync(inputPath, yaml.stringify(sampleRecording));

    const result = filterRecording(inputPath, outputPath, ['click', 'mousemove']);
    expect(result.filteredCount).toBe(5);
    expect(result.removed).toBe(3);
  });

  it('handles empty events', () => {
    const yaml = require('yaml');
    const inputPath = path.join(tmpDir, 'input.yaml');
    const outputPath = path.join(tmpDir, 'output.yaml');
    fs.writeFileSync(inputPath, yaml.stringify({ startUrl: 'https://example.com', events: [] }));

    const result = filterRecording(inputPath, outputPath);
    expect(result.originalCount).toBe(0);
    expect(result.filteredCount).toBe(0);
    expect(result.percentage).toBe(0);
  });
});

describe('parseExcludeTypes', () => {
  it('parses exclude types from args', () => {
    expect(parseExcludeTypes(['--exclude-types=click,input,mousemove'])).toEqual([
      'click',
      'input',
      'mousemove',
    ]);
  });

  it('returns undefined when no exclude types flag', () => {
    expect(parseExcludeTypes(['--other-flag'])).toBeUndefined();
    expect(parseExcludeTypes([])).toBeUndefined();
  });
});
