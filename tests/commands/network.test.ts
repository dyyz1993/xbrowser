import { describe, it, expect } from 'vitest';
import {
  extractPath,
  generatePreview,
  buildSummaryOutput,
  buildJsonOutput,
  searchInObject,
} from '../../src/commands/network.js';

describe('network command - utility functions', () => {
  describe('extractPath', () => {
    it('should extract path from valid URL', () => {
      expect(extractPath('https://example.com/path/to/page')).toBe('/path/to/page');
      expect(extractPath('https://example.com/path/to/page?query=1')).toBe('/path/to/page');
      expect(extractPath('https://example.com/path/to/page#section')).toBe('/path/to/page');
    });

    it('should handle root path', () => {
      expect(extractPath('https://example.com')).toBe('/');
      expect(extractPath('https://example.com/')).toBe('/');
    });

    it('should return original string for invalid URL', () => {
      expect(extractPath('not-a-url')).toBe('not-a-url');
    });

    it('should handle URLs without protocol', () => {
      expect(extractPath('example.com/path')).toBe('example.com/path');
    });
  });

  describe('generatePreview', () => {
    it('should generate preview for object', () => {
      const body = {
        name: 'test',
        count: 42,
        items: ['a', 'b', 'c'],
        nested: { key: 'value' },
        flag: true,
      };
      const preview = generatePreview(body);
      expect(preview).toContain('name=test');
      expect(preview).toContain('count=42');
      expect(preview).toContain('items[3]');
      expect(preview.split(', ').length).toBeLessThanOrEqual(5);
    });

    it('should return empty string for null', () => {
      expect(generatePreview(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(generatePreview(undefined)).toBe('');
    });

    it('should convert primitive to string', () => {
      expect(generatePreview('test string')).toBe('test string');
      expect(generatePreview(123)).toBe('123');
      expect(generatePreview(true)).toBe('true');
    });

    it('should limit output items to 5', () => {
      const body = {
        key1: 'value1',
        key2: 'value2',
        key3: 'value3',
        key4: 'value4',
        key5: 'value5',
        key6: 'value6',
      };
      const preview = generatePreview(body);
      expect(preview.split(', ')).toHaveLength(5);
    });
  });

  describe('buildSummaryOutput', () => {
    it('should build summary output', () => {
      const captures = [
        {
          method: 'GET',
          url: 'https://example.com/api/data',
          path: '/api/data',
          status: 200,
          size: 1024,
          contentType: 'application/json',
          headers: {},
          body: { data: 'test' },
        },
      ];

      const output = buildSummaryOutput(
        'https://example.com',
        1000,
        captures,
        ['console message'],
        5,
      );

      expect(output).toMatchObject({
        url: 'https://example.com',
        duration: 1000,
        total: 5,
        filtered: 1,
        console: ['console message'],
        captures: [
          {
            method: 'GET',
            path: '/api/data',
            status: 200,
            size: 1024,
            contentType: 'application/json',
            preview: 'data=test',
          },
        ],
      });
    });

    it('should handle empty captures', () => {
      const output = buildSummaryOutput('https://example.com', 0, [], [], 0);
      expect(output.captures).toHaveLength(0);
      expect(output.total).toBe(0);
    });

    it('should include timestamp', () => {
      const now = Date.now();
      const output = buildSummaryOutput('https://example.com', 1000, [], [], 0);
      expect(output.timestamp).toBeGreaterThanOrEqual(now);
      expect(output.timestamp).toBeLessThanOrEqual(now + 100);
    });

    it('should handle captures without body', () => {
      const captures = [
        {
          method: 'GET',
          url: 'https://example.com/page',
          path: '/page',
          status: 200,
          size: 2048,
          contentType: 'text/html',
          headers: {},
        },
      ];

      const output = buildSummaryOutput('https://example.com', 1000, captures, [], 1);
      expect(output.captures[0].preview).toBe('');
    });
  });

  describe('buildJsonOutput', () => {
    it('should build JSON output', () => {
      const captures = [
        {
          method: 'POST',
          url: 'https://example.com/api/submit',
          path: '/api/submit',
          status: 201,
          size: 512,
          contentType: 'application/json',
          headers: { 'content-type': 'application/json' },
          body: { success: true, id: 123 },
        },
      ];

      const output = buildJsonOutput(
        'https://example.com',
        captures,
        ['console log'],
        1,
        { searchResults: ['match1', 'match2'] },
      );

      expect(output).toMatchObject({
        url: 'https://example.com',
        total: 1,
        console: ['console log'],
        captures: captures,
        searchResults: { searchResults: ['match1', 'match2'] },
      });
    });

    it('should handle missing search results', () => {
      const output = buildJsonOutput('https://example.com', [], [], 0);
      expect(output.searchResults).toBeUndefined();
    });

    it('should include timestamp', () => {
      const now = Date.now();
      const output = buildJsonOutput('https://example.com', [], [], 0);
      expect(output.timestamp).toBeGreaterThanOrEqual(now);
      expect(output.timestamp).toBeLessThanOrEqual(now + 100);
    });
  });

  describe('searchInObject', () => {
    it('should search in strings', () => {
      const result = searchInObject('Hello World', 'world');
      expect(result).toBe('Hello World');

      const noMatch = searchInObject('Hello World', 'xyz');
      expect(noMatch).toBeUndefined();
    });

    it('should search in primitives', () => {
      expect(searchInObject(12345, '23')).toBe(12345);
      expect(searchInObject(true, 'tru')).toBe(true);
      expect(searchInObject(123, 'xyz')).toBeUndefined();
    });

    it('should search in arrays', () => {
      const arr = ['apple', 'banana', 'cherry'];
      const result = searchInObject(arr, 'app');
      expect(result).toEqual(['apple']);

      const multipleMatches = searchInObject(arr, 'a');
      expect(Array.isArray(multipleMatches)).toBe(true);
      expect(multipleMatches).toContain('apple');
      expect(multipleMatches).toContain('banana');
    });

    it('should search in objects by key', () => {
      const obj = {
        name: 'test',
        age: 25,
        city: 'New York',
      };
      const result = searchInObject(obj, 'age');
      expect(result).toEqual({ age: 25 });
    });

    it('should search in objects by value', () => {
      const obj = {
        name: 'John',
        city: 'New York',
      };
      const result = searchInObject(obj, 'york');
      expect(result).toEqual({ city: 'New York' });
    });

    it('should search nested objects', () => {
      const obj = {
        user: {
          name: 'Alice',
          email: 'alice@example.com',
        },
        settings: {
          theme: 'dark',
        },
      };
      const result = searchInObject(obj, 'alice');
      expect(result).toMatchObject({
        user: {
          name: 'Alice',
          email: 'alice@example.com',
        },
      });
    });

    it('should search nested arrays', () => {
      const obj = {
        items: [
          { name: 'item1', value: 10 },
          { name: 'item2', value: 20 },
        ],
      };
      const result = searchInObject(obj, 'item');
      expect(result).toMatchObject({
        items: [
          { name: 'item1', value: 10 },
          { name: 'item2', value: 20 },
        ],
      });
    });

    it('should return undefined for null/undefined', () => {
      expect(searchInObject(null, 'test')).toBeUndefined();
      expect(searchInObject(undefined, 'test')).toBeUndefined();
    });

    it('should be case insensitive', () => {
      const obj = { Name: 'Alice', CITY: 'New York' };
      const result = searchInObject(obj, 'name');
      expect(result).toMatchObject({ Name: 'Alice' });
    });

    it('should return undefined when no matches found', () => {
      const obj = { name: 'test', value: 123 };
      const result = searchInObject(obj, 'xyz');
      expect(result).toBeUndefined();
    });

    it('should handle mixed structures', () => {
      const obj = {
        users: [
          { name: 'Alice', role: 'admin' },
          { name: 'Bob', role: 'user' },
        ],
        settings: {
          theme: 'dark',
          notifications: true,
        },
      };
      const result = searchInObject(obj, 'theme');
      expect(result).toMatchObject({
        settings: {
          theme: 'dark',
        },
      });
    });
  });
});