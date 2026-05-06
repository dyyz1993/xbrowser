import { existsSync } from 'fs';
import { resolve } from 'path';
import type { XBrowserPluginMetadata, NPMPluginSearchResult } from './types.js';
import { readJsonFile } from '../utils/json-file.js';

export class PluginMetadataParser {
  private static readonly XBROWSER_KEYWORDS = ['xbrowser', 'xbrowser-plugin'];

  static parseFromPackageJson(pluginPath: string): XBrowserPluginMetadata | null {
    const packageJsonPath = resolve(pluginPath, 'package.json');

    if (!existsSync(packageJsonPath)) {
      return null;
    }

    const packageJson = readJsonFile<Record<string, unknown> | null>(packageJsonPath, null);
    if (!packageJson) return null;

    if (!packageJson.xbrowser) {
      return null;
    }

    const xbrowser = packageJson.xbrowser as Record<string, unknown>;
    const metadata: XBrowserPluginMetadata = {
      id: (xbrowser.id as string) || (packageJson.name as string),
      name: (xbrowser.name as string) || (packageJson.name as string),
      description: (xbrowser.description as string) || (packageJson.description as string) || '',
      version: (xbrowser.version as string) || (packageJson.version as string) || '1.0.0',
      author: (xbrowser.author as string) || this.extractAuthor(packageJson.author),
      homepage: (xbrowser.homepage as string) || (packageJson.homepage as string),
      commands: xbrowser.commands as string[] | undefined,
      sites: xbrowser.sites as string[] | undefined,
      tags: xbrowser.tags as string[] | undefined,
      screenshot: xbrowser.screenshot as string | undefined,
      license: (xbrowser.license as string) || (packageJson.license as string),
    };

    return metadata;
  }

  static isXBrowserPlugin(packageJson: Record<string, unknown>): boolean {
    if (packageJson.xbrowser) {
      return true;
    }

    const keywords = packageJson.keywords as string[] | undefined;
    if (!keywords) return false;

    return this.XBROWSER_KEYWORDS.some((kw) => keywords.includes(kw));
  }

  static fromNPMResult(result: NPMPluginSearchResult): XBrowserPluginMetadata | null {
    const author = typeof result.author === 'string' ? result.author : result.author?.name || 'Unknown';

    return {
      id: result.name,
      name: result.name.replace(/^xbrowser-plugin-/, '').replace(/^@[^/]+\//, ''),
      description: result.description || '',
      version: result.version,
      author,
      homepage: result.homepage || result.links?.homepage,
      tags: result.keywords,
      license: '',
    };
  }

  static extractAuthor(author: unknown): string {
    if (typeof author === 'string') return author;
    if (typeof author === 'object' && author !== null) {
      const authorObj = author as { name?: string; email?: string };
      return authorObj.name || 'Unknown';
    }
    return 'Unknown';
  }

  static validateMetadata(metadata: XBrowserPluginMetadata): string[] {
    const errors: string[] = [];

    if (!metadata.id) errors.push('id is required');
    if (!metadata.name) errors.push('name is required');
    if (!metadata.description) errors.push('description is required');
    if (!metadata.version) errors.push('version is required');

    return errors;
  }
}
