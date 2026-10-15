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
