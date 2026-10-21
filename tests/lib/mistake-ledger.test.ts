import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearMistakes,
  constrainedMistakes,
  isConstrainedMistake,
  listMistakes,
  mistakeFingerprint,
  normalizeMistakeText,
  recordMistake,
} from '../../src/lib/mistake-ledger.js';

const ledgerPath = join(tmpdir(), `mistake-ledger-${Date.now()}.json`);

beforeEach(() => {
  rmSync(ledgerPath, { force: true });
});

afterEach(() => {
  rmSync(ledgerPath, { force: true });
});

describe('mistake-ledger', () => {
  it('normalizes volatile failure details before fingerprinting', () => {
    expect(normalizeMistakeText('timeout after 123ms at 2026-10-15T01:02:03.000Z'))
      .toBe('timeout after <duration> at <timestamp>');
    expect(mistakeFingerprint('runtime', 'failed 3 times'))
      .toBe(mistakeFingerprint('runtime', 'failed 4 times'));
  });

  it('records occurrences and constrains the third repeated mistake', () => {
    const first = recordMistake({
      category: 'runtime',
      command: 'click',
      message: 'selector #buy not found',
    }, ledgerPath);
    expect(first.entry.occurrences).toHaveLength(1);
    expect(first.entry.constrained).toBe(false);

    const second = recordMistake({
      category: 'runtime',
      command: 'click',
      message: 'selector #buy not found',
    }, ledgerPath);
    expect(second.entry.occurrences).toHaveLength(2);
    expect(second.newlyConstrained).toBe(false);

    const third = recordMistake({
      category: 'runtime',
      command: 'click',
      message: 'selector #buy not found',
    }, ledgerPath);
    expect(third.entry.occurrences).toHaveLength(3);
    expect(third.entry.constrained).toBe(true);
    expect(third.newlyConstrained).toBe(true);
    expect(constrainedMistakes(ledgerPath)).toHaveLength(1);
    expect(isConstrainedMistake('runtime', 'selector #buy not found', ledgerPath)).toBe(true);
  });

  it('preserves occurrence context and sorts recent mistakes first', () => {
    recordMistake({
      category: 'architecture',
      command: 'lint',
      message: 'cyclic import',
      timestamp: '2026-10-14T00:00:00.000Z',
    }, ledgerPath);
    recordMistake({
      category: 'runtime',
      command: 'fill',
      message: 'input #code not retained',
      context: { session: 'default' },
      timestamp: '2026-10-15T00:00:00.000Z',
    }, ledgerPath);

    const mistakes = listMistakes(ledgerPath);
    expect(mistakes.map((entry) => entry.category)).toEqual(['runtime', 'architecture']);
    expect(mistakes[0].occurrences[0].context).toEqual({ session: 'default' });
  });

  it('separates fingerprints by category and rejects malformed input', () => {
    recordMistake({
      category: 'runtime',
      command: 'click',
      message: 'same message',
    }, ledgerPath);
    recordMistake({
      category: 'architecture',
      command: 'lint',
      message: 'same message',
    }, ledgerPath);
    expect(listMistakes(ledgerPath)).toHaveLength(2);

    expect(() => recordMistake({
      category: '',
      command: 'click',
      message: 'message',
    }, ledgerPath)).toThrow('mistake category is required');
    expect(() => recordMistake({
      category: 'runtime',
      command: '',
      message: 'message',
    }, ledgerPath)).toThrow('mistake command is required');
    expect(() => recordMistake({
      category: 'runtime',
      command: 'click',
      message: '',
    }, ledgerPath)).toThrow('mistake message is required');
  });

  it('clears the ledger without creating an absent file', () => {
    expect(clearMistakes(ledgerPath)).toBe(false);
    mkdirSync(join(ledgerPath, '..'), { recursive: true });
    recordMistake({
      category: 'runtime',
      command: 'click',
      message: 'failure',
    }, ledgerPath);
    expect(clearMistakes(ledgerPath)).toBe(true);
    expect(listMistakes(ledgerPath)).toEqual([]);
  });
});

describe('persistent markdown graduation (docs/mistakes.md)', () => {
  it('第 3 次出现自动沉淀进 Markdown 持久错题本（按日期、含待补字段）', async () => {
    const { recordMistake } = await import('../../src/lib/mistake-ledger.js');
    const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'mistakes-md-'));
    const json = join(dir, 'ledger.json');
    const md = join(dir, 'docs', 'mistakes.md');
    process.env.XBROWSER_MISTAKES_MD = md;
    try {
      writeFileSync(json, '{"version":1,"entries":{}}');
      const input = { category: 'FATAL: unknown', command: 'fill', message: 'element "#z" not found within 5000ms' };
      expect(recordMistake(input, json).newlyConstrained).toBe(false);
      expect(recordMistake(input, json).newlyConstrained).toBe(false);
      expect(recordMistake(input, json).newlyConstrained).toBe(true); // 毕业
      const md1 = readFileSync(md, 'utf8');
      expect(md1).toContain('# 持久化错题本');
      expect(md1).toMatch(/## \d{4}-\d{2}-\d{2} · fill · element/);
      expect(md1).toContain('**根因**: （待补');
      // 第 4 次：计数继续但 Markdown 幂等（同指纹锚点不重复落笔）
      expect(recordMistake(input, json).newlyConstrained).toBe(false);
      const md2 = readFileSync(md, 'utf8');
      expect(md2.match(/## /g)?.length).toBe(md1.match(/## /g)?.length);
    } finally {
      delete process.env.XBROWSER_MISTAKES_MD;
    }
  });

  it('persistentMistakesPath：环境变量覆盖优先', async () => {
    const { persistentMistakesPath } = await import('../../src/lib/mistake-ledger.js');
    process.env.XBROWSER_MISTAKES_MD = '/tmp/x/mistakes.md';
    try {
      expect(persistentMistakesPath()).toBe('/tmp/x/mistakes.md');
    } finally {
      delete process.env.XBROWSER_MISTAKES_MD;
    }
  });
});
