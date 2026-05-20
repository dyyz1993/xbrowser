import { describe, it, expect } from 'vitest';
import { calculateCompanyRankings, analyzeTrends } from '../src/commands/geo-analysis.js';
import type { SearchResult } from '../src/data-collector/types.js';

describe('GEO Analysis', () => {
  const mockSearchResults: SearchResult[] = [
    {
      id: 'test1',
      query: '广东服装加工企业',
      engine: 'kimi',
      timestamp: Date.now() - 86400000,
      total: 10,
      results: [],
      domainExtraction: {
        query: '广东服装加工企业',
        totalUrls: 5,
        totalDomains: 3,
        domains: [
          {
            domain: 'example.com',
            count: 3,
            urls: ['https://example.com/1'],
            platform: '测试平台',
          },
          {
            domain: 'test.com',
            count: 2,
            urls: ['https://test.com/1'],
          },
        ],
      },
    },
    {
      id: 'test2',
      query: '广东服装加工企业',
      engine: 'deepseek',
      timestamp: Date.now(),
      total: 8,
      results: [],
      domainExtraction: {
        query: '广东服装加工企业',
        totalUrls: 4,
        totalDomains: 2,
        domains: [
          {
            domain: 'example.com',
            count: 3,
            urls: ['https://example.com/2'],
            platform: '测试平台',
          },
          {
            domain: 'other.com',
            count: 1,
            urls: ['https://other.com/1'],
          },
        ],
      },
    },
  ];

  describe('calculateCompanyRankings', () => {
    it('should calculate company rankings correctly', async () => {
      const rankings = await calculateCompanyRankings(mockSearchResults);
      
      expect(rankings).toBeDefined();
      expect(Array.isArray(rankings)).toBe(true);
      expect(rankings.length).toBeGreaterThan(0);
      
      const exampleRank = rankings.find(r => r.domain === 'example.com');
      expect(exampleRank).toBeDefined();
      expect(exampleRank?.score).toBe(6); // 3 + 3 from both engines
      expect(exampleRank?.engines).toContain('kimi');
      expect(exampleRank?.engines).toContain('deepseek');
    });

    it('should rank companies by score', async () => {
      const rankings = await calculateCompanyRankings(mockSearchResults);
      
      expect(rankings[0].score).toBeGreaterThanOrEqual(rankings[1]?.score || 0);
    });
  });

  describe('analyzeTrends', () => {
    it('should analyze trends correctly', async () => {
      const trends = await analyzeTrends(mockSearchResults);
      
      expect(trends).toBeDefined();
      expect(Array.isArray(trends)).toBe(true);
    });

    it('should calculate growth rates', async () => {
      const trends = await analyzeTrends(mockSearchResults);
      
      trends.forEach(trend => {
        expect(trend.domain).toBeDefined();
        expect(trend.dates).toBeDefined();
        expect(trend.counts).toBeDefined();
        expect(trend.growthRate).toBeDefined();
        expect(['up', 'down', 'stable']).toContain(trend.trend);
      });
    });
  });
});
