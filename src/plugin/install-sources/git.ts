import { existsSync, readFileSync, writeFileSync, rmSync, cpSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import type { InstalledPlugin } from '../installer-types.js';
import { verifyPlugin, safeCleanup } from '../install-utils.js';

export async function installFromGit(
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
