import type { MarketplacePluginSearchResult, SearchOptions } from './types.js';
import { getConfigValue } from '../config.js';

const DEFAULT_MARKETPLACE_URL = 'https://xbrowser-marketplace.dyyz1993.workers.dev';

export class MarketplaceSearcher {
  private static getBaseUrl(): string {
    return (
      process.env.XBROWSER_MARKETPLACE_URL ||
      (getConfigValue('marketplaceUrl') as string) ||
      DEFAULT_MARKETPLACE_URL
    );
  }

  static async search(options: SearchOptions = {}): Promise<MarketplacePluginSearchResult[]> {
    const { query = '', tag, site, limit = 20 } = options;
    const baseUrl = this.getBaseUrl();

    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (tag) params.set('tag', tag);
    if (site) params.set('site', site);
    params.set('limit', String(limit));

    const url = `${baseUrl}/api/plugins/search?${params.toString()}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        success: boolean;
        data: {
          items: Array<Record<string, unknown>>;
          total: number;
        };
      };

      if (!data.success || !data.data?.items) {
        return [];
      }

      return data.data.items.map((item) => this.parseMarketplacePlugin(item));
    } catch {
      return [];
    }
  }

  static async getPluginDetail(slug: string): Promise<MarketplacePluginSearchResult | null> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/api/plugins/${slug}`;

    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const data = (await response.json()) as {
        success: boolean;
        data: Record<string, unknown>;
      };

      if (!data.success || !data.data) return null;
      return this.parseMarketplacePlugin(data.data);
    } catch {
      return null;
    }
  }

  private static parseMarketplacePlugin(item: Record<string, unknown>): MarketplacePluginSearchResult {
    return {
      source: 'marketplace',
      slug: String(item.slug || ''),
      name: String(item.name || ''),
      version: String(item.version || 'latest'),
      description: String(item.description || ''),
      author: String(item.authorName || 'Unknown'),
      homepage: typeof item.homepageUrl === 'string' ? item.homepageUrl : undefined,
      repository: typeof item.repositoryUrl === 'string' ? item.repositoryUrl : undefined,
      keywords: Array.isArray(item.tags) ? item.tags.map(String) : [],
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      sites: Array.isArray(item.siteUrls) ? item.siteUrls.map(String) : [],
      commands: Array.isArray(item.commands) ? item.commands.map(String) : [],
      downloads: typeof item.downloadCount === 'number' ? item.downloadCount : 0,
      license: typeof item.license === 'string' ? item.license : undefined,
    };
  }
}
