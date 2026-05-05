import { existsSync, readdirSync, cpSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, basename } from 'path';
import { homedir } from 'os';
import type { XBrowserPluginMetadata, PluginListOptions } from './types.js';
import { PluginMetadataParser } from './metadata-parser.js';

export interface InstalledPlugin {
  id: string;
  name: string;
  path: string;
  source: 'local' | 'npm' | 'git' | 'url' | 'builtin';
  installedAt: string;
  metadata?: XBrowserPluginMetadata;
}

export interface InstallOptions {
  name?: string;
  force?: boolean;
}

export class PluginInstaller {
  private pluginsDir: string;

  constructor(pluginsDir?: string) {
    this.pluginsDir = pluginsDir || resolve(homedir(), '.xbrowser/plugins');
  }

  getPluginsDir(): string {
    return this.pluginsDir;
  }

  async install(source: string, options?: InstallOptions): Promise<InstalledPlugin> {
    const type = this.detectSourceType(source);
    const name = options?.name || this.deriveName(source, type);
    const targetDir = resolve(this.pluginsDir, name);

    if (existsSync(targetDir) && !options?.force) {
      throw new Error(`Plugin "${name}" already exists. Use --force to overwrite.`);
    }

    mkdirSync(targetDir, { recursive: true });

    switch (type) {
      case 'local':
        cpSync(resolve(source), targetDir, { recursive: true });
        break;
      case 'npm':
        writeFileSync(
          resolve(targetDir, 'package.json'),
          JSON.stringify({ name, version: '1.0.0', dependencies: { [source]: 'latest' } }, null, 2)
        );
        break;
      case 'git':
        writeFileSync(
          resolve(targetDir, 'package.json'),
          JSON.stringify({ name, version: '1.0.0', repository: source }, null, 2)
        );
        break;
      case 'url':
        writeFileSync(
          resolve(targetDir, 'package.json'),
          JSON.stringify({ name, version: '1.0.0', sourceUrl: source }, null, 2)
        );
        break;
    }

    if (!existsSync(resolve(targetDir, 'index.ts'))) {
      writeFileSync(
        resolve(targetDir, 'index.ts'),
        [
          `import type { XCLIAPI } from '@dyyz1993/xcli-core';`,
          ``,
          `export default function (xcli: XCLIAPI): void {`,
          `  const site = xcli.createSite({`,
          `    name: '${name}',`,
          `  });`,
          ``,
          `  site.command('hello', {`,
          `    description: 'Hello from ${name}',`,
          `    scope: 'project',`,
          `    parameters: z.object({}),`,
          `    handler: async (_params, _ctx) => ({ ok: true, message: 'Hello from ${name}!' }),`,
          `  });`,
          `}`,
        ].join('\n')
      );
    }

    return {
      id: name,
      name,
      path: targetDir,
      source: type,
      installedAt: new Date().toISOString(),
    };
  }

  async uninstall(name: string): Promise<void> {
    const targetDir = resolve(this.pluginsDir, name);
    if (!existsSync(targetDir)) {
      throw new Error(`Plugin "${name}" not found`);
    }
    rmSync(targetDir, { recursive: true, force: true });
  }

  async list(_options?: PluginListOptions): Promise<InstalledPlugin[]> {
    if (!existsSync(this.pluginsDir)) return [];

    const entries = readdirSync(this.pluginsDir, { withFileTypes: true });
    const plugins: InstalledPlugin[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginPath = resolve(this.pluginsDir, entry.name);
      const indexPath = resolve(pluginPath, 'index.ts');
      if (!existsSync(indexPath)) continue;

      const metadata = PluginMetadataParser.parseFromPackageJson(pluginPath);

      plugins.push({
        id: entry.name,
        name: entry.name,
        path: pluginPath,
        source: metadata ? 'npm' : 'local',
        installedAt: '',
        metadata: metadata || undefined,
      });
    }

    return plugins;
  }

  private detectSourceType(source: string): 'local' | 'npm' | 'git' | 'url' {
    if (source.startsWith('http://') || source.startsWith('https://')) return 'url';
    if (source.endsWith('.git') || source.includes('github.com/')) return 'git';
    if (existsSync(resolve(source))) return 'local';
    return 'npm';
  }

  private deriveName(source: string, type: 'local' | 'npm' | 'git' | 'url'): string {
    switch (type) {
      case 'local':
        return basename(source);
      case 'npm':
        return source.replace(/^@[^/]+\//, '');
      case 'git': {
        const base = basename(source, '.git');
        return base;
      }
      case 'url': {
        const parts = new URL(source).pathname.split('/');
        return parts[parts.length - 1] || 'plugin';
      }
    }
  }
}
