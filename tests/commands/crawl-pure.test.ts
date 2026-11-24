import { describe, it, expect } from 'vitest';
import {
  stripHashAnchorQuery,
  parseRobotsTxt,
  isBlockedByRobots,
  isPageError,
  isUrlAllowed,
  createPageBudget,
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

    // 子域名开关只在「同基域名、不同主机名」时起作用；跨基域名归 allowExternalLinks 管
    describe('subdomain and external-link switches', () => {
      const options = (overrides: Partial<{ allowSubdomains: boolean; allowExternalLinks: boolean }> = {}) => ({
        limit: 10,
        maxDepth: 3,
        allowSubdomains: false,
        allowExternalLinks: false,
        allowBackwardCrawling: true,
        enableSpa: false,
        format: 'markdown' as const,
        onlyMainContent: true,
        concurrency: 1,
        retries: 0,
        verbose: false,
        ...overrides,
      });

      it('blocks a subdomain until allowSubdomains is set', () => {
        expect(isUrlAllowed('https://docs.example.com/page', startUrl, 1, options(), [])).toBe(false);
        expect(isUrlAllowed('https://docs.example.com/page', startUrl, 1, options({ allowSubdomains: true }), [])).toBe(true);
      });

      it('does not let allowSubdomains cross into another base domain', () => {
        expect(isUrlAllowed('https://other.com/page', startUrl, 1, options({ allowSubdomains: true }), [])).toBe(false);
      });

      it('lets allowExternalLinks cross into another base domain', () => {
        expect(isUrlAllowed('https://other.com/page', startUrl, 1, options({ allowExternalLinks: true }), [])).toBe(true);
      });
    });
  });

  describe('createPageBudget', () => {
    it('should never admit more pages than the limit when workers start concurrently', async () => {
      // The seed page already counts against the limit.
      const budget = createPageBudget(3, 1);
      let admitted = 0;
      await Promise.all(
        Array.from({ length: 5 }, async () => {
          // Each worker asks for its next page while the others are still in flight.
          while (budget.tryAcquire()) {
            admitted++;
            await new Promise((r) => setTimeout(r, 1));
          }
        }),
      );
      expect(admitted).toBe(2);
    });

    it('should count a page as soon as a worker starts it, not when it finishes', () => {
      const budget = createPageBudget(2, 0);
      expect(budget.tryAcquire()).toBe(true);
      expect(budget.isExhausted()).toBe(false);
      expect(budget.tryAcquire()).toBe(true);
      expect(budget.isExhausted()).toBe(true);
      expect(budget.tryAcquire()).toBe(false);
    });

    it('should admit nothing when the limit is already reached', () => {
      expect(createPageBudget(1, 1).tryAcquire()).toBe(false);
    });
  });
});
