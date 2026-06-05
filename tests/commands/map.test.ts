import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from '../../src/browser-shim.js';
import {
  normalizeUrl,
  getHostname,
  getRootDomain,
  isSameDomain,
  isWithinPathScope,
  deduplicateUrls,
} from '../../src/commands/map.js';

describe('Map Command - URL Utilities', () => {
  describe('normalizeUrl', () => {
    it('should resolve relative URLs to absolute', () => {
      expect(normalizeUrl('/about', 'https://example.com')).toBe(
        'https://example.com/about',
      );
    });

    it('should resolve relative paths with ../', () => {
      expect(
        normalizeUrl('../page', 'https://example.com/docs/intro'),
      ).toBe('https://example.com/page');
    });

    it('should return null for invalid URLs', () => {
      expect(normalizeUrl('', '')).toBeNull();
    });

    it('should keep absolute URLs unchanged', () => {
      expect(
        normalizeUrl('https://other.com/path', 'https://example.com'),
      ).toBe('https://other.com/path');
    });
  });

  describe('getHostname', () => {
    it('should extract hostname from URL', () => {
      expect(getHostname('https://www.example.com/path')).toBe(
        'www.example.com',
      );
    });

    it('should return null for invalid URL', () => {
      expect(getHostname('not-a-url')).toBeNull();
    });
  });

  describe('getRootDomain', () => {
    it('should return root domain for subdomain', () => {
      expect(getRootDomain('docs.example.com')).toBe('example.com');
    });

    it('should return unchanged for simple domain', () => {
      expect(getRootDomain('example.com')).toBe('example.com');
    });
  });

  describe('isSameDomain', () => {
    it('should match exact hostname', () => {
      expect(isSameDomain('https://example.com/page', 'example.com', false)).toBe(true);
    });

    it('should reject subdomain when includeSubdomains is false', () => {
      expect(isSameDomain('https://docs.example.com/page', 'example.com', false)).toBe(false);
    });

    it('should allow subdomain when includeSubdomains is true', () => {
      expect(isSameDomain('https://docs.example.com/page', 'example.com', true)).toBe(true);
    });

    it('should reject external domain', () => {
      expect(isSameDomain('https://other.com/page', 'example.com', false)).toBe(false);
    });

    it('should reject external domain even with includeSubdomains', () => {
      expect(isSameDomain('https://other.com/page', 'example.com', true)).toBe(false);
    });
  });

  describe('isWithinPathScope', () => {
    it('should allow paths under the base path', () => {
      expect(isWithinPathScope('https://github.com/user/repo/issues', '/user/repo')).toBe(true);
    });

    it('should allow exact base path match', () => {
      expect(isWithinPathScope('https://github.com/user/repo', '/user/repo')).toBe(true);
    });

    it('should reject paths outside the base path', () => {
      expect(isWithinPathScope('https://github.com/features/spark', '/user/repo')).toBe(false);
    });

    it('should reject site navigation paths', () => {
      expect(isWithinPathScope('https://github.com/security', '/user/repo')).toBe(false);
    });

    it('should allow all paths when base is root', () => {
      expect(isWithinPathScope('https://example.com/any/path', '/')).toBe(true);
    });

    it('should allow all paths when base is empty', () => {
      expect(isWithinPathScope('https://example.com/any/path', '')).toBe(true);
    });

    it('should handle trailing slash in base path', () => {
      expect(isWithinPathScope('https://github.com/user/repo/issues', '/user/repo/')).toBe(true);
    });
  });

  describe('deduplicateUrls', () => {
    it('should remove exact duplicates', () => {
      const result = deduplicateUrls([
        'https://example.com/a',
        'https://example.com/a',
      ]);
      expect(result).toEqual(['https://example.com/a']);
    });

    it('should deduplicate http vs https', () => {
      const result = deduplicateUrls([
        'http://example.com/a',
        'https://example.com/a',
      ]);
      expect(result).toHaveLength(1);
    });

    it('should deduplicate www vs non-www', () => {
      const result = deduplicateUrls([
        'https://www.example.com/a',
        'https://example.com/a',
      ]);
      expect(result).toHaveLength(1);
    });

    it('should ignore hash fragments for deduplication', () => {
      const result = deduplicateUrls([
        'https://example.com/a#section1',
        'https://example.com/a#section2',
      ]);
      expect(result).toHaveLength(1);
    });

    it('should keep distinct URLs', () => {
      const result = deduplicateUrls([
        'https://example.com/a',
        'https://example.com/b',
      ]);
      expect(result).toHaveLength(2);
    });
  });
});

describe('Map Command - discoverUrls Integration', () => {
  let mockPage: Page;

  beforeEach(() => {
    mockPage = {
      goto: vi.fn().mockResolvedValue({ ok: () => true, headers: () => ({ 'content-type': 'application/xml' }) }),
      content: vi.fn().mockResolvedValue(
        '<urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/about</loc></url><url><loc>https://example.com/contact</loc></url></urlset>',
      ),
      evaluate: vi.fn().mockResolvedValue([
        'https://example.com/',
        'https://example.com/about',
        'https://example.com/contact',
        'https://example.com/blog',
        'https://external.com/page',
      ]),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;
  });

  it('should return URL list from page links and sitemap', async () => {
    const { discoverUrls } = await import('../../src/commands/map.js');
    const urls = await discoverUrls(mockPage, 'https://example.com', {});
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u: string) => u.startsWith('https://example.com'))).toBe(true);
  });

  it('should respect limit parameter', async () => {
    const { discoverUrls } = await import('../../src/commands/map.js');
    const urls = await discoverUrls(mockPage, 'https://example.com', { limit: 2 });
    expect(urls.length).toBeLessThanOrEqual(2);
  });

  it('should filter by search query', async () => {
    const { discoverUrls } = await import('../../src/commands/map.js');
    const urls = await discoverUrls(mockPage, 'https://example.com', { search: 'about' });
    expect(urls.every((u: string) => u.toLowerCase().includes('about'))).toBe(true);
  });

  it('should exclude subdomains by default', async () => {
    mockPage.evaluate = vi.fn().mockResolvedValue([
      'https://example.com/',
      'https://docs.example.com/guide',
    ]);
    mockPage.content = vi.fn().mockResolvedValue('<urlset></urlset>');
    const { discoverUrls } = await import('../../src/commands/map.js');
    const urls = await discoverUrls(mockPage, 'https://example.com', {});
    expect(urls.some((u: string) => u.includes('docs.example.com'))).toBe(false);
  });

  it('should include subdomains when option is set', async () => {
    mockPage.evaluate = vi.fn().mockResolvedValue([
      'https://example.com/',
      'https://docs.example.com/guide',
    ]);
    mockPage.content = vi.fn().mockResolvedValue('<urlset></urlset>');
    const { discoverUrls } = await import('../../src/commands/map.js');
    const urls = await discoverUrls(mockPage, 'https://example.com', { includeSubdomains: true });
    expect(urls.some((u: string) => u.includes('docs.example.com'))).toBe(true);
  });

  it('should use only sitemap when sitemap=only', async () => {
    mockPage.content = vi.fn().mockResolvedValue(
      '<urlset><url><loc>https://example.com/from-sitemap</loc></url></urlset>',
    );
    const { discoverUrls } = await import('../../src/commands/map.js');
    const urls = await discoverUrls(mockPage, 'https://example.com', { sitemap: 'only' });
    expect(mockPage.evaluate).not.toHaveBeenCalled();
    expect(urls).toContain('https://example.com/from-sitemap');
  });

  it('should filter URLs to path scope when base has a path', async () => {
    mockPage.evaluate = vi.fn().mockResolvedValue([
      'https://github.com/user/repo',
      'https://github.com/user/repo/issues',
      'https://github.com/user/repo/pulls',
      'https://github.com/features/spark',
      'https://github.com/security',
      'https://github.com/login',
      'https://github.com/explore',
    ]);
    mockPage.content = vi.fn().mockResolvedValue('<urlset></urlset>');
    const { discoverUrls } = await import('../../src/commands/map.js');
    const urls = await discoverUrls(mockPage, 'https://github.com/user/repo', {});
    const paths = urls.map((u: string) => new URL(u).pathname);
    expect(paths.every((p: string) => p === '/user/repo' || p.startsWith('/user/repo/'))).toBe(true);
    expect(urls.some((u: string) => u.includes('/features/'))).toBe(false);
    expect(urls.some((u: string) => u.includes('/security'))).toBe(false);
    expect(urls.some((u: string) => u.includes('/login'))).toBe(false);
  });

  it('should not restrict path when base URL is root', async () => {
    mockPage.evaluate = vi.fn().mockResolvedValue([
      'https://example.com/about',
      'https://example.com/blog',
      'https://example.com/contact',
    ]);
    mockPage.content = vi.fn().mockResolvedValue('<urlset></urlset>');
    const { discoverUrls } = await import('../../src/commands/map.js');
    const urls = await discoverUrls(mockPage, 'https://example.com/', {});
    expect(urls).toHaveLength(3);
  });
});
