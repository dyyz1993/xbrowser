import { describe, it, expect } from 'vitest';
import {
  analyzeEntry,
  enrichEntry,
  enrichEntries,
} from '../../src/daemon/api-analyzer';
import type { ScoredEntry } from '../../src/daemon/network-scorer';

function makeEntry(overrides: Record<string, unknown> = {}): { url: string; headers: Record<string, string>; body?: unknown } {
  return {
    url: 'https://example.com/api/data',
    headers: { 'content-type': 'application/json' },
    body: undefined,
    ...overrides,
  };
}

function makeScoredEntry(overrides: Record<string, unknown> = {}): ScoredEntry {
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
    score: 50,
    scoreBreakdown: { method: 10, resourceType: 20, size: 10, content: 10 },
    ...overrides,
  };
}

describe('api-analyzer', () => {
  describe('analyzeEntry', () => {
    it('simple GET should have high reusability', () => {
      const result = analyzeEntry(makeEntry({ method: 'GET' }));
      expect(result.level).toBe('high');
      expect(result.score).toBeGreaterThanOrEqual(80);
      expect(result.reasons).toEqual([]);
      expect(result.detections.needsSignature).toBe(false);
      expect(result.detections.needsTimestamp).toBe(false);
      expect(result.detections.needsAuthToken).toBe(false);
      expect(result.detections.needsCookies).toBe(false);
    });

    it('POST with signature should have reduced reusability', () => {
      const result = analyzeEntry(makeEntry({ method: 'POST', body: { sign: 'abc123' } }));
      expect(result.detections.needsSignature).toBe(true);
      expect(result.reasons).toContain('Requires signature parameter');
      expect(result.score).toBe(60);
      expect(result.level).toBe('medium');
    });

    it('POST with Authorization header should be high with minor penalty', () => {
      const result = analyzeEntry(makeEntry({
        method: 'POST',
        headers: { authorization: 'Bearer xxx' },
      }));
      expect(result.detections.needsAuthToken).toBe(true);
      expect(result.reasons).toContain('Requires authorization token');
      expect(result.score).toBe(80);
      expect(result.level).toBe('high');
    });

    it('POST with timestamp signals time-sensitive request', () => {
      const result = analyzeEntry(makeEntry({ method: 'POST', body: { timestamp: 123456 } }));
      expect(result.detections.needsTimestamp).toBe(true);
      expect(result.reasons).toContain('Requires fresh timestamp');
      expect(result.score).toBe(80);
      expect(result.level).toBe('high');
    });

    it('POST with sign + ts + auth should be low', () => {
      const result = analyzeEntry(makeEntry({
        method: 'POST',
        body: { sign: 'abc', timestamp: 123456 },
        headers: { authorization: 'Bearer xxx' },
      }));
      expect(result.level).toBe('low');
      expect(result.detections.needsSignature).toBe(true);
      expect(result.detections.needsTimestamp).toBe(true);
      expect(result.detections.needsAuthToken).toBe(true);
      expect(result.score).toBeLessThanOrEqual(40);
    });

    it('GET with appKey should have fixed credentials and still be high', () => {
      const result = analyzeEntry(makeEntry({ url: 'https://example.com/api/data?appKey=xxx' }));
      expect(result.detections.hasFixedCredentials).toBe(true);
      expect(result.reasons).toContain('Has fixed API credentials');
      expect(result.level).toBe('high');
    });

    it('POST with Cookie header signals session dependency', () => {
      const result = analyzeEntry(makeEntry({
        method: 'POST',
        headers: { cookie: 'session=abc123' },
      }));
      expect(result.detections.needsCookies).toBe(true);
      expect(result.reasons).toContain('Requires session cookies');
      expect(result.score).toBe(85);
      expect(result.level).toBe('high');
    });

    it('should handle empty/no body without errors', () => {
      const result = analyzeEntry(makeEntry({ body: undefined }));
      expect(result.level).toBe('high');
      expect(result.detections.needsSignature).toBe(false);
    });

    it('should detect Cookie from lowercase cookie header', () => {
      const result = analyzeEntry(makeEntry({ headers: { cookie: 'session=xyz' } }));
      expect(result.detections.needsCookies).toBe(true);
    });

    it('should detect signature keys in URL query string', () => {
      const result = analyzeEntry(makeEntry({ url: 'https://example.com/api?sign=hash&ts=123' }));
      expect(result.detections.needsSignature).toBe(true);
      expect(result.detections.needsTimestamp).toBe(true);
    });

    it('should detect signature via _sign key in body', () => {
      const result = analyzeEntry(makeEntry({ body: { _sign: 'abc' } }));
      expect(result.detections.needsSignature).toBe(true);
    });

    it('should detect client_id in URL', () => {
      const result = analyzeEntry(makeEntry({ url: 'https://example.com/api?client_id=myapp' }));
      expect(result.detections.hasFixedCredentials).toBe(true);
    });

    it('should return lowest score when all factors present', () => {
      const result = analyzeEntry(makeEntry({
        url: 'https://example.com/api?sign=s',
        body: { timestamp: 1 },
        headers: { authorization: 'Bearer x', cookie: 'y' },
      }));
      expect(result.level).toBe('low');
      expect(result.score).toBe(5);
    });

    it('should handle null body', () => {
      const result = analyzeEntry(makeEntry({ body: null }));
      expect(result.level).toBe('high');
      expect(result.detections.needsSignature).toBe(false);
    });

    it('should handle non-object body', () => {
      const result = analyzeEntry(makeEntry({ body: 'string-body' }));
      expect(result.level).toBe('high');
      expect(result.detections.needsSignature).toBe(false);
    });

    it('should detect sig key', () => {
      const result = analyzeEntry(makeEntry({ body: { sig: 'val' } }));
      expect(result.detections.needsSignature).toBe(true);
    });

    it('should detect nonce as timestamp', () => {
      const result = analyzeEntry(makeEntry({ body: { nonce: 'random' } }));
      expect(result.detections.needsTimestamp).toBe(true);
    });

    it('should detect app_key in body', () => {
      const result = analyzeEntry(makeEntry({ body: { app_key: 'myapp' } }));
      expect(result.detections.hasFixedCredentials).toBe(true);
    });

    it('should detect api_key in URL', () => {
      const result = analyzeEntry(makeEntry({ url: 'https://example.com/api?api_key=xyz' }));
      expect(result.detections.hasFixedCredentials).toBe(true);
    });

    it('should detect sign_data in body', () => {
      const result = analyzeEntry(makeEntry({ body: { sign_data: 'hash' } }));
      expect(result.detections.needsSignature).toBe(true);
    });
  });

  describe('enrichEntry', () => {
    it('should preserve all ScoredEntry fields', () => {
      const scored = makeScoredEntry({
        id: 42,
        url: 'https://example.com/test',
        method: 'POST',
        status: 201,
        score: 75,
      });
      const enriched = enrichEntry(scored);
      expect(enriched.id).toBe(42);
      expect(enriched.url).toBe('https://example.com/test');
      expect(enriched.method).toBe('POST');
      expect(enriched.status).toBe(201);
      expect(enriched.score).toBe(75);
      expect(enriched.scoreBreakdown).toEqual(scored.scoreBreakdown);
      expect(enriched.reusability).toBeDefined();
      expect(enriched.reusability.level).toBe('high');
    });
  });

  describe('enrichEntries', () => {
    it('should enrich all entries preserving sort order', () => {
      const entries = [
        makeScoredEntry({ id: 1, score: 90 }),
        makeScoredEntry({ id: 2, score: 50 }),
        makeScoredEntry({ id: 3, score: 10 }),
      ];
      const enriched = enrichEntries(entries);
      expect(enriched).toHaveLength(3);
      expect(enriched[0].id).toBe(1);
      expect(enriched[1].id).toBe(2);
      expect(enriched[2].id).toBe(3);
      for (const e of enriched) {
        expect(e.reusability).toBeDefined();
      }
    });

    it('should handle empty array', () => {
      const enriched = enrichEntries([]);
      expect(enriched).toEqual([]);
    });
  });
});
