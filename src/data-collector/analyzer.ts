import type { SearchResult, AnalysisResult, DomainStat, CompanyInfo } from './types.js';
import { getPlatformName, getCompanyType, EXCLUDED_DOMAINS } from './config.js';

export class ResultAnalyzer {
  private results: SearchResult[];

  constructor(results: SearchResult[]) {
    this.results = results;
  }

  analyzeAll(): AnalysisResult {
    const domainRankings = this.analyzeDomainRankings();
    const topCompanies = this.identifyCompanies();
    const engineDistribution = this.calculateEngineDistribution();
    const queryHistory = this.getQueryHistory();
    const totalResults = this.calculateTotalResults();
    const uniqueDomains = new Set<string>();
    
    this.results.forEach(result => {
      if (result.domainExtraction) {
        result.domainExtraction.domains.forEach(domain => {
          uniqueDomains.add(domain.domain);
        });
      }
    });

    return {
      domainRankings,
      topCompanies,
      engineDistribution,
      queryHistory,
      totalQueries: queryHistory.length,
      totalResults,
      uniqueDomains: uniqueDomains.size,
      generatedAt: Date.now(),
    };
  }

  analyzeDomainRankings(): DomainStat[] {
    const domainMap = new Map<string, {
      domain: string;
      count: number;
      urls: string[];
      platform?: string;
      firstSeen: string;
      lastSeen: string;
      trends: number[];
    }>();

    this.results.forEach(result => {
      if (!result.domainExtraction) return;

      result.domainExtraction.domains.forEach(domainData => {
        const domain = domainData.domain;
        
        if (!domainMap.has(domain)) {
          domainMap.set(domain, {
            domain,
            count: 0,
            urls: [],
            platform: getPlatformName(domain),
            firstSeen: new Date(result.timestamp).toISOString(),
            lastSeen: new Date(result.timestamp).toISOString(),
            trends: [],
          });
        }

        const entry = domainMap.get(domain)!;
        entry.count += domainData.count;
        entry.urls.push(...domainData.urls);
        
        const timestamp = new Date(result.timestamp).toISOString();
        if (timestamp < entry.firstSeen) {
          entry.firstSeen = timestamp;
        }
        if (timestamp > entry.lastSeen) {
          entry.lastSeen = timestamp;
        }
        
        entry.trends.push(domainData.count);
      });
    });

    const sortedDomains = Array.from(domainMap.values())
      .filter(d => !EXCLUDED_DOMAINS.has(d.domain))
      .sort((a, b) => b.count - a.count);

    return sortedDomains.slice(0, 100);
  }

  identifyCompanies(): CompanyInfo[] {
    const companyMap = new Map<string, CompanyInfo>();

    this.results.forEach(result => {
      if (!result.domainExtraction) return;

      result.domainExtraction.domains.forEach(domainData => {
        const domain = domainData.domain;
        const platformName = getPlatformName(domain);
        
        if (!companyMap.has(domain)) {
          const name = platformName || domain;
          const type = getCompanyType(domain);
          
          companyMap.set(domain, {
            name,
            domain,
            type,
            url: domainData.urls[0],
          });
        }

        const company = companyMap.get(domain)!;
        if (!company.description) {
          company.description = `Found in ${result.engine} search for "${result.query}"`;
        }
      });
    });

    const sortedCompanies = Array.from(companyMap.values())
      .sort((a, b) => a.domain.localeCompare(b.domain));

    return sortedCompanies;
  }

  calculateEngineDistribution(): Map<string, number> {
    const distribution = new Map<string, number>();

    this.results.forEach(result => {
      const count = distribution.get(result.engine) || 0;
      distribution.set(result.engine, count + 1);
    });

    return distribution;
  }

  getQueryHistory(): string[] {
    const querySet = new Set<string>();
    
    this.results.forEach(result => {
      querySet.add(result.query);
    });

    return Array.from(querySet);
  }

  calculateTotalResults(): number {
    return this.results.reduce((sum, result) => sum + result.total, 0);
  }

  calculateEngagementScores(): Map<string, number> {
    const engagementScores = new Map<string, number>();

    this.results.forEach(result => {
      if (!result.domainExtraction) return;

      result.domainExtraction.domains.forEach(domainData => {
        const domain = domainData.domain;
        const currentScore = engagementScores.get(domain) || 0;
        engagementScores.set(domain, currentScore + domainData.count);
      });
    });

    return engagementScores;
  }

  generateReport(analysis: AnalysisResult): string {
    const lines: string[] = [
      '# AI Search Results Analysis Report',
      '',
      `Generated: ${new Date(analysis.generatedAt).toLocaleString('zh-CN')}`,
      '',
      '## Summary',
      '',
      `- **Total Queries**: ${analysis.totalQueries}`,
      `- **Total Results**: ${analysis.totalResults}`,
      `- **Unique Domains**: ${analysis.uniqueDomains}`,
      `- **Engines Used**: ${analysis.engineDistribution.size}`,
      '',
      '---',
      '',
    ];

    lines.push('## Query History');
    lines.push('');
    analysis.queryHistory.forEach((query, index) => {
      lines.push(`${index + 1}. ${query}`);
    });
    lines.push('');

    lines.push('## Engine Distribution');
    lines.push('');
    lines.push('| Engine | Count | Percentage |');
    lines.push('|--------|-------|------------|');
    
    const totalEngineQueries = Array.from(analysis.engineDistribution.values())
      .reduce((sum, count) => sum + count, 0);
    
    Array.from(analysis.engineDistribution.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([engine, count]) => {
        const percentage = ((count / totalEngineQueries) * 100).toFixed(1);
        lines.push(`| ${engine} | ${count} | ${percentage}% |`);
      });
    lines.push('');

    lines.push('## Top 20 Domains');
    lines.push('');
    lines.push('| Rank | Domain | Platform | Count | First Seen | Last Seen |');
    lines.push('|------|--------|----------|-------|------------|-----------|');
    
    analysis.domainRankings.slice(0, 20).forEach((domain, index) => {
      const firstSeen = new Date(domain.firstSeen).toLocaleDateString('zh-CN');
      const lastSeen = new Date(domain.lastSeen).toLocaleDateString('zh-CN');
      const platform = domain.platform || '-';
      lines.push(`| ${index + 1} | ${domain.domain} | ${platform} | ${domain.count} | ${firstSeen} | ${lastSeen} |`);
    });
    lines.push('');

    lines.push('## Company Classification');
    lines.push('');
    const companiesByType = new Map<string, CompanyInfo[]>();
    analysis.topCompanies.forEach(company => {
      const type = company.type;
      if (!companiesByType.has(type)) {
        companiesByType.set(type, []);
      }
      companiesByType.get(type)!.push(company);
    });

    const typeLabels: Record<string, string> = {
      'job-platform': 'Job Platforms',
      'media': 'Media',
      'gov': 'Government',
      'ai-platform': 'AI Platforms',
      'enterprise': 'Enterprise',
      'other': 'Other',
    };

    Array.from(companiesByType.entries()).forEach(([type, companies]) => {
      lines.push(`### ${typeLabels[type] || type} (${companies.length})`);
      lines.push('');
      companies.slice(0, 10).forEach((company, index) => {
        lines.push(`${index + 1}. **${company.name}** (${company.domain})`);
        if (company.description) {
          lines.push(`   ${company.description}`);
        }
      });
      lines.push('');
    });

    lines.push('---');
    lines.push('');
    lines.push('_End of Report_');

    return lines.join('\n');
  }

  filterByEngine(engine: string): SearchResult[] {
    return this.results.filter(r => r.engine === engine);
  }

  filterByQuery(query: string): SearchResult[] {
    return this.results.filter(r => r.query === query);
  }

  filterByDateRange(startDate: Date, endDate: Date): SearchResult[] {
    const start = startDate.getTime();
    const end = endDate.getTime();
    
    return this.results.filter(r => {
      const timestamp = r.timestamp;
      return timestamp >= start && timestamp <= end;
    });
  }

  getDomainTrends(domain: string): number[] {
    const trends: number[] = [];
    
    this.results.forEach(result => {
      if (!result.domainExtraction) return;
      
      const domainData = result.domainExtraction.domains.find(d => d.domain === domain);
      if (domainData) {
        trends.push(domainData.count);
      }
    });
    
    return trends;
  }

  compareEngines(engine1: string, engine2: string): {
    engine1: { count: number; avgResults: number };
    engine2: { count: number; avgResults: number };
  } {
    const results1 = this.filterByEngine(engine1);
    const results2 = this.filterByEngine(engine2);

    const avgResults1 = results1.length > 0 
      ? results1.reduce((sum, r) => sum + r.total, 0) / results1.length 
      : 0;
    
    const avgResults2 = results2.length > 0 
      ? results2.reduce((sum, r) => sum + r.total, 0) / results2.length 
      : 0;

    return {
      engine1: {
        count: results1.length,
        avgResults: Math.round(avgResults1 * 100) / 100,
      },
      engine2: {
        count: results2.length,
        avgResults: Math.round(avgResults2 * 100) / 100,
      },
    };
  }
}