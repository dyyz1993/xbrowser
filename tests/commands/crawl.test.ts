import { describe, it, expect } from 'vitest';

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.css', '.js', '.woff', '.woff2', '.ttf', '.eot',
  '.pdf', '.zip', '.tar', '.gz', '.rar',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv',
  '.xml', '.json', '.rss',
]);

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    let href = parsed.href;
    if (href.endsWith('/')) href = href.slice(0, -1);
    href = href.replace(/^http:/, 'https:');
    href = href.replace(/^https:\/\/www\./, 'https://');
    return href;
  } catch {
    return url;
  }
}

function shouldSkipUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (['mailto:', 'tel:', 'javascript:'].includes(parsed.protocol)) return true;
    const path = parsed.pathname.toLowerCase();
    const dotIndex = path.lastIndexOf('.');
    if (dotIndex !== -1) {
      const ext = path.substring(dotIndex);
      if (SKIP_EXTENSIONS.has(ext)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function getBaseDomain(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join('.');
}

interface CrawlOptions {
  limit: number;
  maxDepth: number;
  includePaths?: string[];
  excludePaths?: string[];
  allowSubdomains: boolean;
  allowExternalLinks: boolean;
  allowBackwardCrawling: boolean;
  format: 'markdown' | 'html';
  onlyMainContent: boolean;
}

function isUrlAllowed(
  url: string,
  startUrl: URL,
  depth: number,
  options: CrawlOptions,
): boolean {
  try {
    const parsed = new URL(url);
    if (shouldSkipUrl(url)) return false;
    if (depth > options.maxDepth) return false;
    if (!options.allowExternalLinks) {
      const startBase = getBaseDomain(startUrl.hostname);
      const urlBase = getBaseDomain(parsed.hostname);
      if (urlBase !== startBase) return false;
    }
    if (!options.allowSubdomains && parsed.hostname !== startUrl.hostname) {
      const startBase = getBaseDomain(startUrl.hostname);
      const urlBase = getBaseDomain(parsed.hostname);
      if (urlBase === startBase) return false;
    }
    if (options.includePaths && options.includePaths.length > 0) {
      const matched = options.includePaths.some((pattern) => {
        try {
          return new RegExp(pattern).test(parsed.pathname);
        } catch {
          return parsed.pathname.includes(pattern);
        }
      });
      if (!matched) return false;
    }
    if (options.excludePaths && options.excludePaths.length > 0) {
      const excluded = options.excludePaths.some((pattern) => {
        try {
          return new RegExp(pattern).test(parsed.pathname);
        } catch {
          return parsed.pathname.includes(pattern);
        }
      });
      if (excluded) return false;
    }

    if (!options.allowBackwardCrawling) {
      const basePath = startUrl.pathname.replace(/\/$/, '');
      if (basePath && basePath !== '/') {
        if (parsed.pathname !== basePath && !parsed.pathname.startsWith(basePath + '/')) {
          return false;
        }
      }
    }

    return true;
  } catch {
    return false;
  }
}

const defaultOptions: CrawlOptions = {
  limit: 10,
  maxDepth: 3,
  allowSubdomains: false,
  allowExternalLinks: false,
  allowBackwardCrawling: false,
  format: 'markdown',
  onlyMainContent: true,
};

describe('Crawl - URL Filtering', () => {
  describe('shouldSkipUrl', () => {
    it('should skip image files', () => {
      expect(shouldSkipUrl('https://example.com/img.png')).toBe(true);
      expect(shouldSkipUrl('https://example.com/photo.jpg')).toBe(true);
      expect(shouldSkipUrl('https://example.com/icon.svg')).toBe(true);
    });

    it('should skip CSS and JS files', () => {
      expect(shouldSkipUrl('https://example.com/style.css')).toBe(true);
      expect(shouldSkipUrl('https://example.com/app.js')).toBe(true);
    });

    it('should skip font files', () => {
      expect(shouldSkipUrl('https://example.com/font.woff2')).toBe(true);
      expect(shouldSkipUrl('https://example.com/font.ttf')).toBe(true);
    });

    it('should skip media files', () => {
      expect(shouldSkipUrl('https://example.com/video.mp4')).toBe(true);
      expect(shouldSkipUrl('https://example.com/audio.mp3')).toBe(true);
    });

    it('should skip archive files', () => {
      expect(shouldSkipUrl('https://example.com/file.zip')).toBe(true);
      expect(shouldSkipUrl('https://example.com/doc.pdf')).toBe(true);
    });

    it('should skip mailto/tel/javascript links', () => {
      expect(shouldSkipUrl('mailto:test@example.com')).toBe(true);
      expect(shouldSkipUrl('tel:+1234567890')).toBe(true);
      expect(shouldSkipUrl('javascript:void(0)')).toBe(true);
    });

    it('should NOT skip HTML pages', () => {
      expect(shouldSkipUrl('https://example.com/page')).toBe(false);
      expect(shouldSkipUrl('https://example.com/about')).toBe(false);
      expect(shouldSkipUrl('https://example.com/blog/post')).toBe(false);
    });
  });

  describe('normalizeUrl', () => {
    it('should remove hash fragment', () => {
      expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
    });

    it('should remove trailing slash', () => {
      expect(normalizeUrl('https://example.com/page/')).toBe('https://example.com/page');
    });

    it('should normalize http to https', () => {
      expect(normalizeUrl('http://example.com/page')).toBe('https://example.com/page');
    });

    it('should remove www prefix', () => {
      expect(normalizeUrl('https://www.example.com/page')).toBe('https://example.com/page');
    });

    it('should handle combined normalizations', () => {
      expect(normalizeUrl('http://www.example.com/page/#section')).toBe('https://example.com/page');
    });

    it('should deduplicate same page with different representations', () => {
      const urls = [
        'https://example.com/about',
        'https://example.com/about/',
        'http://example.com/about',
        'https://www.example.com/about',
        'https://example.com/about#top',
      ];
      const normalized = new Set(urls.map(normalizeUrl));
      expect(normalized.size).toBe(1);
    });
  });

  describe('isUrlAllowed - same domain', () => {
    const startUrl = new URL('https://example.com/');

    it('should allow same domain', () => {
      expect(isUrlAllowed('https://example.com/about', startUrl, 1, defaultOptions)).toBe(true);
    });

    it('should block different domain', () => {
      expect(isUrlAllowed('https://other.com/page', startUrl, 1, defaultOptions)).toBe(false);
    });

    it('should allow different domain when allowExternalLinks is true', () => {
      const opts = { ...defaultOptions, allowExternalLinks: true };
      expect(isUrlAllowed('https://other.com/page', startUrl, 1, opts)).toBe(true);
    });
  });

  describe('isUrlAllowed - subdomains', () => {
    const startUrl = new URL('https://example.com/');

    it('should block subdomain when allowSubdomains is false', () => {
      expect(isUrlAllowed('https://sub.example.com/page', startUrl, 1, defaultOptions)).toBe(false);
    });

    it('should allow subdomain when allowSubdomains is true', () => {
      const opts = { ...defaultOptions, allowSubdomains: true };
      expect(isUrlAllowed('https://sub.example.com/page', startUrl, 1, opts)).toBe(true);
    });

    it('should allow exact same hostname regardless of allowSubdomains', () => {
      expect(isUrlAllowed('https://example.com/page', startUrl, 1, defaultOptions)).toBe(true);
    });
  });

  describe('isUrlAllowed - depth', () => {
    const startUrl = new URL('https://example.com/');

    it('should respect maxDepth', () => {
      expect(isUrlAllowed('https://example.com/a', startUrl, 3, defaultOptions)).toBe(true);
      expect(isUrlAllowed('https://example.com/a', startUrl, 4, defaultOptions)).toBe(false);
    });
  });

  describe('isUrlAllowed - includePaths', () => {
    const startUrl = new URL('https://example.com/');

    it('should only allow matching paths', () => {
      const opts = { ...defaultOptions, includePaths: ['^/blog'] };
      expect(isUrlAllowed('https://example.com/blog/post-1', startUrl, 1, opts)).toBe(true);
      expect(isUrlAllowed('https://example.com/about', startUrl, 1, opts)).toBe(false);
    });

    it('should support regex patterns', () => {
      const opts = { ...defaultOptions, includePaths: ['^/blog$'] };
      expect(isUrlAllowed('https://example.com/blog', startUrl, 1, opts)).toBe(true);
      expect(isUrlAllowed('https://example.com/blog/post', startUrl, 1, opts)).toBe(false);
    });
  });

  describe('isUrlAllowed - excludePaths', () => {
    const startUrl = new URL('https://example.com/');

    it('should exclude matching paths', () => {
      const opts = { ...defaultOptions, excludePaths: ['/admin'] };
      expect(isUrlAllowed('https://example.com/admin/settings', startUrl, 1, opts)).toBe(false);
      expect(isUrlAllowed('https://example.com/about', startUrl, 1, opts)).toBe(true);
    });
  });

  describe('isUrlAllowed - skip URLs', () => {
    const startUrl = new URL('https://example.com/');

    it('should skip binary file URLs', () => {
      expect(isUrlAllowed('https://example.com/image.png', startUrl, 1, defaultOptions)).toBe(false);
      expect(isUrlAllowed('https://example.com/script.js', startUrl, 1, defaultOptions)).toBe(false);
    });
  });

  describe('isUrlAllowed - path scope (allowBackwardCrawling)', () => {
    it('should restrict crawling to base path by default', () => {
      const startUrl = new URL('https://github.com/user/repo');
      expect(isUrlAllowed('https://github.com/user/repo/issues', startUrl, 1, defaultOptions)).toBe(true);
      expect(isUrlAllowed('https://github.com/user/repo/pulls', startUrl, 1, defaultOptions)).toBe(true);
      expect(isUrlAllowed('https://github.com/features/spark', startUrl, 1, defaultOptions)).toBe(false);
      expect(isUrlAllowed('https://github.com/security', startUrl, 1, defaultOptions)).toBe(false);
      expect(isUrlAllowed('https://github.com/login', startUrl, 1, defaultOptions)).toBe(false);
    });

    it('should allow exact base path match', () => {
      const startUrl = new URL('https://github.com/user/repo');
      expect(isUrlAllowed('https://github.com/user/repo', startUrl, 1, defaultOptions)).toBe(true);
    });

    it('should not restrict when base URL is root', () => {
      const startUrl = new URL('https://example.com/');
      expect(isUrlAllowed('https://example.com/about', startUrl, 1, defaultOptions)).toBe(true);
      expect(isUrlAllowed('https://example.com/blog/post', startUrl, 1, defaultOptions)).toBe(true);
    });

    it('should allow all paths when allowBackwardCrawling is true', () => {
      const startUrl = new URL('https://github.com/user/repo');
      const opts = { ...defaultOptions, allowBackwardCrawling: true };
      expect(isUrlAllowed('https://github.com/features/spark', startUrl, 1, opts)).toBe(true);
      expect(isUrlAllowed('https://github.com/security', startUrl, 1, opts)).toBe(true);
    });

    it('should handle base path with trailing slash', () => {
      const startUrl = new URL('https://github.com/user/repo/');
      expect(isUrlAllowed('https://github.com/user/repo/issues', startUrl, 1, defaultOptions)).toBe(true);
      expect(isUrlAllowed('https://github.com/features', startUrl, 1, defaultOptions)).toBe(false);
    });
  });
});

describe('Crawl - Command Registration', () => {
  it('should register crawl command', async () => {
    const { getCommand } = await import('../../src/commands/index.js');
    const cmd = getCommand('crawl');
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe('crawl');
    expect(cmd?.scope).toBe('project');
  });
});
