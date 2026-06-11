import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Re-export shared utilities from @dyyz1993/xcli-core
export {
  extractTarGz,
  flattenPackageRoot,
  safeCleanup,
} from '@dyyz1993/xcli-core';

import type { PluginVerifyResult } from '@dyyz1993/xcli-core';
import { downloadToFile as coreDownload } from '@dyyz1993/xcli-core';
import { ensureProxyFetch } from '../utils/proxy-fetch.js';

/**
 * Download a URL to a local file, with xbrowser's proxy support.
 *
 * Wraps core's downloadToFile with ensureProxyFetch so marketplace,
 * npm registry and other requests go through the configured proxy.
 */
export async function downloadToFile(url: string, destPath: string): Promise<void> {
  await ensureProxyFetch();
  return coreDownload(url, destPath);
}

/**
 * Verify that a directory looks like a valid xbrowser plugin.
 *
 * Unlike core's verifyPlugin (which checks for generic `xcli` metadata),
 * this checks for `xbrowser` metadata — specific to the xbrowser ecosystem.
 */
export async function verifyPlugin(dir: string): Promise<PluginVerifyResult> {
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
