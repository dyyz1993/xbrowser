import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { readJsonFile } from '../utils/json-file.js';

const SHARED_PLUGIN_DEPENDENCIES: Record<string, string> = {
  'zod': '^3.24.0',
  '@dyyz1993/xcli-core': '^0.12.1',
};

/**
 * Ensure the plugins directory has a node_modules with shared dependencies.
 *
 * Strategy:
 * 1. If node_modules already exists with zod — nothing to do
 * 2. Otherwise, create/update package.json with shared deps, then npm install
 */
export function ensurePluginDependencies(pluginsDir: string): void {
  const zodPath = join(pluginsDir, 'node_modules', 'zod');
  if (existsSync(zodPath)) return;

  mkdirSync(pluginsDir, { recursive: true });

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

  try {
    execSync('npm install --production --no-package-lock --no-fund --no-audit', {
      cwd: pluginsDir,
      stdio: 'pipe',
      timeout: 60_000,
      env: { ...process.env, NODE_ENV: 'production' },
    });
  } catch (err) {
    console.warn(`⚠️  Failed to install shared plugin dependencies: ${err instanceof Error ? err.message : String(err)}`);
  }
}
