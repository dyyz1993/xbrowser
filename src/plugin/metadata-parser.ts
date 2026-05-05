import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { XBrowserPluginMetadata, NPMPluginSearchResult } from './types.js';

export class PluginMetadataParser {
  private static readonly XBROWSER_KEYWORDS = ['xbrowser', 'xbrowser-plugin'];

  static parseFromPackageJson(pluginPath: string): XBrowserPluginMetadata | null {
    const packageJsonPath = resolve(pluginPath, 'package.json');

    if (!existsSync(packageJsonPath)) {
      return null;
    }

    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

      if (!packageJson.xbrowser) {
        return null;
      }

      const metadata: XBrowserPluginMetadata = {
        id: packageJson.xbrowser.id || packageJson.name,
        name: packageJson.xbrowser.name || packageJson.name,
        description: packageJson.xbrowser.description || packageJson.description || '',
        version: packageJson.xbrowser.version || packageJson.version || '1.0.0',
        author: packageJson.xbrowser.author || this.extractAuthor(packageJson.author),
        homepage: packageJson.xbrowser.homepage || packageJson.homepage,
        commands: packageJson.xbrowser.commands,
        sites: packageJson.xbrowser.sites,
        tags: packageJson.xbrowser.tags,
        screenshot: packageJson.xbrowser.screenshot,
        license: packageJson.xbrowser.license || packageJson.license,
      };

      return metadata;
    } catch {
      return null;
    }
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
