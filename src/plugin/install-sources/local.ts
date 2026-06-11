import { existsSync, cpSync, rmSync } from 'fs';
import { resolve } from 'path';
import type { InstalledPlugin } from '../installer-types.js';
import { verifyPlugin, safeCleanup } from '@dyyz1993/xcli-core';

export async function installFromLocal(
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

    const verify = verifyPlugin(tmpTarget, { metadataField: 'xbrowser' });
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
