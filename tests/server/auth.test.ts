import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveTokens, validateAuth, isAuthRequired } from '../../src/server/auth.js';

describe('auth', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.XBROWSER_SERVER_TOKEN;
    delete process.env.XBROWSER_SERVER_TOKEN;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.XBROWSER_SERVER_TOKEN;
    } else {
      process.env.XBROWSER_SERVER_TOKEN = savedEnv;
    }
  });

  describe('resolveTokens', () => {
    it('returns empty array when no config tokens and no env var', () => {
      expect(resolveTokens()).toEqual([]);
    });

    it('returns config tokens when provided', () => {
      expect(resolveTokens(['abc', 'def'])).toEqual(['abc', 'def']);
    });

    it('returns env tokens split by comma', () => {
      process.env.XBROWSER_SERVER_TOKEN = 'tok1,tok2,tok3';
      expect(resolveTokens()).toEqual(['tok1', 'tok2', 'tok3']);
    });

    it('merges config and env tokens and deduplicates', () => {
      process.env.XBROWSER_SERVER_TOKEN = 'tok2,tok3';
      const result = resolveTokens(['tok1', 'tok2']);
      expect(result.sort()).toEqual(['tok1', 'tok2', 'tok3']);
    });

    it('filters out empty strings from config', () => {
      expect(resolveTokens(['', 'valid', ''])).toEqual(['valid']);
    });

    it('filters out empty strings from env var', () => {
      process.env.XBROWSER_SERVER_TOKEN = ',tok1,,tok2,';
      const result = resolveTokens();
      expect(result.sort()).toEqual(['tok1', 'tok2']);
    });

    it('trims whitespace from env tokens', () => {
      process.env.XBROWSER_SERVER_TOKEN = ' tok1 , tok2 ';
      const result = resolveTokens();
      expect(result.sort()).toEqual(['tok1', 'tok2']);
    });
  });

  describe('isAuthRequired', () => {
    it('returns false for empty array', () => {
      expect(isAuthRequired([])).toBe(false);
    });

    it('returns true for non-empty array', () => {
      expect(isAuthRequired(['token'])).toBe(true);
    });
  });

  describe('validateAuth', () => {
    it('returns true when no tokens configured (dev mode)', () => {
      expect(validateAuth(undefined, [])).toBe(true);
    });

    it('returns false when tokens configured but no auth header', () => {
      expect(validateAuth(undefined, ['secret'])).toBe(false);
    });

    it('returns false for wrong format', () => {
      expect(validateAuth('Basic abc123', ['secret'])).toBe(false);
    });

    it('returns false for wrong token', () => {
      expect(validateAuth('Bearer wrong', ['secret'])).toBe(false);
    });

    it('returns true for correct token', () => {
      expect(validateAuth('Bearer secret', ['secret'])).toBe(true);
    });

    it('is case insensitive for Bearer prefix', () => {
      expect(validateAuth('bearer secret', ['secret'])).toBe(true);
    });

    it('is case insensitive for BEARER prefix', () => {
      expect(validateAuth('BEARER secret', ['secret'])).toBe(true);
    });

    it('matches against multiple valid tokens', () => {
      expect(validateAuth('Bearer tok2', ['tok1', 'tok2', 'tok3'])).toBe(true);
    });
  });
});
