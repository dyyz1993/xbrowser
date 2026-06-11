import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import type { InstalledPlugin } from '../installer-types.js';
import {
  downloadToFile,
  extractTarGz,
  flattenPackageRoot,
  verifyPlugin,
  safeCleanup,
} from '@dyyz1993/xcli-core';
import { ensureProxyFetch } from '../../utils/proxy-fetch.js';

export async function installFromNpm(
  packageName: string,
  name: string,
  targetDir: string
): Promise<InstalledPlugin> {
  await ensureProxyFetch();
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

    const verify = verifyPlugin(extractDir, { metadataField: 'xbrowser' });
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
