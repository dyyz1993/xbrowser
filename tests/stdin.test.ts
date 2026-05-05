import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readCommandFile } from '../src/stdin.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

const TMP_DIR = join('/tmp', 'xbrowser-test-stdin');

describe('readCommandFile', () => {
  beforeEach(() => {
    if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  });

  it('reads commands from a valid file', () => {
    const file = join(TMP_DIR, 'cmds.txt');
    writeFileSync(file, 'goto https://example.com\ntitle\nclick btn\n');
    const result = readCommandFile(file);
    expect(result).toEqual([
      'goto https://example.com',
      'title',
      'click btn',
    ]);
  });

  it('skips comment lines', () => {
    const file = join(TMP_DIR, 'cmds.txt');
    writeFileSync(file, '# This is a comment\ngoto https://example.com\n# Another comment\ntitle\n');
    const result = readCommandFile(file);
    expect(result).toEqual(['goto https://example.com', 'title']);
  });

  it('skips blank lines', () => {
    const file = join(TMP_DIR, 'cmds.txt');
    writeFileSync(file, 'goto https://example.com\n\n\ntitle\n  \n');
    const result = readCommandFile(file);
    expect(result).toEqual(['goto https://example.com', 'title']);
  });

  it('handles mixed comments, blanks, and commands', () => {
    const file = join(TMP_DIR, 'cmds.txt');
    writeFileSync(
      file,
      '# Navigate\n\ngoto https://example.com\n  \n# Get info\ntitle\nurl\n'
    );
    const result = readCommandFile(file);
    expect(result).toEqual([
      'goto https://example.com',
      'title',
      'url',
    ]);
  });

  it('returns empty array for file with only comments', () => {
    const file = join(TMP_DIR, 'cmds.txt');
    writeFileSync(file, '# comment 1\n# comment 2\n');
    const result = readCommandFile(file);
    expect(result).toEqual([]);
  });

  it('throws for non-existent file', () => {
    expect(() => readCommandFile('/tmp/nonexistent-file-xyz.txt')).toThrow();
  });

  it('trims whitespace from each line', () => {
    const file = join(TMP_DIR, 'cmds.txt');
    writeFileSync(file, '  goto https://example.com  \n  title  \n');
    const result = readCommandFile(file);
    expect(result).toEqual(['goto https://example.com', 'title']);
  });
});
