import type { SearchResult } from '../data-collector/types.js';

export interface CompanyRanking {
  domain: string;
  score: number;
  engines: string[];
  urls: string[];
  platform?: string;
}

export interface TrendData {
  domain: string;
  dates: string[];
  counts: number[];
  growthRate: number;
  trend: 'up' | 'down' | 'stable';
}

export async function calculateCompanyRankings(
  results: SearchResult[],
): Promise<CompanyRanking[]> {
  const domainMap = new Map<
    string,
    { count: number; engines: Set<string>; urls: Set<string>; platform?: string }
  >();

  for (const result of results) {
    const domains = result.domainExtraction?.domains || [];
    for (const d of domains) {
      const existing = domainMap.get(d.domain) || {
        count: 0,
        engines: new Set<string>(),
        urls: new Set<string>(),
        platform: d.platform,
      };
      existing.count += d.count;
      existing.engines.add(result.engine);
      for (const u of d.urls) existing.urls.add(u);
      if (d.platform) existing.platform = d.platform;
      domainMap.set(d.domain, existing);
    }
  }

  const rankings: CompanyRanking[] = [];
  for (const [domain, data] of domainMap) {
    rankings.push({
      domain,
      score: data.count,
      engines: Array.from(data.engines),
      urls: Array.from(data.urls),
      platform: data.platform,
    });
  }

  rankings.sort((a, b) => b.score - a.score);
  return rankings;
}

export async function analyzeTrends(
  results: SearchResult[],
): Promise<TrendData[]> {
  const domainByDate = new Map<
    string,
    Map<string, { count: number; date: string }[]>
  >();

  for (const result of results) {
    const date = new Date(result.timestamp).toISOString().split('T')[0];
    const domains = result.domainExtraction?.domains || [];
    for (const d of domains) {
      if (!domainByDate.has(d.domain)) {
        domainByDate.set(d.domain, new Map());
      }
      const dateMap = domainByDate.get(d.domain)!;
      if (!dateMap.has(date)) {
        dateMap.set(date, []);
      }
      dateMap.get(date)!.push({ count: d.count, date });
    }
  }

  const trends: TrendData[] = [];
  for (const [domain, dateMap] of domainByDate) {
    const sortedDates = Array.from(dateMap.keys()).sort();
    const counts = sortedDates.map((date) =>
      dateMap.get(date)!.reduce((sum, e) => sum + e.count, 0),
    );

    let growthRate = 0;
    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (counts.length >= 2) {
      const first = counts[0];
      const last = counts[counts.length - 1];
      growthRate = first === 0 ? (last > 0 ? 100 : 0) : ((last - first) / first) * 100;
      if (growthRate > 10) trend = 'up';
      else if (growthRate < -10) trend = 'down';
    }

    trends.push({
      domain,
      dates: sortedDates,
      counts,
      growthRate: Math.round(growthRate * 100) / 100,
      trend,
    });
  }

  trends.sort((a, b) => b.counts.reduce((s, c) => s + c, 0) - a.counts.reduce((s, c) => s + c, 0));
  return trends;
}
