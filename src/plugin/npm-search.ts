import type { NPMPluginSearchResult, SearchOptions } from './types.js';
import { NPM_REGISTRY_URL } from '../config.js';

export class NPMSearcher {
  static async search(options: SearchOptions = {}): Promise<NPMPluginSearchResult[]> {
    const { query = '', tag, site, limit = 20 } = options;

    const npmQuery = this.buildQuery(query, tag, site);
    const url = `${NPM_REGISTRY_URL}/-/v1/search?text=${encodeURIComponent(npmQuery)}&size=${limit}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`NPM search failed: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        objects: Array<{ package: Record<string, unknown> }>;
      };
      const results = data.objects.map((obj) => this.parseNPMPackage(obj.package));

      return results;
    } catch (e) {
      if (e instanceof Error) {
        throw new Error(`Failed to search npm: ${e.message}`);
      }
      throw new Error('Failed to search npm: Unknown error');
    }
  }

  private static buildQuery(query: string, tag?: string, site?: string): string {
    const parts: string[] = [];

    if (query) {
      parts.push(query);
    }

    parts.push('keywords:xbrowser-plugin');
    parts.push('keywords:xbrowser');

    if (tag) {
      parts.push(`keywords:${tag}`);
    }

    if (site) {
      parts.push(`keywords:${site}`);
    }

    return parts.join(' ');
  }

  private static parseNPMPackage(pkg: unknown): NPMPluginSearchResult {
    const data = pkg as Record<string, unknown>;

    const author = this.parseAuthor(data.author);
    const links = this.parseLinks(data);

    const time = data.time as { modified?: string } | undefined;
    const score = data.score as { detail?: { quality?: number; popularity?: number } } | undefined;

    return {
      name: String(data.name || ''),
      version: String(data.version || 'latest'),
      description: String(data.description || ''),
      author,
      homepage: typeof data.homepage === 'string' ? data.homepage : undefined,
      repository: this.parseRepository(data.repository),
      keywords: this.parseKeywords(data.keywords),
      links,
      date: String(data.date || time?.modified || ''),
      quality: typeof score?.detail?.quality === 'number' ? score.detail.quality : undefined,
      popularity: typeof score?.detail?.popularity === 'number' ? score.detail.popularity : undefined,
    };
  }

  private static parseAuthor(author: unknown): { name: string } | string {
    if (typeof author === 'string') return author;
    if (typeof author === 'object' && author !== null) {
      const authorObj = author as { name?: string; email?: string };
      return { name: authorObj.name || 'Unknown' };
    }
    return 'Unknown';
  }

  private static parseLinks(data: Record<string, unknown>): NPMPluginSearchResult['links'] {
    const npm = String(data.name || '');
    const homepage = typeof data.homepage === 'string' ? data.homepage : undefined;
    const repository = this.parseRepository(data.repository);

    return {
      npm: `https://www.npmjs.com/package/${npm}`,
      homepage,
      repository: repository?.url,
    };
  }

  private static parseRepository(repo: unknown): { url: string } | undefined {
    if (typeof repo === 'string') return { url: repo };
    if (typeof repo === 'object' && repo !== null) {
      const repoObj = repo as { url?: string };
      if (repoObj.url) return { url: repoObj.url };
    }
    return undefined;
  }

  private static parseKeywords(keywords: unknown): string[] {
    if (Array.isArray(keywords)) {
      return keywords.map(String).filter(Boolean);
    }
    return [];
  }

  static async getPackageManifest(name: string): Promise<Record<string, unknown>> {
    const url = `${NPM_REGISTRY_URL}/${name}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch package manifest: ${response.statusText}`);
      }

      return (await response.json()) as Record<string, unknown>;
    } catch (e) {
      if (e instanceof Error) {
        throw new Error(`Failed to fetch package manifest: ${e.message}`);
      }
      throw new Error('Failed to fetch package manifest: Unknown error');
    }
  }
}
