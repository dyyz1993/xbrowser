import { describe, it, expect } from 'vitest';
import {
  stripHashAnchorQuery,
  parseRobotsTxt,
  isBlockedByRobots,
  isPageError,
  isUrlAllowed,
  type DisallowRule,
} from '../../src/commands/crawl.js';

describe('crawl pure functions', () => {
  describe('stripHashAnchorQuery', () => {
    it('should strip query from SPA hash route', () => {
      const result = stripHashAnchorQuery('https://example.com/#/page?foo=bar');
      expect(result).toBe('https://example.com/#/page');
    });

    it('should keep non-SPA hash', () => {
      const result = stripHashAnchorQuery('https://example.com/page#section');
      expect(result).toBe('https://example.com/page#section');
    });

    it('should return original for invalid URL', () => {
      expect(stripHashAnchorQuery('not-a-url')).toBe('not-a-url');
    });

    it('should handle URL without hash', () => {
      const result = stripHashAnchorQuery('https://example.com/page');
      expect(result).toBe('https://example.com/page');
    });
  });

  describe('parseRobotsTxt', () => {
    it('should parse disallow rules for wildcard agent', () => {
      const robots = 'User-agent: *\nDisallow: /admin\nDisallow: /private';
      const rules = parseRobotsTxt(robots);
      expect(rules).toHaveLength(2);
      expect(rules[0].pathPrefix).toBe('/admin');
      expect(rules[1].pathPrefix).toBe('/private');
    });

    it('should ignore rules for specific agents', () => {
      const robots = 'User-agent: GoogleBot\nDisallow: /no-google';
      const rules = parseRobotsTxt(robots);
      expect(rules).toHaveLength(0);
    });

    it('should skip comments and empty lines', () => {
      const robots = '# Comment\n\nUser-agent: *\nDisallow: /blocked';
      const rules = parseRobotsTxt(robots);
      expect(rules).toHaveLength(1);
      expect(rules[0].pathPrefix).toBe('/blocked');
    });

    it('should handle empty disallow', () => {
      const robots = 'User-agent: *\nDisallow:';
      const rules = parseRobotsTxt(robots);
      expect(rules).toHaveLength(0);
    });

    it('should handle empty robots.txt', () => {
      expect(parseRobotsTxt('')).toEqual([]);
    });

    it('should handle multiple agent blocks', () => {
      const robots = 'User-agent: GoogleBot\nDisallow: /g\nUser-agent: *\nDisallow: /all';
      const rules = parseRobotsTxt(robots);
      expect(rules).toHaveLength(1);
      expect(rules[0].pathPrefix).toBe('/all');
    });
  });

  describe('isBlockedByRobots', () => {
    it('should block paths matching prefix', () => {
      const rules: DisallowRule[] = [{ pathPrefix: '/admin' }];
      expect(isBlockedByRobots('/admin/users', rules)).toBe(true);
      expect(isBlockedByRobots('/admin', rules)).toBe(true);
    });

    it('should not block non-matching paths', () => {
      const rules: DisallowRule[] = [{ pathPrefix: '/admin' }];
      expect(isBlockedByRobots('/public', rules)).toBe(false);
    });

    it('should return false for empty rules', () => {
      expect(isBlockedByRobots('/any', [])).toBe(false);
    });

    it('should handle regex patterns in rules', () => {
      const rules: DisallowRule[] = [{ pathPrefix: '/api/v[0-9]+' }];
      expect(isBlockedByRobots('/api/v1/users', rules)).toBe(true);
      expect(isBlockedByRobots('/api/users', rules)).toBe(false);
    });
  });

  describe('isPageError', () => {
    it('should detect error results', () => {
      expect(isPageError({ error: 'timeout' } as never)).toBe(true);
    });

    it('should detect non-error results', () => {
      expect(isPageError({ url: 'https://example.com' } as never)).toBe(false);
    });
  });

  describe('isUrlAllowed', () => {
    const startUrl = new URL('https://example.com');
    const baseOptions = {
      maxDepth: 3,
      sameDomainOnly: true,
      includeHashRoutes: true,
      excludePatterns: [] as string[],
      includePatterns: [] as string[],
    } as never;

    it('should allow same-domain URLs', () => {
      expect(isUrlAllowed('https://example.com/page', startUrl, 1, baseOptions, [])).toBe(true);
    });

    it('should block different domain when sameDomainOnly', () => {
      expect(isUrlAllowed('https://other.com/page', startUrl, 1, baseOptions, [])).toBe(false);
    });

    it('should block URLs beyond max depth', () => {
      expect(isUrlAllowed('https://example.com/page', startUrl, 5, baseOptions, [])).toBe(false);
    });

    it('should block URLs matching robots rules', () => {
      const rules: DisallowRule[] = [{ pathPrefix: '/admin' }];
      expect(isUrlAllowed('https://example.com/admin', startUrl, 1, baseOptions, rules)).toBe(false);
    });

    it('should block invalid URLs', () => {
      expect(isUrlAllowed('not-a-url', startUrl, 1, baseOptions, [])).toBe(false);
    });
  });
});
