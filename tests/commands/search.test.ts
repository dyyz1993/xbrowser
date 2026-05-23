import { describe, it, expect, vi } from 'vitest';
import * as cheerio from 'cheerio';
import {
  getRecencyParams,
  parseBingResults,
  parseGoogleResults,
  parseBaiduResults,
  normalizeUrl,
  resolveUrl,
  isAdResult,
  mergeResults,
  resolveBaiduRedirects,
} from '../../src/commands/search.js';

describe('search command - utility functions', () => {
  describe('getRecencyParams', () => {
    it('should generate hour filter parameters', () => {
      const params = getRecencyParams('hour');
      expect(params.bing).toContain('ez1');
      expect(params.google).toContain('qdr:h');
      expect(params.baidu).toContain('gpc=stf');
    });

    it('should generate day filter parameters', () => {
      const params = getRecencyParams('day');
      expect(params.bing).toContain('ez1');
      expect(params.google).toContain('qdr:d');
      expect(params.baidu).toContain('gpc=stf');
    });

    it('should generate week filter parameters', () => {
      const params = getRecencyParams('week');
      expect(params.bing).toContain('ez2');
      expect(params.google).toContain('qdr:w');
      expect(params.baidu).toContain('gpc=stf');
    });

    it('should generate month filter parameters', () => {
      const params = getRecencyParams('month');
      expect(params.bing).toContain('ez3');
      expect(params.google).toContain('qdr:m');
      expect(params.baidu).toContain('gpc=stf');
    });

    it('should generate year filter parameters', () => {
      const params = getRecencyParams('year');
      expect(params.bing).toContain('ez5');
      expect(params.google).toContain('qdr:y');
      expect(params.baidu).toContain('gpc=stf');
    });
  });

  describe('normalizeUrl', () => {
    it('should remove www prefix from hostname', () => {
      expect(normalizeUrl('https://www.example.com/path')).toBe('example.com/path');
    });

    it('should remove trailing slash', () => {
      expect(normalizeUrl('https://example.com/path/')).toBe('example.com/path');
    });

    it('should keep root path with trailing slash', () => {
      expect(normalizeUrl('https://example.com/')).toBe('example.com/');
    });

    it('should handle invalid URLs gracefully', () => {
      expect(normalizeUrl('not-a-url')).toBe('not-a-url');
    });

    it('should normalize URLs for comparison', () => {
      const url1 = normalizeUrl('https://www.example.com/path/');
      const url2 = normalizeUrl('https://example.com/path');
      expect(url1).toBe(url2);
    });
  });

  describe('resolveUrl', () => {
    it('should resolve Baidu redirect URLs', () => {
      const item = {
        title: 'Test',
        url: 'https://www.baidu.com/link?url=https%3A%2F%2Fexample.com',
        snippet: 'Test snippet',
        position: 1,
      };
      const resolved = resolveUrl(item);
      expect(resolved.url).toBe('https://example.com');
    });

    it('should keep normal URLs unchanged', () => {
      const item = {
        title: 'Test',
        url: 'https://example.com',
        snippet: 'Test snippet',
        position: 1,
      };
      const resolved = resolveUrl(item);
      expect(resolved.url).toBe('https://example.com');
    });

    it('should keep original URL when Baidu url param is not a valid URL', () => {
      const item = {
        title: 'Test',
        url: 'https://www.baidu.com/link?url=not-valid',
        snippet: 'Test snippet',
        position: 1,
      };
      const resolved = resolveUrl(item);
      // When the decoded value is not a valid URL, keep the original Baidu link
      expect(resolved.url).toBe('https://www.baidu.com/link?url=not-valid');
    });
  });

  describe('isAdResult', () => {
    it('should detect Chinese ads', () => {
      const item = {
        title: '广告标题',
        url: 'https://example.com',
        snippet: '这是推广内容',
        position: 1,
      };
      expect(isAdResult(item)).toBe(true);
    });

    it('should detect English ads', () => {
      const item = {
        title: 'Sponsored Content',
        url: 'https://example.com',
        snippet: 'This is an advertisement',
        position: 1,
      };
      expect(isAdResult(item)).toBe(true);
    });

    it('should accept normal results', () => {
      const item = {
        title: 'Normal Result',
        url: 'https://example.com',
        snippet: 'This is normal content',
        position: 1,
      };
      expect(isAdResult(item)).toBe(false);
    });

    it('should be case insensitive', () => {
      const item = {
        title: 'ADVERTISING',
        url: 'https://example.com',
        snippet: 'Promoted content',
        position: 1,
      };
      expect(isAdResult(item)).toBe(true);
    });
  });

  describe('mergeResults', () => {
    it('should merge results from multiple engines', () => {
      const results = [
        {
          engine: 'bing' as const,
          results: [
            { title: 'A', url: 'https://example.com/a', snippet: 'A snippet', position: 1 },
            { title: 'B', url: 'https://example.com/b', snippet: 'B snippet', position: 2 },
          ],
        },
        {
          engine: 'google' as const,
          results: [
            { title: 'A', url: 'https://example.com/a', snippet: 'A snippet', position: 1 },
            { title: 'C', url: 'https://example.com/c', snippet: 'C snippet', position: 2 },
          ],
        },
      ];

      const merged = mergeResults(results, 10);
      expect(merged).toHaveLength(3);
      expect(merged[0].url).toBe('https://example.com/a');
      expect(merged[1].url).toBe('https://example.com/b');
      expect(merged[2].url).toBe('https://example.com/c');
    });

    it('should prioritize results from more engines', () => {
      const results = [
        {
          engine: 'bing' as const,
          results: [
            { title: 'A', url: 'https://example.com/a', snippet: 'A snippet', position: 1 },
          ],
        },
        {
          engine: 'google' as const,
          results: [
            { title: 'A', url: 'https://example.com/a', snippet: 'A snippet', position: 1 },
            { title: 'B', url: 'https://example.com/b', snippet: 'B snippet', position: 1 },
          ],
        },
        {
          engine: 'baidu' as const,
          results: [
            { title: 'B', url: 'https://example.com/b', snippet: 'B snippet', position: 1 },
          ],
        },
      ];

      const merged = mergeResults(results, 10);
      expect(merged[0].url).toBe('https://example.com/a');
      expect(merged[1].url).toBe('https://example.com/b');
    });

    it('should filter out ad results', () => {
      const results = [
        {
          engine: 'bing' as const,
          results: [
            { title: '广告标题', url: 'https://example.com/ad', snippet: '推广内容', position: 1 },
            { title: 'Normal', url: 'https://example.com/normal', snippet: '正常内容', position: 2 },
          ],
        },
      ];

      const merged = mergeResults(results, 10);
      expect(merged).toHaveLength(1);
      expect(merged[0].title).toBe('Normal');
    });

    it('should respect limit parameter', () => {
      const results = [
        {
          engine: 'bing' as const,
          results: [
            { title: 'A', url: 'https://example.com/a', snippet: 'A snippet', position: 1 },
            { title: 'B', url: 'https://example.com/b', snippet: 'B snippet', position: 2 },
            { title: 'C', url: 'https://example.com/c', snippet: 'C snippet', position: 3 },
          ],
        },
      ];

      const merged = mergeResults(results, 2);
      expect(merged).toHaveLength(2);
    });

    it('should handle empty results', () => {
      const merged = mergeResults([], 10);
      expect(merged).toHaveLength(0);
    });
  });
});

describe('search command - parsers', () => {
  describe('parseBingResults', () => {
    it('should parse Bing search results', () => {
      const html = `
        <li class="b_algo">
          <h2><a href="https://example.com/page1">Test Title 1</a></h2>
          <div class="b_caption">
            <p>Test snippet 1</p>
          </div>
        </li>
        <li class="b_algo">
          <h2><a href="https://example.com/page2">Test Title 2</a></h2>
          <div class="b_caption">
            <p>Test snippet 2</p>
          </div>
        </li>
      `;
      const $ = cheerio.load(html);
      const results = parseBingResults($);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        title: 'Test Title 1',
        url: 'https://example.com/page1',
        snippet: 'Test snippet 1',
        position: 1,
      });
      expect(results[1]).toMatchObject({
        title: 'Test Title 2',
        url: 'https://example.com/page2',
        snippet: 'Test snippet 2',
        position: 2,
      });
    });

    it('should skip results without URL', () => {
      const html = `
        <li class="b_algo">
          <h2>Test Title</h2>
          <div class="b_caption">
            <p>Test snippet</p>
          </div>
        </li>
      `;
      const $ = cheerio.load(html);
      const results = parseBingResults($);

      expect(results).toHaveLength(0);
    });
  });

  describe('parseGoogleResults', () => {
    it('should parse Google search results with standard structure', () => {
      const html = `
        <div class="g">
          <div class="tF2Cxc">
            <h3><a href="https://example.com/page1">Test Title 1</a></h3>
            <div class="VwiC3b">Test snippet 1</div>
          </div>
        </div>
        <div class="g">
          <div class="tF2Cxc">
            <h3><a href="https://example.com/page2">Test Title 2</a></h3>
            <div class="VwiC3b">Test snippet 2</div>
          </div>
        </div>
      `;
      const $ = cheerio.load(html);
      const results = parseGoogleResults($);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        title: 'Test Title 1',
        url: 'https://example.com/page1',
        snippet: 'Test snippet 1',
        position: 1,
      });
    });

    it('should fallback to alternative structure', () => {
      const html = `
        <div class="g">
          <h3><a href="https://example.com/page1">Test Title 1</a></h3>
          <div class="VwiC3b">Test snippet 1</div>
        </div>
      `;
      const $ = cheerio.load(html);
      const results = parseGoogleResults($);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        title: 'Test Title 1',
        url: 'https://example.com/page1',
        snippet: 'Test snippet 1',
      });
    });

    it('should use snippet from style attribute if VwiC3b not found', () => {
      const html = `
        <div class="g">
          <h3><a href="https://example.com/page1">Test Title 1</a></h3>
          <div style="-webkit-line-clamp: 2">Test snippet from style</div>
        </div>
      `;
      const $ = cheerio.load(html);
      const results = parseGoogleResults($);

      expect(results).toHaveLength(1);
      expect(results[0].snippet).toBe('Test snippet from style');
    });
  });

  describe('parseBaiduResults', () => {
    it('should parse Baidu search results with result class', () => {
      const html = `
        <div class="result">
          <h3><a href="https://example.com/page1">Test Title 1</a></h3>
          <p class="c-abstract">Test snippet 1</p>
        </div>
        <div class="result">
          <h3><a href="https://example.com/page2">Test Title 2</a></h3>
          <p class="c-color-text c-line-clamp2">Test snippet 2</p>
        </div>
      `;
      const $ = cheerio.load(html);
      const results = parseBaiduResults($);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        title: 'Test Title 1',
        url: 'https://example.com/page1',
        snippet: 'Test snippet 1',
        position: 1,
      });
    });

    it('should parse Baidu results with c-container class', () => {
      const html = `
        <div class="c-container">
          <h3><a href="https://example.com/page1">Test Title 1</a></h3>
          <p class="c-color-text">Test snippet 1</p>
        </div>
      `;
      const $ = cheerio.load(html);
      const results = parseBaiduResults($);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        title: 'Test Title 1',
        url: 'https://example.com/page1',
        snippet: 'Test snippet 1',
      });
    });

    it('should extract snippet from paragraph if specific classes not found', () => {
      const html = `
        <div class="result">
          <h3><a href="https://example.com/page1">Test Title 1</a></h3>
          <p>This is a longer paragraph that should be extracted as the snippet</p>
        </div>
      `;
      const $ = cheerio.load(html);
      const results = parseBaiduResults($);

      expect(results).toHaveLength(1);
      expect(results[0].snippet).toContain('This is a longer paragraph');
    });
  });

  describe('resolveUrl - Baidu edge cases', () => {
    it('should preserve real URL when Baidu url param contains actual URL', () => {
      const item = {
        title: 'Test',
        url: 'https://www.baidu.com/link?url=https%3A%2F%2Fgithub.com%2Ftest',
        snippet: 'Test snippet',
        position: 1,
      };
      const resolved = resolveUrl(item);
      expect(resolved.url).toBe('https://github.com/test');
    });

    it('should keep original URL when Baidu url param is encrypted token', () => {
      // Synchronous resolveUrl can't decode encrypted tokens — async resolveBaiduRedirects handles that
      const item = {
        title: 'Test',
        url: 'http://www.baidu.com/link?url=7NQMJ3yUzbFXq4DPUHMMxVpLjonJqQEZC5ylr1kRweM_q4l782itJBEvRhOf',
        snippet: 'Test snippet',
        position: 1,
      };
      const resolved = resolveUrl(item);
      // Keeps the original baidu.com/link URL (not a bare token)
      expect(resolved.url).toContain('baidu.com/link');
    });

    it('should keep non-Baidu URLs unchanged', () => {
      const item = {
        title: 'Test',
        url: 'https://example.com/page',
        snippet: 'Test snippet',
        position: 1,
      };
      const resolved = resolveUrl(item);
      expect(resolved.url).toBe('https://example.com/page');
    });
  });

  describe('resolveBaiduRedirects - 302 redirect resolution', () => {
    it('should resolve Baidu redirect URL to real URL via 302 Location', async () => {
      // Mock global fetch to return 302 with Location header (case-insensitive)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        status: 302,
        headers: { get: (name: string) => name.toLowerCase() === 'location' ? 'https://example.com/real-page' : null },
      }));

      const items = [
        {
          title: 'Test',
          url: 'http://www.baidu.com/link?url=encrypted_token_here',
          snippet: 'Test snippet',
          position: 1,
        },
      ];

      const resolved = await resolveBaiduRedirects(items);
      expect(resolved[0].url).toBe('https://example.com/real-page');
      vi.restoreAllMocks();
    });

    it('should resolve multiple Baidu redirect URLs in parallel', async () => {
      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        callCount++;
        const urls = ['https://example.com/a', 'https://example.com/b'];
        return Promise.resolve({
          status: 302,
          headers: { get: (name: string) => name === 'location' ? urls[callCount - 1] : null },
        });
      }));

      const items = [
        { title: 'A', url: 'http://www.baidu.com/link?url=token_a', snippet: '', position: 1 },
        { title: 'B', url: 'http://www.baidu.com/link?url=token_b', snippet: '', position: 2 },
      ];

      const resolved = await resolveBaiduRedirects(items);
      expect(resolved[0].url).toMatch(/^https?:\/\//);
      expect(resolved[1].url).toMatch(/^https?:\/\//);
      expect(callCount).toBe(2);
      vi.restoreAllMocks();
    });

    it('should keep original URL when fetch fails or times out', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

      const items = [
        {
          title: 'Test',
          url: 'http://www.baidu.com/link?url=encrypted_token',
          snippet: 'Test snippet',
          position: 1,
        },
      ];

      const resolved = await resolveBaiduRedirects(items);
      // Fallback: keep the original Baidu redirect URL
      expect(resolved[0].url).toBe('http://www.baidu.com/link?url=encrypted_token');
      vi.restoreAllMocks();
    });

    it('should keep original URL when 302 Location is missing', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        status: 302,
        headers: { get: () => null },
      }));

      const items = [
        {
          title: 'Test',
          url: 'http://www.baidu.com/link?url=encrypted_token',
          snippet: 'Test snippet',
          position: 1,
        },
      ];

      const resolved = await resolveBaiduRedirects(items);
      expect(resolved[0].url).toBe('http://www.baidu.com/link?url=encrypted_token');
      vi.restoreAllMocks();
    });

    it('should skip non-Baidu URLs', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const items = [
        { title: 'Test', url: 'https://example.com/page', snippet: '', position: 1 },
      ];

      const resolved = await resolveBaiduRedirects(items);
      expect(resolved[0].url).toBe('https://example.com/page');
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it('should skip items where resolveUrl already decoded a real URL', async () => {
      // If the url= param was already a real URL, no need to fetch
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const items = [
        {
          title: 'Test',
          url: 'https://github.com/test',  // Already resolved by resolveUrl
          snippet: '',
          position: 1,
        },
      ];

      const resolved = await resolveBaiduRedirects(items);
      expect(resolved[0].url).toBe('https://github.com/test');
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });
  });

  describe('mergeResults - Baidu garbled URL prevention', () => {
    it('should filter out results with non-URL hrefs in merge', () => {
      const results = [
        {
          engine: 'baidu' as const,
          results: [
            {
              title: 'Test',
              // Bare encrypted token, not a real URL
              url: 'OrYtfZ0SXYmjEX_8ENnNmzF4wqENGEbS3M27O3pfJNbU',
              snippet: 'Test',
              position: 1,
            },
            {
              title: 'Valid',
              url: 'https://example.com/valid',
              snippet: 'Valid result',
              position: 2,
            },
          ],
        },
      ];

      const merged = mergeResults(results, 10);
      // The garbled token should not appear in final results
      const urls = merged.map(r => r.url);
      expect(urls).not.toContain('OrYtfZ0SXYmjEX_8ENnNmzF4wqENGEbS3M27O3pfJNbU');
      expect(urls).toContain('https://example.com/valid');
    });
  });

  // parseDuckDuckGoResults removed — DDG engine was dropped in search refactor
});