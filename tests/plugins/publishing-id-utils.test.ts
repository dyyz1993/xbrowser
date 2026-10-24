import { describe, it, expect } from 'vitest';
import {
  SAFE_ID_DIGITS,
  isUnsafeNumericId,
  pickIdFromSources,
  readRawId,
} from '../../.xcli/plugins/shared/publishing/id-utils.ts';

describe('id-utils', () => {
  describe('isUnsafeNumericId', () => {
    it('flags 19-digit snowflake ids as unsafe', () => {
      expect(isUnsafeNumericId('2097465168825415129')).toBe(true);
      expect(isUnsafeNumericId(2097465168825415129)).toBe(true);
    });

    it('accepts short ids', () => {
      expect(isUnsafeNumericId('168773369')).toBe(false);
      expect(isUnsafeNumericId('23405420')).toBe(false);
    });

    it('detects the boundary at MAX_SAFE_INTEGER', () => {
      const max = String(Number.MAX_SAFE_INTEGER);
      expect(isUnsafeNumericId(max)).toBe(false);
      expect(isUnsafeNumericId('9007199254740992')).toBe(true);
      expect(max.length).toBe(SAFE_ID_DIGITS);
    });

    it('ignores non-numeric input', () => {
      expect(isUnsafeNumericId('abc123')).toBe(false);
      expect(isUnsafeNumericId('')).toBe(false);
    });

    it('strips sign and leading zeros before counting digits', () => {
      expect(isUnsafeNumericId('-2097465168825415129')).toBe(true);
      expect(isUnsafeNumericId('0000000000000001')).toBe(false);
    });
  });

  describe('pickIdFromSources', () => {
    it('prefers the id embedded in a url (exact, no precision loss)', () => {
      // 知乎真实案例：JSON 的 id 字段已失真，url 里才是真值
      expect(pickIdFromSources({
        url: 'https://zhuanlan.zhihu.com/p/2097465168825415129',
        rawIdText: '2097465168825415200',
      })).toBe('2097465168825415129');
    });

    it('falls back to data attributes', () => {
      expect(pickIdFromSources({ dataAttr: ' 2097465168825415129 ' })).toBe('2097465168825415129');
    });

    it('falls back to raw text id as last resort', () => {
      expect(pickIdFromSources({ rawIdText: '"2097465168825415129"' })).toBe('2097465168825415129');
    });

    it('returns null when nothing usable is present', () => {
      expect(pickIdFromSources({ url: 'https://zhuanlan.zhihu.com/drafts' })).toBeNull();
      expect(pickIdFromSources({ dataAttr: 'not-an-id' })).toBeNull();
    });

    it('handles other site url shapes', () => {
      expect(pickIdFromSources({ url: 'https://blog.csdn.net/x/article/details/168773369' })).toBe('168773369');
      expect(pickIdFromSources({ url: 'https://juejin.cn/post/7699027015432978482' })).toBe('7699027015432978482');
    });
  });

  describe('readRawId', () => {
    it('reads an unquoted numeric id without going through JSON.parse', () => {
      const text = '{"data":[{"id": 2097465168825415129,"title":"x"}]}';
      expect(readRawId(text)).toBe('2097465168825415129');
    });

    it('reads a quoted id', () => {
      expect(readRawId('{"id":"2097465168825415129"}')).toBe('2097465168825415129');
    });

    it('respects a custom key', () => {
      expect(readRawId('{"articleId": 2097465168825415129}', 'articleId')).toBe('2097465168825415129');
    });

    it('returns null when the key is absent', () => {
      expect(readRawId('{"other": 1}')).toBeNull();
    });

    it('demonstrates the precision loss it exists to prevent', () => {
      const raw = '{"id": 2097465168825415129}';
      const parsed = (JSON.parse(raw) as { id: number }).id;
      expect(readRawId(raw)).toBe('2097465168825415129');
      expect(String(parsed)).toBe('2097465168825415200');
      expect(String(parsed)).not.toBe(readRawId(raw));
    });
  });
});
