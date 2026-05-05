export interface XBrowserPluginMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  homepage?: string;
  commands?: string[];
  sites?: string[];
  tags?: string[];
  screenshot?: string;
  license?: string;
}

export interface NPMPluginSearchResult {
  name: string;
  version: string;
  description: string;
  author?: { name: string } | string;
  homepage?: string;
  repository?: { url: string };
  keywords?: string[];
  links?: {
    npm: string;
    homepage?: string;
    repository?: string;
  };
  date: string;
  quality?: number;
  popularity?: number;
}

export interface SearchOptions {
  query?: string;
  tag?: string;
  site?: string;
  limit?: number;
}

export interface MarketplacePluginSearchResult {
  source: 'marketplace';
  slug: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
  tags?: string[];
  sites?: string[];
  commands?: string[];
  downloads: number;
  license?: string;
}

export type PluginSearchResult = NPMPluginSearchResult | MarketplacePluginSearchResult;

export interface PluginListOptions {
  json?: boolean;
}
