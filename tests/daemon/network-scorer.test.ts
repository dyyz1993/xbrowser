import { describe, it, expect } from 'vitest';
import {
  scoreEntry,
  scoreEntries,
  DEFAULT_WEIGHTS,
} from '../../src/daemon/network-scorer';
import type { NetworkCaptureEntry } from '../../src/daemon/network-store';

function makeEntry(
  overrides: Partial<Omit<NetworkCaptureEntry, 'id'>> = {},
): NetworkCaptureEntry {
  return {
    id: 1,
    timestamp: Date.now(),
    method: 'GET',
    url: 'https://example.com/api/data',
    path: '/api/data',
    status: 200,
    contentType: 'application/json',
    size: 1024,
    headers: { 'content-type': 'application/json' },
    resourceType: 'fetch',
    ...overrides,
  };
}

describe('network-scorer', () => {
  describe('scoreEntry', () => {
    it('POST to /api/ with JSON body should score high (>= 60)', () => {
      const entry = makeEntry({
        method: 'POST',
        url: 'https://example.com/api/users',
        path: '/api/users',
        contentType: 'application/json',
        resourceType: 'xhr',
        size: 2048,
        body: { name: 'test' },
      });
      const scored = scoreEntry(entry);
      expect(scored.score).toBeGreaterThanOrEqual(60);
      expect(scored.scoreBreakdown.method).toBe(DEFAULT_WEIGHTS.method.post);
      expect(scored.scoreBreakdown.resourceType).toBe(DEFAULT_WEIGHTS.resourceType.api);
      expect(scored.scoreBreakdown.size).toBe(DEFAULT_WEIGHTS.size.goodRange);
      expect(scored.scoreBreakdown.content).toBeGreaterThanOrEqual(
        DEFAULT_WEIGHTS.content.isJson + DEFAULT_WEIGHTS.content.urlContainsApi,
      );
    });

    it('GET to /api/ with JSON response should score medium (>= 30)', () => {
      const entry = makeEntry({
        method: 'GET',
        url: 'https://example.com/api/items',
        path: '/api/items',
        contentType: 'application/json',
        resourceType: 'fetch',
        size: 512,
        body: { items: [] },
      });
      const scored = scoreEntry(entry);
      expect(scored.score).toBeGreaterThanOrEqual(30);
      expect(scored.scoreBreakdown.method).toBe(DEFAULT_WEIGHTS.method.get);
    });

    it('static resource (stylesheet) should get negative or very low score', () => {
      const entry = makeEntry({
        method: 'GET',
        url: 'https://example.com/assets/style.css',
        path: '/assets/style.css',
        contentType: 'text/css',
        resourceType: 'stylesheet',
        size: 50000,
      });
      const scored = scoreEntry(entry);
      expect(scored.score).toBeLessThanOrEqual(0);
      expect(scored.scoreBreakdown.resourceType).toBe(DEFAULT_WEIGHTS.resourceType.static);
    });

    it('document navigation (HTML page) should get low score', () => {
      const entry = makeEntry({
        method: 'GET',
        url: 'https://example.com/page',
        path: '/page',
        contentType: 'text/html',
        resourceType: 'document',
        size: 30000,
      });
      const scored = scoreEntry(entry);
      expect(scored.score).toBeLessThanOrEqual(15);
      expect(scored.scoreBreakdown.resourceType).toBe(DEFAULT_WEIGHTS.resourceType.document);
    });

    it('GET xhr to /api/users with JSON array body should score high', () => {
      const entry = makeEntry({
        method: 'GET',
        url: 'https://example.com/api/users',
        path: '/api/users',
        contentType: 'application/json',
        resourceType: 'xhr',
        size: 4096,
        body: { data: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] },
      });
      const scored = scoreEntry(entry);
      expect(scored.score).toBeGreaterThanOrEqual(55);
      expect(scored.scoreBreakdown.content).toBeGreaterThanOrEqual(
        DEFAULT_WEIGHTS.content.isJson + DEFAULT_WEIGHTS.content.hasDataArray + DEFAULT_WEIGHTS.content.urlContainsApi,
      );
    });

    it('large file download (> 1MB) should get negative size contribution', () => {
      const entry = makeEntry({
        method: 'GET',
        url: 'https://example.com/files/big.zip',
        path: '/files/big.zip',
        contentType: 'application/zip',
        resourceType: 'other',
        size: 5 * 1024 * 1024,
      });
      const scored = scoreEntry(entry);
      expect(scored.scoreBreakdown.size).toBe(DEFAULT_WEIGHTS.size.tooLarge);
      expect(scored.score).toBeLessThanOrEqual(0);
    });

    it('should use custom weights when provided', () => {
      const entry = makeEntry({
        method: 'POST',
        resourceType: 'xhr',
        contentType: 'application/json',
        url: 'https://example.com/api/data',
        size: 1024,
        body: {},
      });
      const customWeights = {
        method: { post: 100, get: 0, other: 0 },
        resourceType: { api: 0, document: 0, static: 0, other: 0 },
        size: { goodRange: 0, tooLarge: 0 },
        content: { isJson: 0, hasDataArray: 0, urlContainsApi: 0 },
      };
      const scored = scoreEntry(entry, customWeights);
      expect(scored.scoreBreakdown.method).toBe(100);
      expect(scored.score).toBe(100);
    });

    it('should handle empty body', () => {
      const entry = makeEntry({
        method: 'GET',
        contentType: 'text/plain',
        resourceType: 'other',
        size: 0,
        url: 'https://example.com/health',
      });
      const scored = scoreEntry(entry);
      expect(scored.scoreBreakdown.size).toBe(0);
      expect(scored.scoreBreakdown.content).toBe(0);
    });

    it('should handle binary content type', () => {
      const entry = makeEntry({
        method: 'GET',
        contentType: 'image/png',
        resourceType: 'image',
        size: 50000,
        url: 'https://example.com/logo.png',
      });
      const scored = scoreEntry(entry);
      expect(scored.scoreBreakdown.content).toBe(0);
      expect(scored.scoreBreakdown.resourceType).toBe(DEFAULT_WEIGHTS.resourceType.static);
    });

    it('should handle unknown resource type', () => {
      const entry = makeEntry({
        resourceType: 'websocket',
        contentType: 'text/plain',
        method: 'GET',
        url: 'https://example.com/ws',
        size: 0,
      });
      const scored = scoreEntry(entry);
      expect(scored.scoreBreakdown.resourceType).toBe(DEFAULT_WEIGHTS.resourceType.other);
    });

    it('should detect /graphql in URL', () => {
      const entry = makeEntry({
        method: 'POST',
        url: 'https://example.com/graphql',
        path: '/graphql',
        contentType: 'application/json',
        resourceType: 'fetch',
        size: 500,
        body: { query: '{ users { id } }' },
      });
      const scored = scoreEntry(entry);
      expect(scored.scoreBreakdown.content).toBeGreaterThanOrEqual(
        DEFAULT_WEIGHTS.content.isJson + DEFAULT_WEIGHTS.content.urlContainsApi,
      );
    });

    it('should detect /v1/ and /v2/ in URL', () => {
      const entry1 = makeEntry({ url: 'https://example.com/v1/users', contentType: 'application/json', size: 0 });
      const entry2 = makeEntry({ url: 'https://example.com/v2/items', contentType: 'application/json', size: 0 });
      expect(scoreEntry(entry1).scoreBreakdown.content).toBeGreaterThanOrEqual(DEFAULT_WEIGHTS.content.urlContainsApi);
      expect(scoreEntry(entry2).scoreBreakdown.content).toBeGreaterThanOrEqual(DEFAULT_WEIGHTS.content.urlContainsApi);
    });

    it('should detect data array keys: data, list, items, results, records', () => {
      for (const key of ['data', 'list', 'items', 'results', 'records']) {
        const entry = makeEntry({
          contentType: 'application/json',
          size: 500,
          body: { [key]: [1, 2, 3] },
        });
        const scored = scoreEntry(entry);
        expect(scored.scoreBreakdown.content).toBeGreaterThanOrEqual(
          DEFAULT_WEIGHTS.content.isJson + DEFAULT_WEIGHTS.content.hasDataArray,
        );
      }
    });

    it('should not give hasDataArray for non-array values', () => {
      const entry = makeEntry({
        contentType: 'application/json',
        size: 500,
        body: { data: 'not-an-array' },
      });
      const scored = scoreEntry(entry);
      expect(scored.scoreBreakdown.content).toBeLessThan(
        DEFAULT_WEIGHTS.content.isJson + DEFAULT_WEIGHTS.content.hasDataArray,
      );
    });
  });

  describe('scoreEntries', () => {
    it('should sort entries by score descending', () => {
      const entries = [
        makeEntry({ id: 1, method: 'GET', resourceType: 'stylesheet', contentType: 'text/css', size: 50000, url: 'https://example.com/style.css' }),
        makeEntry({ id: 2, method: 'POST', resourceType: 'xhr', contentType: 'application/json', size: 2048, url: 'https://example.com/api/users', body: { data: [1, 2] } }),
        makeEntry({ id: 3, method: 'GET', resourceType: 'document', contentType: 'text/html', size: 30000, url: 'https://example.com/' }),
      ];
      const scored = scoreEntries(entries);
      expect(scored[0].id).toBe(2);
      expect(scored[1].id).toBe(3);
      expect(scored[2].id).toBe(1);
      for (let i = 1; i < scored.length; i++) {
        expect(scored[i].score).toBeLessThanOrEqual(scored[i - 1].score);
      }
    });

    it('should handle empty array', () => {
      const scored = scoreEntries([]);
      expect(scored).toEqual([]);
    });

    it('should preserve all original entry fields', () => {
      const entry = makeEntry({ id: 42, url: 'https://example.com/test' });
      const scored = scoreEntries([entry]);
      expect(scored[0].id).toBe(42);
      expect(scored[0].url).toBe('https://example.com/test');
      expect(scored[0].score).toBeDefined();
      expect(scored[0].scoreBreakdown).toBeDefined();
    });
  });
});
