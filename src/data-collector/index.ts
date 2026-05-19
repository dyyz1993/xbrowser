export * from './types.js';
export * from './config.js';
export * from './storage.js';
export * from './analyzer.js';
export * from './collector.js';

export { DataCollector } from './collector.js';
export { DataStorage } from './storage.js';
export { ResultAnalyzer } from './analyzer.js';

export type {
  SearchResult,
  DomainStat,
  CompanyInfo,
  CollectResult,
  AnalysisResult,
  StorageConfig,
  CollectorConfig,
  BatchCollectResult,
} from './types.js';

export {
  DEFAULT_STORAGE_CONFIG,
  DEFAULT_COLLECTOR_CONFIG,
  PLATFORM_MAPPING,
  EXCLUDED_DOMAINS,
  getPlatformName,
  getCompanyType,
} from './config.js';