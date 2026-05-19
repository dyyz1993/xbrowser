import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import { registerCommand } from './command-registry.js';
import { DataCollector, DataStorage, ResultAnalyzer } from '../data-collector/index.js';
import type { SearchResult, CollectResult, BatchCollectResult, AnalysisResult, DomainStat } from '../data-collector/types.js';
import { DEFAULT_COLLECTOR_CONFIG } from '../data-collector/config.js';

export interface CompanyRank {
  name: string;
  domain: string;
  type: string;
  score: number;
  occurrences: number;
  engines: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface TrendData {
  domain: string;
  dates: string[];
  counts: number[];
  growthRate: number;
  trend: 'up' | 'down' | 'stable';
}

export interface GeoAnalysisResult {
  mode: string;
  timestamp: number;
  keyword: string;
  timeframe: string;
  engines: string[];
  data?: {
    collection?: BatchCollectResult;
    analysis?: AnalysisResult;
    rankings?: CompanyRank[];
    trends?: TrendData[];
  };
  summary?: {
    totalEngines: number;
    successfulEngines: number;
    totalResults: number;
    uniqueDomains: number;
    topDomains: { domain: string; count: number; platform?: string }[];
  };
}

export async function calculateCompanyRankings(
  results: SearchResult[]
): Promise<CompanyRank[]> {
  const analyzer = new ResultAnalyzer(results);
  const analysis = analyzer.analyzeAll();
  const domainScores = new Map<string, CompanyRank>();

  analysis.domainRankings.forEach((domain: DomainStat) => {
    const domainLower = domain.domain.toLowerCase();
    const existing = domainScores.get(domainLower);

    if (!existing) {
      domainScores.set(domainLower, {
        name: domain.platform || domain.domain,
        domain: domain.domain,
        type: getPlatformType(domain.domain),
        score: domain.count,
        occurrences: domain.count,
        engines: [],
        firstSeen: domain.firstSeen,
        lastSeen: domain.lastSeen,
      });
    } else {
      existing.score += domain.count;
      existing.occurrences += domain.count;
    }
  });

  results.forEach(result => {
    if (result.domainExtraction) {
      result.domainExtraction.domains.forEach(domain => {
        const domainLower = domain.domain.toLowerCase();
        const rank = domainScores.get(domainLower);
        if (rank && !rank.engines.includes(result.engine)) {
          rank.engines.push(result.engine);
        }
      });
    }
  });

  return Array.from(domainScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
}

function getPlatformType(domain: string): string {
  const d = domain.toLowerCase();
  if (d.includes('.gov') || d.includes('.gov.cn')) return 'government';
  if (d.includes('zhipin') || d.includes('lagou') || d.includes('51job')) return 'job-platform';
  if (d.includes('weixin') || d.includes('toutiao') || d.includes('36kr')) return 'media';
  if (d.includes('openai') || d.includes('anthropic') || d.includes('deepseek')) return 'ai-platform';
  return 'enterprise';
}

export async function analyzeTrends(
  results: SearchResult[]
): Promise<TrendData[]> {

  const domainTrends = new Map<string, { dates: string[]; counts: number[] }>();

  results.forEach(result => {
    if (!result.domainExtraction) return;

    const dateKey = new Date(result.timestamp).toISOString().split('T')[0];

    result.domainExtraction.domains.forEach(domain => {
      if (!domainTrends.has(domain.domain)) {
        domainTrends.set(domain.domain, { dates: [], counts: [] });
      }
      const trend = domainTrends.get(domain.domain)!;
      trend.dates.push(dateKey);
      trend.counts.push(domain.count);
    });
  });

  const trends: TrendData[] = [];

  domainTrends.forEach((data, domain) => {
    if (data.dates.length < 2) return;

    const firstCount = data.counts[0];
    const lastCount = data.counts[data.counts.length - 1];
    const growthRate = firstCount > 0 ? ((lastCount - firstCount) / firstCount) * 100 : 0;

    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (growthRate > 10) trend = 'up';
    else if (growthRate < -10) trend = 'down';

    trends.push({
      domain,
      dates: data.dates,
      counts: data.counts,
      growthRate,
      trend,
    });
  });

  return trends.sort((a, b) => Math.abs(b.growthRate) - Math.abs(a.growthRate)).slice(0, 20);
}

async function generateReport(
  mode: string,
  data: GeoAnalysisResult['data'],
  output: string
): Promise<string> {
  if (output === 'json') {
    return JSON.stringify(data, null, 2);
  }

  if (output === 'markdown') {
    const lines: string[] = [
      '# GEO Analysis Report',
      '',
      `Generated: ${new Date().toLocaleString('zh-CN')}`,
      `Mode: ${mode}`,
      '',
    ];

    if (data?.collection) {
      const col = data.collection;
      lines.push('## Collection Summary');
      lines.push('');
      lines.push(`- **Total Engines**: ${col.totalEngines}`);
      lines.push(`- **Successful**: ${col.successfulEngines}`);
      lines.push(`- **Failed**: ${col.failedEngines}`);
      lines.push(`- **Duration**: ${(col.duration / 1000).toFixed(2)}s`);
      lines.push('');
    }

    if (data?.analysis) {
      const ana = data.analysis;
      lines.push('## Analysis Results');
      lines.push('');
      lines.push(`- **Total Queries**: ${ana.totalQueries}`);
      lines.push(`- **Total Results**: ${ana.totalResults}`);
      lines.push(`- **Unique Domains**: ${ana.uniqueDomains}`);
      lines.push('');
    }

    if (data?.rankings) {
      lines.push('## Top 20 Companies by Rank');
      lines.push('');
      lines.push('| Rank | Name | Domain | Type | Score | Engines |');
      lines.push('|------|------|--------|------|-------|---------|');
      data.rankings.slice(0, 20).forEach((rank, idx) => {
        lines.push(
          `| ${idx + 1} | ${rank.name} | ${rank.domain} | ${rank.type} | ${rank.score} | ${rank.engines.length} |`
        );
      });
      lines.push('');
    }

    if (data?.trends) {
      lines.push('## Top 10 Trends');
      lines.push('');
      lines.push('| Domain | Growth Rate | Trend |');
      lines.push('|--------|-------------|-------|');
      data.trends.slice(0, 10).forEach(trend => {
        const trendIcon = trend.trend === 'up' ? '📈' : trend.trend === 'down' ? '📉' : '➡️';
        lines.push(`| ${trend.domain} | ${trend.growthRate.toFixed(1)}% | ${trendIcon} ${trend.trend} |`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }

  return JSON.stringify(data, null, 2);
}

registerCommand({
  name: 'geo-analysis',
  description: 'GEO 数据采集和分析 - 支持多引擎采集、域名排名、企业排名和趋势分析',
  scope: 'global',
  parameters: z.object({
    keyword: z.string().describe('搜索关键词'),
    engines: z.array(z.string()).default(['kimi']).describe('AI 搜索引擎列表'),
    mode: z.enum(['collect', 'analyze', 'report', 'trend', 'rank']).default('collect').describe('执行模式'),
    timeframe: z.string().default('7d').describe('时间范围：7d/30d/90d'),
    output: z.enum(['json', 'markdown']).default('json').describe('输出格式'),
    cdpEndpoint: z.string().optional().describe('CDP endpoint URL'),
  }),
  handler: async (params, ctx) => {
    const storage = new DataStorage();
    await storage.initialize();

    const collector = new DataCollector({
      ...DEFAULT_COLLECTOR_CONFIG,
      engines: params.engines.length > 0 ? params.engines : DEFAULT_COLLECTOR_CONFIG.engines,
      cdpEndpoint: params.cdpEndpoint || ctx.cdpEndpoint,
    });

    const result: GeoAnalysisResult = {
      mode: params.mode,
      timestamp: Date.now(),
      keyword: params.keyword,
      timeframe: params.timeframe,
      engines: params.engines,
      data: {},
    };

    try {
      if (params.mode === 'collect') {
        console.log(`🔍 Starting collection for "${params.keyword}" with ${params.engines.length} engines...`);
        const collection = await collector.collectAll(params.keyword);
        result.data!.collection = collection;
        result.summary = {
          totalEngines: collection.totalEngines,
          successfulEngines: collection.successfulEngines,
          totalResults: collection.summary.totalResults,
          uniqueDomains: collection.summary.uniqueDomains,
          topDomains: [],
        };

        const allResults = collection.results
          .filter((r: CollectResult) => r.data)
          .map((r: CollectResult) => r.data as SearchResult);

        if (allResults.length > 0) {
          const analyzer = new ResultAnalyzer(allResults);
          const analysis = analyzer.analyzeAll();
          result.data!.analysis = analysis;

          result.summary!.topDomains = analysis.domainRankings.slice(0, 10).map(d => ({
            domain: d.domain,
            count: d.count,
            platform: d.platform,
          }));
        }

        console.log(`✅ Collection completed: ${collection.successfulEngines}/${collection.totalEngines} successful`);
      }

      if (params.mode === 'analyze' || params.mode === 'collect') {
        const history = await storage.loadAllHistory(100);
        if (history.length > 0) {
          const analyzer = new ResultAnalyzer(history);
          const analysis = analyzer.analyzeAll();
          result.data!.analysis = analysis;
          console.log(`📊 Analysis completed: ${analysis.uniqueDomains} unique domains found`);
        }
      }

      if (params.mode === 'rank') {
        const history = await storage.loadAllHistory(100);
        const rankings = await calculateCompanyRankings(history);
        result.data!.rankings = rankings;
        console.log(`🏆 Rankings calculated for ${rankings.length} companies`);
      }

      if (params.mode === 'trend') {
        const history = await storage.loadAllHistory(100);
        const trends = await analyzeTrends(history);
        result.data!.trends = trends;
        console.log(`📈 Trends analyzed for ${trends.length} domains`);
      }

      if (params.mode === 'report') {
        const history = await storage.loadAllHistory(100);
        const analyzer = new ResultAnalyzer(history);
        const analysis = analyzer.analyzeAll();
        const rankings = await calculateCompanyRankings(history);
        const trends = await analyzeTrends(history);

        result.data = {
          analysis,
          rankings,
          trends,
        };
      }

      const reportContent = await generateReport(params.mode, result.data, params.output);

      if (params.output === 'markdown') {
        const reportPath = './data/xbrowser-collection/reports';
        await storage['ensureDir'](reportPath);
        const filename = `geo-report-${Date.now()}.md`;
        const filepath = `${reportPath}/${filename}`;
        const fs = await import('fs/promises');
        await fs.writeFile(filepath, reportContent, 'utf-8');
        console.log(`📄 Report saved to: ${filepath}`);
        return ok({ report: filepath, content: reportContent });
      }

      return ok(result);
    } catch (error) {
      console.error(`❌ Error in geo-analysis:`, error);
      throw error;
    }
  },
});
