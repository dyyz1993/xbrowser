import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from 'fs';
import { resolve, join, basename } from 'path';
import { tmpdir } from 'os';
import type { InstalledPlugin } from '../installer-types.js';
import {
  downloadToFile,
  extractTarGz,
  flattenPackageRoot,
  verifyPlugin,
  safeCleanup,
} from '@dyyz1993/xcli-core';

export async function installFromUrl(
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

    const verify = verifyPlugin(extractDir, { metadataField: 'xbrowser' });
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
