import { describe, it, expect } from 'vitest';
import { deduplicateUrls, normalizeUrl, getHostname, getRootDomain, isSameDomain } from '../src/commands/map.js';

describe('deduplicateUrls', () => {
  it('should deduplicate identical URLs', () => {
    const urls = [
      'https://example.com/page1',
      'https://example.com/page1',
      'https://example.com/page2',
    ];
    expect(deduplicateUrls(urls)).toEqual([
      'https://example.com/page1',
      'https://example.com/page2',
    ]);
  });

  it('should preserve SPA hash routes as separate URLs', () => {
    const urls = [
      'https://bark.day.app/',
      'https://bark.day.app/#/tutorial',
      'https://bark.day.app/#/en-us/',
      'https://bark.day.app/#/faq',
    ];
    const result = deduplicateUrls(urls);
    expect(result).toHaveLength(4);
    expect(result).toContain('https://bark.day.app/');
    expect(result).toContain('https://bark.day.app/#/tutorial');
    expect(result).toContain('https://bark.day.app/#/en-us/');
    expect(result).toContain('https://bark.day.app/#/faq');
  });

  it('should deduplicate non-SPA hash anchors', () => {
    const urls = [
      'https://example.com/docs#section1',
      'https://example.com/docs#section2',
    ];
    const result = deduplicateUrls(urls);
    expect(result).toHaveLength(1);
  });

  it('should treat http and https as duplicates', () => {
    const urls = [
      'http://example.com/page',
      'https://example.com/page',
    ];
    const result = deduplicateUrls(urls);
    expect(result).toHaveLength(1);
  });

  it('should treat www and non-www as duplicates', () => {
    const urls = [
      'https://www.example.com/page',
      'https://example.com/page',
    ];
    const result = deduplicateUrls(urls);
    expect(result).toHaveLength(1);
  });

  it('should handle #!/ hash routes (angular-style)', () => {
    const urls = [
      'https://example.com/',
      'https://example.com/#!/home',
      'https://example.com/#!/about',
    ];
    const result = deduplicateUrls(urls);
    expect(result).toHaveLength(3);
  });
});

describe('normalizeUrl', () => {
  it('should resolve relative URLs against base', () => {
    expect(normalizeUrl('/page', 'https://example.com/')).toBe('https://example.com/page');
  });

  it('should resolve hash routes against base', () => {
    expect(normalizeUrl('#/tutorial', 'https://bark.day.app/')).toBe('https://bark.day.app/#/tutorial');
  });

  it('should pass through absolute URLs', () => {
    expect(normalizeUrl('https://example.com/page', 'https://other.com/')).toBe('https://example.com/page');
  });
});

describe('getHostname', () => {
  it('should extract hostname from URL', () => {
    expect(getHostname('https://www.example.com/path')).toBe('www.example.com');
  });

  it('should return null for invalid URLs', () => {
    expect(getHostname('not-a-url')).toBeNull();
  });
});

describe('isSameDomain', () => {
  it('should match exact hostname', () => {
    expect(isSameDomain('https://example.com/page', 'example.com', false)).toBe(true);
  });

  it('should not match different domains', () => {
    expect(isSameDomain('https://other.com/page', 'example.com', false)).toBe(false);
  });

  it('should match subdomains when includeSubdomains is true', () => {
    expect(isSameDomain('https://sub.example.com/page', 'example.com', true)).toBe(true);
  });

  it('should not match subdomains when includeSubdomains is false', () => {
    expect(isSameDomain('https://sub.example.com/page', 'example.com', false)).toBe(false);
  });
});
