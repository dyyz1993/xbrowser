import type { AISearchResult, DomainExtraction } from '../commands/ai-search-engines.js';

export interface SearchResult extends AISearchResult {
  id: string;
  collectedAt: number;
  engineInfo?: {
    name: string;
    loginStatus: string;
    internetSearch: { supported: boolean; enabled: boolean; details: string };
    uploadCapabilities: { image: boolean; file: boolean };
  };
}

export interface DomainStat extends DomainExtraction {
  firstSeen: string;
  lastSeen: string;
  trends: number[];
}

export interface CompanyInfo {
  name: string;
  domain: string;
  type: 'job-platform' | 'media' | 'gov' | 'ai-platform' | 'enterprise' | 'other';
  url?: string;
  description?: string;
}

export interface CollectResult {
  success: boolean;
  engine: string;
  query: string;
  data: SearchResult | null;
  errors?: string[];
  timestamp: number;
  duration: number;
}

export interface AnalysisResult {
  domainRankings: DomainStat[];
  topCompanies: CompanyInfo[];
  engineDistribution: Map<string, number>;
  queryHistory: string[];
  totalQueries: number;
  totalResults: number;
  uniqueDomains: number;
  generatedAt: number;
}

export interface StorageConfig {
  basePath: string;
  format: 'json' | 'sqlite' | 'csv' | 'markdown';
  autoBackup: boolean;
  maxHistoryDays: number;
}

export interface CollectorConfig {
  engines: string[];
  outputDir: string;
  format: 'json' | 'markdown' | 'csv' | 'sqlite';
  timeout: number;
  maxRetries: number;
  delayBetweenEngines: number;
  saveFullResponse: boolean;
  extractUrls: boolean;
  cdpEndpoint?: string;
}

export interface BatchCollectResult {
  totalEngines: number;
  successfulEngines: number;
  failedEngines: number;
  results: CollectResult[];
  summary: {
    totalResults: number;
    totalUrls: number;
    uniqueDomains: number;
    topEngines: { engine: string; count: number }[];
  };
  timestamp: number;
  duration: number;
}