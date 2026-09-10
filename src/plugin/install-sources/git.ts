import { existsSync, readFileSync, writeFileSync, rmSync, cpSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import type { InstalledPlugin } from '../installer-types.js';
import { verifyPlugin, safeCleanup } from '@dyyz1993/xcli-core';

// Allowed remote forms: URL schemes (https/git/git+https/git+ssh/ssh) and
// scp-style git@host:path. Everything else — file://, http://, local paths,
// leading dashes — is rejected before git is ever invoked.
const GIT_URL_RE = /^(?:https|git|git\+https|git\+ssh|ssh):\/\/[^\s"'`\\;<>()&]+$/i;
const GIT_SCP_RE = /^git@[\w.-]+:[\w./~+-]+$/;

/**
 * Validate a user-supplied git URL before passing it to git.
 *
 * Defense in depth on top of the execFile argument-array invocation (no
 * shell): rejects git-option injection (leading `-`), shell metacharacters,
 * control characters, and any protocol outside the allowlist.
 */
export function isValidGitUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (url.startsWith('-')) return false;
  if (/[\r\n\0]/.test(url)) return false;
  return GIT_URL_RE.test(url) || GIT_SCP_RE.test(url);
}

/** Run git with an argument array (never a shell); surface stderr on failure. */
function execGit(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // execFile defaults to stdio 'pipe'; no options object needed.
    execFile('git', args, (err: Error | null, _stdout: string | Buffer, stderr: string | Buffer) => {
      if (err) {
        const stderrText = typeof stderr === 'string' ? stderr : (stderr?.toString('utf-8') ?? '');
        const detail = stderrText.trim() || err.message;
        reject(new Error(`git clone failed: ${detail}`));
      } else {
        resolve();
      }
    });
  });
}

export async function installFromGit(
  gitUrl: string,
  name: string,
  targetDir: string
): Promise<InstalledPlugin> {
  if (!isValidGitUrl(gitUrl)) {
    throw new Error(
      `Invalid git URL: ${JSON.stringify(gitUrl).slice(0, 120)} — allowed forms: ` +
      `https://, git://, git+https://, git+ssh://, ssh://, git@host:path`
    );
  }

  const tmpDir = join(tmpdir(), `xbrowser-git-${Date.now()}`);

  let warnings: string[] = [];
  try {
    // execFile with an argument array — no shell, no concatenation. The `--`
    // separator guarantees the URL is treated as a positional argument even
    // if the allowlist above ever lets a dash-prefixed string through.
    await execGit(['clone', '--depth', '1', '--', gitUrl, tmpDir]);

    const verify = verifyPlugin(tmpDir, { metadataField: 'xbrowser' });
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
