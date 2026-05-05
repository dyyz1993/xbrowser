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

export interface PluginListOptions {
  json?: boolean;
}
