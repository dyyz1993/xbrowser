import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NPMSearcher } from '../../src/plugin/npm-search.js';

describe('NPMSearcher', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('search', () => {
    it('should search npm registry for xbrowser plugins', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          objects: [
            {
              package: {
                name: 'xbrowser-plugin-test',
                version: '1.0.0',
                description: 'A test plugin',
                author: 'Test Author',
                homepage: 'https://example.com',
                keywords: ['xbrowser-plugin', 'test'],
                date: '2024-01-01',
              },
            },
          ],
        }),
      };

      mockFetch.mockResolvedValue(mockResponse);

      const results = await NPMSearcher.search({ query: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://registry.npmjs.org/-/v1/search?text=test%20keywords%3Axbrowser-plugin%20keywords%3Axbrowser&size=20'
      );
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('xbrowser-plugin-test');
    });

    it('should filter by tag', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ objects: [] }),
      };

      mockFetch.mockResolvedValue(mockResponse);

      await NPMSearcher.search({ query: 'test', tag: 'ecommerce' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('keywords%3Aecommerce')
      );
    });

    it('should filter by site', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ objects: [] }),
      };

      mockFetch.mockResolvedValue(mockResponse);

      await NPMSearcher.search({ query: 'test', site: 'amazon.com' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('keywords%3Aamazon.com')
      );
    });

    it('should limit results', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ objects: [] }),
      };

      mockFetch.mockResolvedValue(mockResponse);

      await NPMSearcher.search({ query: 'test', limit: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('size=10')
      );
    });

    it('should throw error when fetch fails', async () => {
      const mockResponse = {
        ok: false,
        statusText: 'Not Found',
      };

      mockFetch.mockResolvedValue(mockResponse);

      await expect(NPMSearcher.search({ query: 'test' })).rejects.toThrow(
        'NPM search failed: Not Found'
      );
    });

    it('should parse npm package correctly', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          objects: [
            {
              package: {
                name: '@scope/xbrowser-plugin-test',
                version: '2.0.0',
                description: 'A scoped test plugin',
                author: { name: 'Scoped Author', email: 'test@example.com' },
                homepage: 'https://example.com',
                repository: { url: 'https://github.com/test/repo' },
                keywords: ['xbrowser-plugin', 'test', 'scoped'],
                date: '2024-01-01T00:00:00.000Z',
                score: {
                  detail: {
                    quality: 0.9,
                    popularity: 0.8,
                  },
                },
              },
            },
          ],
        }),
      };

      mockFetch.mockResolvedValue(mockResponse);

      const results = await NPMSearcher.search({});

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.name).toBe('@scope/xbrowser-plugin-test');
      expect(result.version).toBe('2.0.0');
      expect(result.author).toEqual({ name: 'Scoped Author' });
      expect(result.homepage).toBe('https://example.com');
      expect(result.repository?.url).toBe('https://github.com/test/repo');
      expect(result.keywords).toEqual(['xbrowser-plugin', 'test', 'scoped']);
      expect(result.quality).toBe(0.9);
      expect(result.popularity).toBe(0.8);
    });

    it('should handle empty results', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ objects: [] }),
      };

      mockFetch.mockResolvedValue(mockResponse);

      const results = await NPMSearcher.search({ query: 'nonexistent' });

      expect(results).toHaveLength(0);
    });
  });

  describe('getPackageManifest', () => {
    it('should fetch package manifest from npm', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          name: 'xbrowser-plugin-test',
          version: '1.0.0',
          xbrowser: {
            id: 'test-plugin',
            name: 'Test Plugin',
          },
        }),
      };

      mockFetch.mockResolvedValue(mockResponse);

      const manifest = await NPMSearcher.getPackageManifest('xbrowser-plugin-test');

      expect(mockFetch).toHaveBeenCalledWith('https://registry.npmjs.org/xbrowser-plugin-test');
      expect(manifest).toEqual({
        name: 'xbrowser-plugin-test',
        version: '1.0.0',
        xbrowser: {
          id: 'test-plugin',
          name: 'Test Plugin',
        },
      });
    });

    it('should throw error when manifest fetch fails', async () => {
      const mockResponse = {
        ok: false,
        statusText: 'Not Found',
      };

      mockFetch.mockResolvedValue(mockResponse);

      await expect(NPMSearcher.getPackageManifest('nonexistent-package')).rejects.toThrow(
        'Failed to fetch package manifest: Not Found'
      );
    });
  });
});
