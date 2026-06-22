import { describe, it, expect } from 'vitest';
import {
  getPlatformName,
  getCompanyType,
  EXCLUDED_DOMAINS,
  PLATFORM_MAPPING,
  DEFAULT_STORAGE_CONFIG,
  DEFAULT_COLLECTOR_CONFIG,
} from '../../src/data-collector/config.js';
import { ResultAnalyzer } from '../../src/data-collector/analyzer.js';
import type { SearchResult } from '../../src/data-collector/types.js';

// Helper: build a mock SearchResult for analyzer tests
function mockResult(query: string, domains: string[], engine: string = 'deepseek'): SearchResult {
  return {
    id: `${query}-${engine}-${Math.random()}`,
    collectedAt: Date.now(),
    query,
    engine,
    success: true,
    total: domains.length,
    items: domains.map((d, i) => ({ title: `Result ${i}`, url: `https://${d}/page`, snippet: '...', position: i })),
    domainExtraction: {
      domains: domains.map((d) => ({ domain: d, count: 1, urls: [`https://${d}`] })),
    },
    timestamp: Date.now(),
  } as unknown as SearchResult;
}

describe('data-collector config', () => {
  describe('getPlatformName', () => {
    it('should resolve known domains', () => {
      expect(getPlatformName('zhihu.com')).toBe('知乎');
      expect(getPlatformName('juejin.cn')).toBe('掘金');
      expect(getPlatformName('csdn.net')).toBe('CSDN');
    });

    it('should strip www. prefix', () => {
      expect(getPlatformName('www.zhihu.com')).toBe('知乎');
    });

    it('should return undefined for unknown domains', () => {
      expect(getPlatformName('unknown.com')).toBeUndefined();
    });
  });

  describe('getCompanyType', () => {
    it('should classify gov domains', () => {
      // .gov.cn and .gov suffixes are classified as gov
      expect(getCompanyType('example.gov.cn')).toBe('gov');
      expect(getCompanyType('example.gov')).toBe('gov');
    });

    it('should classify job platforms', () => {
      expect(getCompanyType('zhipin.com')).toBe('job-platform');
      expect(getCompanyType('www.lagou.com')).toBe('job-platform');
      expect(getCompanyType('career.51job.com')).toBe('job-platform');
    });

    it('should classify media platforms', () => {
      expect(getCompanyType('thepaper.cn')).toBe('media');
      expect(getCompanyType('36kr.com')).toBe('media');
      expect(getCompanyType('tech.sina.com.cn')).toBe('media');
    });

    it('should classify AI platforms', () => {
      expect(getCompanyType('openai.com')).toBe('ai-platform');
      expect(getCompanyType('deepseek.com')).toBe('ai-platform');
    });

    it('should default to enterprise for others', () => {
      expect(getCompanyType('example.com')).toBe('enterprise');
    });
  });

  describe('constants', () => {
    it('EXCLUDED_DOMAINS should contain AI and search domains', () => {
      expect(EXCLUDED_DOMAINS.has('deepseek.com')).toBe(true);
      expect(EXCLUDED_DOMAINS.has('baidu.com')).toBe(true);
      expect(EXCLUDED_DOMAINS.size).toBeGreaterThan(10);
    });

    it('PLATFORM_MAPPING should have entries', () => {
      expect(Object.keys(PLATFORM_MAPPING).length).toBeGreaterThan(10);
    });

    it('DEFAULT_STORAGE_CONFIG should have sensible defaults', () => {
      expect(DEFAULT_STORAGE_CONFIG.format).toBe('json');
      expect(DEFAULT_STORAGE_CONFIG.autoBackup).toBe(true);
    });

    it('DEFAULT_COLLECTOR_CONFIG should have sensible defaults', () => {
      expect(DEFAULT_COLLECTOR_CONFIG.timeout).toBeGreaterThan(0);
      expect(DEFAULT_COLLECTOR_CONFIG.maxRetries).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('ResultAnalyzer', () => {
  it('should analyze empty results', () => {
    const analyzer = new ResultAnalyzer([]);
    const result = analyzer.analyzeAll();
    expect(result.totalResults).toBe(0);
    expect(result.totalQueries).toBe(0);
    expect(result.uniqueDomains).toBe(0);
    expect(result.domainRankings).toEqual([]);
    expect(result.topCompanies).toEqual([]);
  });

  it('should count total results and queries', () => {
    const results = [
      mockResult('test', ['a.com']),
      mockResult('test', ['b.com']),
      mockResult('other', ['a.com']),
    ];
    const analyzer = new ResultAnalyzer(results);
    const result = analyzer.analyzeAll();
    expect(result.totalQueries).toBe(2); // unique queries
    expect(result.totalResults).toBe(3);
  });

  it('should rank domains by frequency', () => {
    const results = [
      mockResult('q', ['a.com', 'b.com']),
      mockResult('q', ['a.com', 'c.com']),
      mockResult('q', ['a.com']),
    ];
    const analyzer = new ResultAnalyzer(results);
    const result = analyzer.analyzeAll();
    // a.com appears 3 times, b.com and c.com once each
    expect(result.domainRankings.length).toBeGreaterThanOrEqual(1);
    expect(result.domainRankings[0].domain).toBe('a.com');
    expect(result.uniqueDomains).toBe(3);
  });

  it('should calculate engine distribution', () => {
    const results = [
      mockResult('q', ['a.com'], 'deepseek'),
      mockResult('q', ['b.com'], 'deepseek'),
      mockResult('q', ['c.com'], 'qianwen'),
    ];
    const analyzer = new ResultAnalyzer(results);
    const result = analyzer.analyzeAll();
    expect(result.engineDistribution.get('deepseek')).toBe(2);
    expect(result.engineDistribution.get('qianwen')).toBe(1);
  });

  it('should track query history', () => {
    const results = [
      mockResult('query1', ['a.com']),
      mockResult('query2', ['b.com']),
    ];
    const analyzer = new ResultAnalyzer(results);
    const result = analyzer.analyzeAll();
    expect(result.queryHistory).toContain('query1');
    expect(result.queryHistory).toContain('query2');
  });

  it('should identify companies from domains', () => {
    const results = [
      mockResult('q', ['zhipin.com', '36kr.com']),
    ];
    const analyzer = new ResultAnalyzer(results);
    const result = analyzer.analyzeAll();
    expect(result.topCompanies.length).toBeGreaterThan(0);
    const types = result.topCompanies.map((c) => c.type);
    expect(types).toContain('job-platform');
    expect(types).toContain('media');
  });
});
