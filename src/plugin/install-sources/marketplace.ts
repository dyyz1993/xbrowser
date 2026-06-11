import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  cpSync,
} from 'fs';
import { resolve, join, dirname } from 'path';
import { tmpdir } from 'os';
import { gunzipSync } from 'zlib';
import type { InstalledPlugin, InstallOptions } from '../installer-types.js';
import {
  downloadToFile,
  extractTarGz,
  flattenPackageRoot,
  verifyPlugin,
  safeCleanup,
} from '@dyyz1993/xcli-core';
import { getMarketplaceUrl } from '../../config.js';
import { ensureProxyFetch } from '../../utils/proxy-fetch.js';

export async function installFromMarketplace(
  pluginsDir: string,
  slug: string,
  options?: InstallOptions
): Promise<InstalledPlugin> {
  await ensureProxyFetch();
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
  const targetDir = resolve(pluginsDir, name);

  if (existsSync(targetDir) && !options?.force) {
    throw new Error(`Plugin "${name}" already exists. Use --force to overwrite.`);
  }

  mkdirSync(targetDir, { recursive: true });

  const tmpDir = join(tmpdir(), `xbrowser-marketplace-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  const realSlug = String(plugin.slug || slug);

  try {
    await downloadAndExtractMarketplaceTarball(baseUrl, realSlug, tmpDir, targetDir);
  } finally {
    safeCleanup(tmpDir);
  }

  writeMarketplacePackageJson(plugin, slug, name, baseUrl, targetDir);

  ensureIndexFile(plugin, name, targetDir);

  const verify = verifyPlugin(targetDir, { metadataField: 'xbrowser' });
  if (!verify.valid) {
    safeCleanup(targetDir);
    throw new Error(`Invalid marketplace plugin: ${verify.error}`);
  }

  const trackUrl = `${baseUrl}/api/plugins/${realSlug}/install`;
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

type ManifestFile = { path: string; content: string };

function isManifestArray(data: unknown): data is ManifestFile[] {
  return Array.isArray(data) && data.length > 0 && typeof data[0].path === 'string' && typeof data[0].content === 'string';
}

function extractManifestToDir(manifest: ManifestFile[], targetDir: string): void {
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  mkdirSync(targetDir, { recursive: true });

  for (const file of manifest) {
    const filePath = resolve(targetDir, file.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, Buffer.from(file.content, 'base64'));
  }
}

function tryParseAsGzippedManifest(buffer: Buffer): ManifestFile[] | null {
  try {
    const gunzipped = gunzipSync(buffer);
    const parsed = JSON.parse(gunzipped.toString('utf-8'));
    if (isManifestArray(parsed)) return parsed;
  } catch {
    // not gzipped
  }

  try {
    const parsed = JSON.parse(buffer.toString('utf-8'));
    if (isManifestArray(parsed)) return parsed;
  } catch {
    // not json
  }

  return null;
}

async function downloadAndExtractMarketplaceTarball(
  baseUrl: string,
  slug: string,
  tmpDir: string,
  targetDir: string
): Promise<void> {
  const tarballUrl = `${baseUrl}/api/plugins/${slug}/tarball`;
  const tarballRes = await fetch(tarballUrl, { redirect: 'manual' });

  if (!tarballRes.ok) {
    throw new Error(`Failed to get tarball for "${slug}" (HTTP ${tarballRes.status})`);
  }

  if (tarballRes.status === 302 || tarballRes.headers.get('location')) {
    const redirectUrl = tarballRes.headers.get('location')!;
    const tarballPath = join(tmpDir, `${slug}.tar.gz`);
    await downloadToFile(redirectUrl, tarballPath);

    const buffer = readFileSync(tarballPath);

    const manifest = tryParseAsGzippedManifest(buffer);
    if (manifest) {
      extractManifestToDir(manifest, targetDir);
      return;
    }

    const extractDir = join(tmpDir, 'extracted');
    extractTarGz(tarballPath, extractDir);
    flattenPackageRoot(extractDir);

    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
    cpSync(extractDir, targetDir, { recursive: true, force: true });
  } else {
    const buffer = Buffer.from(await tarballRes.arrayBuffer());

    const manifest = tryParseAsGzippedManifest(buffer);
    if (manifest) {
      extractManifestToDir(manifest, targetDir);
      return;
    }

    const tarballPath = join(tmpDir, `${slug}.tar.gz`);
    writeFileSync(tarballPath, buffer);

    try {
      const extractDir = join(tmpDir, 'extracted');
      extractTarGz(tarballPath, extractDir);
      flattenPackageRoot(extractDir);

      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
      cpSync(extractDir, targetDir, { recursive: true, force: true });
    } catch {
      throw new Error(
        `Downloaded tarball for "${slug}" is neither a gzipped JSON manifest nor a valid tar.gz archive.`
      );
    }
  }
}

function writeMarketplacePackageJson(
  plugin: Record<string, unknown>,
  slug: string,
  name: string,
  baseUrl: string,
  targetDir: string
): void {
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
}

function ensureIndexFile(
  plugin: Record<string, unknown>,
  name: string,
  targetDir: string
): void {
  if (!existsSync(resolve(targetDir, 'index.ts')) && !existsSync(resolve(targetDir, 'index.js'))) {
    const commands = (plugin.commands || []) as string[];
    const commandHandlers = commands.length > 0
      ? commands.map((cmd: string) => {
          return [
            `  site.command('${cmd}', {`,
            `    description: '${cmd} command',`,
            `    handler: async () => ({ data: { message: '${cmd} executed' }, tips: [] }),`,
            `  });`,
          ].join('\n');
        }).join('\n')
      : [
          `  site.command('hello', {`,
          `    description: 'Hello from ${name}',`,
          `    handler: async () => ({ data: { message: 'Hello from ${name}!' }, tips: [] }),`,
          `  });`,
        ].join('\n');

    writeFileSync(
      resolve(targetDir, 'index.ts'),
      [
        `import type { XCLIAPI } from '@dyyz1993/xcli-core';`,
        ``,
        `export default function (xcli: XCLIAPI): void {`,
        `  const site = xcli.createSite({`,
        `    name: '${name}',`,
        `    url: 'https://example.com',`,
        `  });`,
        ``,
        commandHandlers,
        `}`,
      ].join('\n')
    );
  }
}
