import {
  existsSync,
  readdirSync,
  cpSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  createWriteStream,
} from 'fs';
import { resolve, basename, join } from 'path';
import { homedir, tmpdir } from 'os';
import { execSync } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import type { XBrowserPluginMetadata, PluginListOptions } from './types.js';
import { PluginMetadataParser } from './metadata-parser.js';
import { getConfigValue } from '../config.js';

const DEFAULT_MARKETPLACE_URL = 'https://xbrowser-marketplace.dyyz1993.workers.dev';

export interface InstalledPlugin {
  id: string;
  name: string;
  path: string;
  source: 'local' | 'npm' | 'git' | 'url' | 'builtin' | 'marketplace';
  installedAt: string;
  metadata?: XBrowserPluginMetadata;
  warnings?: string[];
}

export interface InstallOptions {
  name?: string;
  force?: boolean;
}

interface PluginVerifyResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  }
  if (!res.body) {
    throw new Error(`No response body from ${url}`);
  }
  const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream);
  await pipeline(nodeStream, createWriteStream(destPath));
}

function extractTarGz(tarballPath: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  execSync(`tar -xzf "${tarballPath}" -C "${targetDir}"`, { stdio: 'pipe' });
}

function flattenPackageRoot(targetDir: string): void {
  const entries = readdirSync(targetDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 1 && dirs[0].name === 'package') {
    const pkgDir = resolve(targetDir, 'package');
    const items = readdirSync(pkgDir);
    for (const item of items) {
      const src = resolve(pkgDir, item);
      const dst = resolve(targetDir, item);
      cpSync(src, dst, { recursive: true, force: true });
    }
    rmSync(pkgDir, { recursive: true, force: true });
  }
}

async function verifyPlugin(dir: string): Promise<PluginVerifyResult> {
  const warnings: string[] = [];

  const indexPath = resolve(dir, 'index.ts');
  if (!existsSync(indexPath)) {
    const indexJs = resolve(dir, 'index.js');
    if (!existsSync(indexJs)) {
      return { valid: false, error: 'No index.ts or index.js entry point found', warnings };
    }
  }

  const pkgPath = resolve(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    warnings.push('No package.json found');
  } else {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (!pkg.xbrowser) {
        warnings.push('No xbrowser metadata in package.json');
      }
    } catch {
      warnings.push('Invalid package.json');
    }
  }

  return { valid: true, warnings };
}

function getMarketplaceUrl(): string {
  return (
    process.env.XBROWSER_MARKETPLACE_URL ||
    (getConfigValue('marketplaceUrl') as string) ||
    DEFAULT_MARKETPLACE_URL
  );
}

function safeCleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
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
        return this.installFromLocal(source, name, targetDir);
      case 'npm':
        return this.installFromNpm(source, name, targetDir);
      case 'git':
        return this.installFromGit(source, name, targetDir);
      case 'url':
        return this.installFromUrl(source, name, targetDir);
    }
  }

  private async installFromLocal(
    source: string,
    name: string,
    targetDir: string
  ): Promise<InstalledPlugin> {
    const srcPath = resolve(source);
    if (!existsSync(srcPath)) {
      throw new Error(`Local path does not exist: ${srcPath}`);
    }

    const tmpTarget = `${targetDir}-tmp-${Date.now()}`;
    let warnings: string[] = [];
    try {
      cpSync(srcPath, tmpTarget, { recursive: true });

      const verify = await verifyPlugin(tmpTarget);
      warnings = verify.warnings ?? [];
      if (!verify.valid) {
        safeCleanup(tmpTarget);
        throw new Error(`Invalid plugin: ${verify.error}`);
      }

      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
      cpSync(tmpTarget, targetDir, { recursive: true, force: true });
      safeCleanup(tmpTarget);
    } catch (err) {
      safeCleanup(tmpTarget);
      throw err;
    }

    return {
      id: name,
      name,
      path: targetDir,
      source: 'local',
      installedAt: new Date().toISOString(),
      warnings,
    };
  }

  private async installFromNpm(
    packageName: string,
    name: string,
    targetDir: string
  ): Promise<InstalledPlugin> {
    const encodedName = encodeURIComponent(packageName);
    const metaRes = await fetch(`https://registry.npmjs.org/${encodedName}`);
    if (!metaRes.ok) {
      throw new Error(`Package "${packageName}" not found on npm (HTTP ${metaRes.status})`);
    }

    const meta = (await metaRes.json()) as {
      'dist-tags': Record<string, string>;
      versions: Record<string, { dist: { tarball: string }; main?: string }>;
    };

    const latestVersion = meta['dist-tags']?.latest;
    if (!latestVersion) {
      throw new Error(`No stable version found for "${packageName}"`);
    }

    const versionMeta = meta.versions[latestVersion];
    if (!versionMeta?.dist?.tarball) {
      throw new Error(`No tarball URL for ${packageName}@${latestVersion}`);
    }

    const tarballUrl = versionMeta.dist.tarball;
    const tmpDir = join(tmpdir(), `xbrowser-npm-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    let warnings: string[] = [];
    try {
      const tarballPath = join(tmpDir, `${name}.tgz`);
      await downloadToFile(tarballUrl, tarballPath);

      const extractDir = join(tmpDir, 'extracted');
      extractTarGz(tarballPath, extractDir);
      flattenPackageRoot(extractDir);

      const verify = await verifyPlugin(extractDir);
      warnings = verify.warnings ?? [];
      if (!verify.valid) {
        throw new Error(`Invalid npm plugin: ${verify.error}`);
      }

      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
      cpSync(extractDir, targetDir, { recursive: true, force: true });

      const pkgPath = resolve(targetDir, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (!pkg._npmSource) {
          pkg._npmSource = { name: packageName, version: latestVersion };
          writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
        }
      }
    } finally {
      safeCleanup(tmpDir);
    }

    return {
      id: name,
      name,
      path: targetDir,
      source: 'npm',
      installedAt: new Date().toISOString(),
      warnings,
    };
  }

  private async installFromGit(
    gitUrl: string,
    name: string,
    targetDir: string
  ): Promise<InstalledPlugin> {
    const tmpDir = join(tmpdir(), `xbrowser-git-${Date.now()}`);

    let warnings: string[] = [];
    try {
      execSync(`git clone --depth 1 "${gitUrl}" "${tmpDir}"`, { stdio: 'pipe' });

      const verify = await verifyPlugin(tmpDir);
      warnings = verify.warnings ?? [];
      if (!verify.valid) {
        throw new Error(`Invalid git plugin: ${verify.error}`);
      }

      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
      cpSync(tmpDir, targetDir, { recursive: true, force: true });

      rmSync(resolve(targetDir, '.git'), { recursive: true, force: true });

      const pkgPath = resolve(targetDir, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (!pkg._gitSource) {
          pkg._gitSource = { url: gitUrl };
          writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
        }
      }
    } finally {
      safeCleanup(tmpDir);
    }

    return {
      id: name,
      name,
      path: targetDir,
      source: 'git',
      installedAt: new Date().toISOString(),
      warnings,
    };
  }

  private async installFromUrl(
    url: string,
    name: string,
    targetDir: string
  ): Promise<InstalledPlugin> {
    const tmpDir = join(tmpdir(), `xbrowser-url-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    let warnings: string[] = [];
    try {
      const fileName = basename(new URL(url).pathname) || 'plugin.tar.gz';
      const tarballPath = join(tmpDir, fileName);
      await downloadToFile(url, tarballPath);

      const extractDir = join(tmpDir, 'extracted');
      extractTarGz(tarballPath, extractDir);
      flattenPackageRoot(extractDir);

      const verify = await verifyPlugin(extractDir);
      warnings = verify.warnings ?? [];
      if (!verify.valid) {
        throw new Error(`Invalid plugin from URL: ${verify.error}`);
      }

      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
      cpSync(extractDir, targetDir, { recursive: true, force: true });

      const pkgPath = resolve(targetDir, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (!pkg._urlSource) {
          pkg._urlSource = { url };
          writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
        }
      }
    } finally {
      safeCleanup(tmpDir);
    }

    return {
      id: name,
      name,
      path: targetDir,
      source: 'url',
      installedAt: new Date().toISOString(),
      warnings,
    };
  }

  async installFromMarketplace(slug: string, options?: InstallOptions): Promise<InstalledPlugin> {
    const baseUrl = getMarketplaceUrl();

    const detailUrl = `${baseUrl}/api/plugins/${slug}`;
    const detailResponse = await fetch(detailUrl);

    if (!detailResponse.ok) {
      throw new Error(`Plugin "${slug}" not found on marketplace (HTTP ${detailResponse.status})`);
    }

    const detailData = (await detailResponse.json()) as {
      success: boolean;
      data: Record<string, unknown>;
    };

    if (!detailData.success || !detailData.data) {
      throw new Error(`Failed to fetch plugin details for "${slug}"`);
    }

    const plugin = detailData.data;
    const name = (options?.name || String(plugin.slug || slug)) as string;
    const targetDir = resolve(this.pluginsDir, name);

    if (existsSync(targetDir) && !options?.force) {
      throw new Error(`Plugin "${name}" already exists. Use --force to overwrite.`);
    }

    mkdirSync(targetDir, { recursive: true });

    const tmpDir = join(tmpdir(), `xbrowser-marketplace-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const tarballUrl = `${baseUrl}/api/plugins/${slug}/tarball`;
      const tarballRes = await fetch(tarballUrl, { redirect: 'manual' });

      if (!tarballRes.ok) {
        throw new Error(
          `Failed to get tarball for "${slug}" (HTTP ${tarballRes.status})`
        );
      }

      if (tarballRes.status === 302 || tarballRes.headers.get('location')) {
        const redirectUrl = tarballRes.headers.get('location')!;
        const tarballPath = join(tmpDir, `${slug}.tar.gz`);
        await downloadToFile(redirectUrl, tarballPath);

        const extractDir = join(tmpDir, 'extracted');
        extractTarGz(tarballPath, extractDir);
        flattenPackageRoot(extractDir);

        if (existsSync(targetDir)) {
          rmSync(targetDir, { recursive: true, force: true });
        }
        cpSync(extractDir, targetDir, { recursive: true, force: true });
      } else {
        const contentType = tarballRes.headers.get('content-type') || '';

        if (
          contentType.includes('application/gzip') ||
          contentType.includes('application/x-tar') ||
          contentType.includes('application/octet-stream') ||
          contentType.includes('application/x-gzip')
        ) {
          const buffer = Buffer.from(await tarballRes.arrayBuffer());
          const tarballPath = join(tmpDir, `${slug}.tar.gz`);
          writeFileSync(tarballPath, buffer);

          const extractDir = join(tmpDir, 'extracted');
          extractTarGz(tarballPath, extractDir);
          flattenPackageRoot(extractDir);

          if (existsSync(targetDir)) {
            rmSync(targetDir, { recursive: true, force: true });
          }
          cpSync(extractDir, targetDir, { recursive: true, force: true });
        } else {
          const tarballData = (await tarballRes.json()) as {
            success: boolean;
            data: { url: string };
          };

          if (tarballData.data?.url?.startsWith('http')) {
            const tarballPath = join(tmpDir, `${slug}.tar.gz`);
            await downloadToFile(tarballData.data.url, tarballPath);

            const extractDir = join(tmpDir, 'extracted');
            extractTarGz(tarballPath, extractDir);
            flattenPackageRoot(extractDir);

            if (existsSync(targetDir)) {
              rmSync(targetDir, { recursive: true, force: true });
            }
            cpSync(extractDir, targetDir, { recursive: true, force: true });
          }
        }
      }
    } finally {
      safeCleanup(tmpDir);
    }

    const verify = await verifyPlugin(targetDir);
    if (!verify.valid) {
      safeCleanup(targetDir);
      throw new Error(`Invalid marketplace plugin: ${verify.error}`);
    }

    const packageJson = {
      name,
      version: String(plugin.version || '1.0.0'),
      description: String(plugin.description || ''),
      author: String(plugin.authorName || 'Unknown'),
      license: String(plugin.license || 'MIT'),
      homepage: plugin.homepageUrl || undefined,
      repository: plugin.repositoryUrl ? { url: plugin.repositoryUrl } : undefined,
      xbrowser: {
        slug: String(plugin.slug || slug),
        name: String(plugin.name || name),
        description: String(plugin.description || ''),
        version: String(plugin.version || '1.0.0'),
        author: String(plugin.authorName || 'Unknown'),
        commands: plugin.commands || [],
        tags: plugin.tags || [],
        sites: plugin.siteUrls || [],
      },
      _marketplace: {
        slug: String(plugin.slug || slug),
        url: baseUrl,
      },
    };

    const pkgPath = resolve(targetDir, 'package.json');
    if (!existsSync(pkgPath)) {
      writeFileSync(pkgPath, JSON.stringify(packageJson, null, 2));
    } else {
      try {
        const existing = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const merged = {
          ...existing,
          xbrowser: { ...existing.xbrowser, ...packageJson.xbrowser },
          _marketplace: packageJson._marketplace,
        };
        writeFileSync(pkgPath, JSON.stringify(merged, null, 2));
      } catch {
        writeFileSync(pkgPath, JSON.stringify(packageJson, null, 2));
      }
    }

    if (!existsSync(resolve(targetDir, 'index.ts')) && !existsSync(resolve(targetDir, 'index.js'))) {
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

    const trackUrl = `${baseUrl}/api/plugins/${slug}/install`;
    fetch(trackUrl, { method: 'POST' }).catch(() => {});

    return {
      id: name,
      name,
      path: targetDir,
      source: 'marketplace',
      installedAt: new Date().toISOString(),
      warnings: verify.warnings,
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
      const indexJsPath = resolve(pluginPath, 'index.js');
      if (!existsSync(indexPath) && !existsSync(indexJsPath)) continue;

      const metadata = PluginMetadataParser.parseFromPackageJson(pluginPath);

      let source: InstalledPlugin['source'] = 'local';
      try {
        const pkg = JSON.parse(readFileSync(resolve(pluginPath, 'package.json'), 'utf-8'));
        if (pkg._marketplace) source = 'marketplace';
        else if (pkg._npmSource) source = 'npm';
        else if (pkg._gitSource) source = 'git';
        else if (pkg._urlSource) source = 'url';
      } catch {
        /* keep local */
      }

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
      if (source.endsWith('.git')) return 'git';
      return 'url';
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
        return parts[parts.length - 1] || 'plugin';
      }
    }
  }
}
