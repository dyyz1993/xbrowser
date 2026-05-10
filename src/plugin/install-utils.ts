import {
  existsSync,
  readdirSync,
  cpSync,
  rmSync,
  mkdirSync,
  readFileSync,
  createWriteStream,
} from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { getConfigValue } from '../config.js';

export interface PluginVerifyResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

const DEFAULT_MARKETPLACE_URL = 'https://xbrowser-marketplace.dyyz1993.workers.dev';

export async function downloadToFile(url: string, destPath: string): Promise<void> {
  if (url.startsWith('file://')) {
    const filePath = decodeURIComponent(new URL(url).pathname);
    cpSync(filePath, destPath, { force: true });
    return;
  }
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

export function extractTarGz(tarballPath: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  execSync(`tar -xzf "${tarballPath}" -C "${targetDir}"`, { stdio: 'pipe' });
}

export function flattenPackageRoot(targetDir: string): void {
  const entries = readdirSync(targetDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  const files = entries.filter((e) => !e.isDirectory());
  if (dirs.length === 1 && files.length === 0) {
    const pkgDir = resolve(targetDir, dirs[0].name);
    const items = readdirSync(pkgDir);
    for (const item of items) {
      const src = resolve(pkgDir, item);
      const dst = resolve(targetDir, item);
      cpSync(src, dst, { recursive: true, force: true });
    }
    rmSync(pkgDir, { recursive: true, force: true });
  }
}

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

export function getMarketplaceUrl(): string {
  return (
    process.env.XBROWSER_MARKETPLACE_URL ||
    (getConfigValue('marketplaceUrl') as string) ||
    DEFAULT_MARKETPLACE_URL
  );
}

export function safeCleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
