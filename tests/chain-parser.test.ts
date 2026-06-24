import { describe, it, expect } from 'vitest';
import {
  parseCommandChain,
  splitCommand,
  parseCommandArgs,
} from '../src/chain-parser.js';
import { normalizeSelector } from '../src/utils/selector.js';

describe('parseCommandChain', () => {
  it('parses a simple single command', () => {
    const result = parseCommandChain('goto https://example.com');
    expect(result).toHaveLength(1);
    expect(result[0].pipeline).toEqual(['goto https://example.com']);
    expect(result[0].type).toBe('and');
  });

  it('parses commands joined with &&', () => {
    const result = parseCommandChain('goto https://example.com && title');
    expect(result).toHaveLength(1);
    expect(result[0].pipeline).toEqual(['goto https://example.com', 'title']);
    expect(result[0].type).toBe('and');
  });

  it('parses commands joined with ||', () => {
    const result = parseCommandChain('goto https://a.com || goto https://b.com');
    expect(result).toHaveLength(1);
    expect(result[0].pipeline).toEqual(['goto https://a.com', 'goto https://b.com']);
    expect(result[0].type).toBe('or');
  });

  it('parses commands joined with ;', () => {
    const result = parseCommandChain('goto https://example.com ; title');
    expect(result).toHaveLength(2);
    expect(result[0].pipeline).toEqual(['goto https://example.com']);
    expect(result[0].type).toBe('sequence');
    expect(result[1].pipeline).toEqual(['title']);
    expect(result[1].type).toBe('and');
  });

  it('handles mixed chain operators', () => {
    const result = parseCommandChain('goto https://example.com && title ; screenshot');
    expect(result).toHaveLength(2);
    expect(result[0].pipeline).toEqual(['goto https://example.com', 'title']);
    expect(result[0].type).toBe('sequence');
    expect(result[1].pipeline).toEqual(['screenshot']);
  });

  it('handles quoted strings with && inside', () => {
    const result = parseCommandChain("fill '#input' 'hello && world' && title");
    expect(result).toHaveLength(1);
    expect(result[0].pipeline).toHaveLength(2);
    expect(result[0].pipeline[0]).toBe("fill '#input' 'hello && world'");
    expect(result[0].pipeline[1]).toBe('title');
  });

  it('handles double quotes with special chars', () => {
    const result = parseCommandChain('fill "#input" "hello world" && title');
    expect(result).toHaveLength(1);
    expect(result[0].pipeline).toHaveLength(2);
    expect(result[0].pipeline[0]).toBe('fill "#input" "hello world"');
  });

  it('handles CSS selectors with special chars', () => {
    const result = parseCommandChain("click '#btn.primary' && fill 'input[name=\"email\"]' 'test@test.com'");
    expect(result).toHaveLength(1);
    expect(result[0].pipeline).toHaveLength(2);
    expect(result[0].pipeline[0]).toBe("click '#btn.primary'");
    expect(result[0].pipeline[1]).toBe("fill 'input[name=\"email\"]' 'test@test.com'");
  });

  it('handles multiple ; separated commands', () => {
    const result = parseCommandChain('goto https://a.com ; goto https://b.com ; title');
    expect(result).toHaveLength(3);
    expect(result[0].pipeline).toEqual(['goto https://a.com']);
    expect(result[1].pipeline).toEqual(['goto https://b.com']);
    expect(result[2].pipeline).toEqual(['title']);
  });

  it('handles empty input', () => {
    const result = parseCommandChain('');
    expect(result).toHaveLength(0);
  });

  it('handles trailing &&', () => {
    const result = parseCommandChain('title &&');
    expect(result).toHaveLength(1);
    expect(result[0].pipeline).toEqual(['title']);
  });

  it('parses commands separated by comma (sequence, continues on failure)', () => {
    const result = parseCommandChain('goto url, title, click btn');
    expect(result).toHaveLength(3);
    expect(result[0].pipeline).toEqual(['goto url']);
    expect(result[0].type).toBe('sequence');
    expect(result[1].pipeline).toEqual(['title']);
    expect(result[2].pipeline).toEqual(['click btn']);
  });

  it('parses commands separated by comma with spaces', () => {
    const result = parseCommandChain('goto url , title , click btn');
    expect(result).toHaveLength(3);
    expect(result[0].pipeline).toEqual(['goto url']);
    expect(result[0].type).toBe('sequence');
    expect(result[1].pipeline).toEqual(['title']);
    expect(result[2].pipeline).toEqual(['click btn']);
  });

  it('parses commands separated by plus (sequence, continues on failure)', () => {
    const result = parseCommandChain('goto url + title + click btn');
    expect(result).toHaveLength(3);
    expect(result[0].pipeline).toEqual(['goto url']);
    expect(result[0].type).toBe('sequence');
    expect(result[1].pipeline).toEqual(['title']);
    expect(result[2].pipeline).toEqual(['click btn']);
  });

  it('parses commands separated by arrow (sequence, continues on failure)', () => {
    const result = parseCommandChain('goto url -> title -> click btn');
    expect(result).toHaveLength(3);
    expect(result[0].pipeline).toEqual(['goto url']);
    expect(result[0].type).toBe('sequence');
    expect(result[1].pipeline).toEqual(['title']);
    expect(result[2].pipeline).toEqual(['click btn']);
  });

  it('does not split comma without space (value comma)', () => {
    const result = parseCommandChain('fill input,hello world');
    expect(result).toHaveLength(1);
    expect(result[0].pipeline).toEqual(['fill input,hello world']);
  });

  it('does not split plus without space (url+path)', () => {
    const result = parseCommandChain('goto url+path');
    expect(result).toHaveLength(1);
    expect(result[0].pipeline).toEqual(['goto url+path']);
  });

  it('does not split arrow without spaces', () => {
    const result = parseCommandChain('title->click');
    expect(result).toHaveLength(1);
    expect(result[0].pipeline).toEqual(['title->click']);
  });

  it('parses pipe separator in file mode', () => {
    const result = parseCommandChain('goto url | title | click btn', { fileMode: true });
    expect(result).toHaveLength(1);
    expect(result[0].pipeline).toEqual(['goto url', 'title', 'click btn']);
    expect(result[0].type).toBe('and');
  });

  it('does not split || as pipe in file mode', () => {
    const result = parseCommandChain('goto a || goto b', { fileMode: true });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('or');
    expect(result[0].pipeline).toEqual(['goto a', 'goto b']);
  });

  it('mixed comma and && separators', () => {
    const result = parseCommandChain('goto url, title && click btn');
    // comma creates a sequence pipeline, && is within the second pipeline
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].pipeline).toEqual(['goto url']);
    expect(result[0].type).toBe('sequence');
  });

  it('comma with semicolon creates separate pipelines', () => {
    const result = parseCommandChain('goto url, title ; screenshot');
    // comma = sequence, semicolon = sequence → 3 separate pipelines
    expect(result).toHaveLength(3);
    expect(result[0].pipeline).toEqual(['goto url']);
    expect(result[1].pipeline).toEqual(['title']);
    expect(result[2].pipeline).toEqual(['screenshot']);
  });
});

describe('splitCommand', () => {
  it('splits a simple command', () => {
    expect(splitCommand('goto https://example.com')).toEqual([
      'goto',
      'https://example.com',
    ]);
  });

  it('respects single quotes', () => {
    expect(splitCommand("click '#btn'")).toEqual(['click', "'#btn'"]);
  });

  it('respects double quotes', () => {
    expect(splitCommand('fill "#input" "hello world"')).toEqual([
      'fill',
      '"#input"',
      '"hello world"',
    ]);
  });

  it('handles multiple spaces', () => {
    expect(splitCommand('goto   https://example.com')).toEqual([
      'goto',
      'https://example.com',
    ]);
  });

  it('handles selectors with special chars in quotes', () => {
    expect(splitCommand("click 'div.class > span'")).toEqual([
      'click',
      "'div.class > span'",
    ]);
  });

  it('handles named args', () => {
    expect(splitCommand('goto --url https://example.com --waitUntil networkidle')).toEqual([
      'goto',
      '--url',
      'https://example.com',
      '--waitUntil',
      'networkidle',
    ]);
  });
});

describe('parseCommandArgs', () => {
  it('parses goto with positional url', () => {
    const { command, params } = parseCommandArgs('goto', ['https://example.com']);
    expect(command).toBe('goto');
    expect(params.url).toBe('https://example.com');
  });

  it('parses goto with named args', () => {
    const { command, params } = parseCommandArgs('goto', [
      '--url',
      'https://example.com',
      '--waitUntil',
      'networkidle',
    ]);
    expect(params.url).toBe('https://example.com');
    expect(params.waitUntil).toBe('networkidle');
  });

  it('parses click with positional selector', () => {
    const { command, params } = parseCommandArgs('click', ["'#btn'"]);
    expect(command).toBe('click');
    expect(params.selector).toBe('#btn');
  });

  it('parses fill with positional selector and value', () => {
    const { command, params } = parseCommandArgs('fill', ["'#input'", "'hello world'"]);
    expect(command).toBe('fill');
    expect(params.selector).toBe('#input');
    expect(params.value).toBe('hello world');
  });

  it('parses named args with boolean flags', () => {
    const { params } = parseCommandArgs('screenshot', ['--full-page']);
    expect(params['full-page']).toBe(true);
  });

  it('parses named args with numeric values', () => {
    const { params } = parseCommandArgs('wait', ["'#btn'", '--timeout', '5000']);
    expect(params.selector).toBe('#btn');
    expect(params.timeout).toBe(5000);
  });

  it('handles unknown commands gracefully', () => {
    const { command, params } = parseCommandArgs('custom', ['arg1', 'arg2']);
    expect(command).toBe('custom');
    expect(Object.keys(params)).toHaveLength(0);
  });

  it('parses click with -s short flag', () => {
    const { command, params } = parseCommandArgs('click', ['-s', '#btn']);
    expect(command).toBe('click');
    expect(params.selector).toBe('#btn');
  });

  it('parses fill with -s and -v short flags', () => {
    const { params } = parseCommandArgs('fill', ['-s', '#input', '-v', 'hello']);
    expect(params.selector).toBe('#input');
    expect(params.value).toBe('hello');
  });

  it('parses click with --selector long flag', () => {
    const { params } = parseCommandArgs('click', ['--selector', '#btn']);
    expect(params.selector).toBe('#btn');
  });

  it('parses fill with --selector and --value long flags', () => {
    const { params } = parseCommandArgs('fill', ['--selector', '#input', '--value', 'hello']);
    expect(params.selector).toBe('#input');
    expect(params.value).toBe('hello');
  });

  it('mixes positional and long flags', () => {
    const { params } = parseCommandArgs('fill', ['#input', '--value', 'hello']);
    expect(params.selector).toBe('#input');
    expect(params.value).toBe('hello');
  });
});

describe('normalizeSelector', () => {
  it('auto-prefixes # for simple names', () => {
    expect(normalizeSelector('btn')).toBe('#btn');
  });

  it('keeps # selectors as-is', () => {
    expect(normalizeSelector('#btn')).toBe('#btn');
  });

  it('keeps . selectors as-is', () => {
    expect(normalizeSelector('.class')).toBe('.class');
  });

  it('keeps [ attribute selectors as-is', () => {
    expect(normalizeSelector('[data-id]')).toBe('[data-id]');
  });

  it('keeps : pseudo selectors as-is', () => {
    expect(normalizeSelector(':root')).toBe(':root');
  });

  it('keeps // xpath selectors as-is', () => {
    expect(normalizeSelector('//div[@id="main"]')).toBe('//div[@id="main"]');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeSelector('')).toBe('');
  });

  it('auto-prefixes compound names', () => {
    expect(normalizeSelector('my-button')).toBe('#my-button');
  });
});
