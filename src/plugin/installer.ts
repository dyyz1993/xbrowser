import {
  existsSync,
  readdirSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { resolve, basename, join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { readJsonFile } from '../utils/json-file.js';
import type { PluginListOptions } from './types.js';
import type { InstalledPlugin, InstallOptions } from './installer-types.js';
import { PluginMetadataParser } from './metadata-parser.js';
import { installFromLocal } from './install-sources/local.js';
import { installFromNpm } from './install-sources/npm.js';
import { installFromGit } from './install-sources/git.js';
import { installFromUrl } from './install-sources/url.js';
import { installFromMarketplace } from './install-sources/marketplace.js';
import { ensureProxyFetch } from '../utils/proxy-fetch.js';
import { getMarketplaceUrl } from './install-utils.js';
import { resolveNpmPackageWithFallback } from '../config.js';

export type { InstalledPlugin, InstallOptions } from './installer-types.js';

/**
 * Shared dependencies required by all xbrowser plugins.
 * These are installed in the plugins root directory (~/.xbrowser/plugins/)
 * so all plugins can resolve them via Node's module resolution.
 */
const SHARED_PLUGIN_DEPENDENCIES: Record<string, string> = {
  'zod': '^3.24.0',
  '@dyyz1993/xcli-core': '^0.9.2',
};

/**
 * Ensure the plugins directory has a node_modules with shared dependencies.
 * 
 * Strategy:
 * 1. If node_modules already exists with zod — nothing to do
 * 2. Otherwise, create/update package.json with shared deps, then npm install
 * 
 * This replaces the symlink hack — plugins get real dependency resolution.
 */
function ensurePluginDependencies(pluginsDir: string): void {
  // Quick check: if zod is already resolvable, we're done
  const zodPath = join(pluginsDir, 'node_modules', 'zod');
  if (existsSync(zodPath)) return;

  // Ensure plugins directory exists
  mkdirSync(pluginsDir, { recursive: true });

  // Create or update package.json with shared dependencies
  const pkgPath = join(pluginsDir, 'package.json');
  let pkg: Record<string, unknown> = {};
  if (existsSync(pkgPath)) {
    try { pkg = readJsonFile<Record<string, unknown>>(pkgPath, {}); } catch { /* ignore parse errors */ }
  }

  const existingDeps = (pkg.dependencies || {}) as Record<string, string>;
  let needsInstall = false;

  for (const [dep, version] of Object.entries(SHARED_PLUGIN_DEPENDENCIES)) {
    if (!existingDeps[dep]) {
      existingDeps[dep] = version;
      needsInstall = true;
    }
  }

  if (!needsInstall && existsSync(join(pluginsDir, 'node_modules'))) return;

  pkg.dependencies = existingDeps;
  pkg.private = true;
  pkg.description = pkg.description || 'xbrowser plugins — shared dependencies';
  
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

  // Run npm install in the plugins directory
  try {
    execSync('npm install --production --no-package-lock --no-fund --no-audit', {
      cwd: pluginsDir,
      stdio: 'pipe',  // suppress output
      timeout: 60_000, // 60s timeout
      env: { ...process.env, NODE_ENV: 'production' },
    });
  } catch (err) {
    // npm install failed — plugins may not load, but don't block the install
    console.warn(`⚠️  Failed to install shared plugin dependencies: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Manages installation, uninstallation, and listing of plugins.
 *
 * Supports local paths, npm packages, git repositories, and URL sources.
 */
export class PluginInstaller {
  private pluginsDir: string;

  constructor(pluginsDir?: string) {
    this.pluginsDir = pluginsDir || resolve(homedir(), '.xbrowser/plugins');
  }

  getPluginsDir(): string {
    return this.pluginsDir;
  }

  /**
   * Install a plugin from a local path, npm package, git repository, or URL.
   *
   * @param source - The plugin source (local path, npm name, git URL, or HTTP URL).
   * @param options - Install options including name override and force flag.
   * @returns Information about the installed plugin.
   * @throws If the plugin already exists without `force`, or if installation fails.
   */
  async install(source: string, options?: InstallOptions): Promise<InstalledPlugin> {
    const type = this.detectSourceType(source);
    const name = options?.name || this.deriveName(source, type);
    const targetDir = resolve(this.pluginsDir, name);

    if (existsSync(targetDir) && !options?.force) {
      throw new Error(`Plugin "${name}" already exists. Use --force to overwrite.`);
    }

    mkdirSync(targetDir, { recursive: true });

    const resolvedSource = type === 'npm' ? await resolveNpmPackageWithFallback(source) : source;

    switch (type) {
      case 'local':
        return await installFromLocal(source, name, targetDir).then(r => { ensurePluginDependencies(this.pluginsDir); return r; });
      case 'npm':
        return await installFromNpm(resolvedSource, name, targetDir).then(r => { ensurePluginDependencies(this.pluginsDir); return r; });
      case 'git':
        return await installFromGit(source, name, targetDir).then(r => { ensurePluginDependencies(this.pluginsDir); return r; });
      case 'url':
        return await installFromUrl(source, name, targetDir).then(r => { ensurePluginDependencies(this.pluginsDir); return r; });
    }
  }

  async installFromMarketplace(slug: string, options?: InstallOptions): Promise<InstalledPlugin> {
    const result = await installFromMarketplace(this.pluginsDir, slug, options);
    ensurePluginDependencies(this.pluginsDir);
    return result;
  }

  async installWithMarketplaceFallback(source: string, options?: InstallOptions): Promise<InstalledPlugin> {
    const type = this.detectSourceType(source);
    if (type !== 'npm') {
      return this.install(source, options);
    }
    try {
      await ensureProxyFetch();
      const baseUrl = getMarketplaceUrl();
      const detailUrl = `${baseUrl}/api/plugins/${source}`;
      const resp = await fetch(detailUrl);
      if (resp.ok) {
        const data = (await resp.json()) as { success?: boolean; data?: Record<string, unknown> };
        if (data.success !== false && data.data) {
          return this.installFromMarketplace(source, options);
        }
      }
    } catch {
      // marketplace unavailable, fallback to npm
    }
    return this.install(source, options);
  }

  /**
   * Uninstall a plugin by name.
   *
   * @param name - The plugin directory name to remove.
   * @throws If the plugin is not installed.
   */
  async uninstall(name: string): Promise<void> {
    const targetDir = resolve(this.pluginsDir, name);
    if (!existsSync(targetDir)) {
      throw new Error(`Plugin "${name}" not found`);
    }
    rmSync(targetDir, { recursive: true, force: true });
  }

  /**
   * List all installed plugins with metadata.
   *
   * @returns Array of installed plugin information.
   */
  async list(_options?: PluginListOptions): Promise<InstalledPlugin[]> {
    if (!existsSync(this.pluginsDir)) return [];

    const entries = readdirSync(this.pluginsDir, { withFileTypes: true });
    const plugins: InstalledPlugin[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginPath = resolve(this.pluginsDir, entry.name);
      const indexPath = resolve(pluginPath, 'index.ts');
      const indexJsPath = resolve(pluginPath, 'index.js');
      if (!existsSync(indexPath) && !existsSync(indexJsPath)) continue;

      const metadata = PluginMetadataParser.parseFromPackageJson(pluginPath);

      let source: InstalledPlugin['source'] = 'local';
      const pkg = readJsonFile<Record<string, unknown>>(resolve(pluginPath, 'package.json'), {});
      if (pkg._marketplace) source = 'marketplace';
      else if (pkg._npmSource) source = 'npm';
      else if (pkg._gitSource) source = 'git';
      else if (pkg._urlSource) source = 'url';

      plugins.push({
        id: entry.name,
        name: entry.name,
        path: pluginPath,
        source: metadata ? source : 'local',
        installedAt: '',
        metadata: metadata || undefined,
      });
    }

    return plugins;
  }

  private detectSourceType(source: string): 'local' | 'npm' | 'git' | 'url' {
    if (source.startsWith('http://') || source.startsWith('https://')) {
      if (source.includes('github.com/')) return 'git';
      if (source.endsWith('.git')) return 'git';
      return 'url';
    }
    if (source.startsWith('file://')) {
      const filePath = decodeURIComponent(new URL(source).pathname);
      if (existsSync(filePath)) return 'url';
    }
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
        let derived = parts[parts.length - 1] || 'plugin';
        derived = derived.replace(/\.(tar\.gz|tgz|tar|zip)$/, '');
        return derived;
      }
    }
  }
}
