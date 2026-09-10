import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  cpSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('@dyyz1993/xcli-core', () => ({
  verifyPlugin: vi.fn(),
  safeCleanup: vi.fn(),
  registerCommandDefinition: vi.fn(),
  outputFormatter: vi.fn(),
  isCommandResult: vi.fn(),
  helpGenerator: vi.fn(() => ({ generate: vi.fn() })),
}));

import { installFromGit, isValidGitUrl } from '../../src/plugin/install-sources/git.js';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import { verifyPlugin } from '@dyyz1993/xcli-core';

/** execFile mock that finds the callback by position-agnostic argument scan. */
function mockExecFileSuccess(): void {
  vi.mocked(execFile).mockImplementation(((...callArgs: unknown[]) => {
    const cb = callArgs.find((a) => typeof a === 'function') as unknown as (
      err: Error | null,
      stdout: string,
      stderr: string
    ) => void;
    cb(null, '', '');
  }) as unknown as typeof execFile);
}

describe('install-sources/git', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFileSuccess();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.cpSync).mockImplementation(() => {});
    vi.mocked(fs.rmSync).mockImplementation(() => {});
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.mkdirSync).mockImplementation(() => '');
    vi.mocked(verifyPlugin).mockReturnValue({ valid: true, warnings: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── P0-3: URL validation (defense before any git invocation) ──

  describe('isValidGitUrl', () => {
    it('accepts https git URLs', () => {
      expect(isValidGitUrl('https://github.com/user/plugin.git')).toBe(true);
      expect(isValidGitUrl('https://gitlab.com/group/sub/repo.git')).toBe(true);
    });

    it('accepts git://, git+https://, git+ssh://, ssh:// and scp-style URLs', () => {
      expect(isValidGitUrl('git://github.com/user/plugin.git')).toBe(true);
      expect(isValidGitUrl('git+https://github.com/user/plugin.git')).toBe(true);
      expect(isValidGitUrl('git+ssh://git@github.com/user/plugin.git')).toBe(true);
      expect(isValidGitUrl('ssh://git@github.com/user/plugin.git')).toBe(true);
      expect(isValidGitUrl('git@github.com:user/plugin.git')).toBe(true);
    });

    it('rejects URLs starting with a dash (git option injection)', () => {
      expect(isValidGitUrl('--upload-pack=touch /tmp/pwn')).toBe(false);
      expect(isValidGitUrl('-u/bin/sh')).toBe(false);
    });

    it('rejects shell metacharacters: quotes, semicolons, backticks, backslashes', () => {
      expect(isValidGitUrl('https://x.com/a.git"; rm -rf ~')).toBe(false);
      expect(isValidGitUrl("https://x.com/a.git'; id")).toBe(false);
      expect(isValidGitUrl('https://x.com/a.git;id')).toBe(false);
      expect(isValidGitUrl('https://x.com/`id`.git')).toBe(false);
      expect(isValidGitUrl('https://x.com/a\\;b.git')).toBe(false);
    });

    it('rejects newlines and other control characters', () => {
      expect(isValidGitUrl('https://x.com/a.git\nrm -rf /tmp')).toBe(false);
      expect(isValidGitUrl('https://x.com/a.git\rid')).toBe(false);
      expect(isValidGitUrl('https://x.com/a\u0000.git')).toBe(false);
    });

    it('rejects disallowed protocols and non-URLs', () => {
      expect(isValidGitUrl('file:///etc/passwd')).toBe(false);
      expect(isValidGitUrl('http://github.com/user/plugin.git')).toBe(false);
      expect(isValidGitUrl('ftp://x.com/a.git')).toBe(false);
      expect(isValidGitUrl('')).toBe(false);
      expect(isValidGitUrl('not a url')).toBe(false);
    });

    it('rejects URLs with spaces', () => {
      expect(isValidGitUrl('https://x.com/a b.git')).toBe(false);
    });
  });

  // ── P0-3: shell-free clone invocation ──

  it('clones via execFile argument array, never a shell string', async () => {
    await installFromGit('https://github.com/user/plugin.git', 'my-plugin', '/tmp/target');

    expect(execFile).toHaveBeenCalledTimes(1);
    const call = vi.mocked(execFile).mock.calls[0];
    expect(call[0]).toBe('git');
    expect(call[1]).toEqual(
      expect.arrayContaining(['clone', '--depth', '1', 'https://github.com/user/plugin.git'])
    );
    // URL must be passed as a single argument — no concatenation surface
    const urlArg = (call[1] as string[]).find((a) => a.includes('github.com'));
    expect(urlArg).toBe('https://github.com/user/plugin.git');
  });

  it('uses -- separator so a URL can never be parsed as a git option', async () => {
    await installFromGit('https://github.com/user/plugin.git', 'p', '/tmp/p');
    const args = vi.mocked(execFile).mock.calls[0][1] as string[];
    const sepIdx = args.indexOf('--');
    const urlIdx = args.indexOf('https://github.com/user/plugin.git');
    expect(sepIdx).toBeGreaterThan(-1);
    expect(urlIdx).toBeGreaterThan(sepIdx);
  });

  it('rejects malicious URLs before invoking git at all', async () => {
    const malicious = [
      'https://x.com/a.git"; rm -rf ~',
      'https://x.com/a.git;id',
      '--upload-pack=touch /tmp/pwn',
      'https://x.com/a.git\nrm -rf /tmp',
      'file:///etc/passwd',
    ];
    for (const url of malicious) {
      await expect(installFromGit(url, 'evil', '/tmp/evil')).rejects.toThrow(/Invalid git URL/i);
    }
    expect(execFile).not.toHaveBeenCalled();
  });

  it('surfaces git stderr in the failure message', async () => {
    vi.mocked(execFile).mockImplementation(((...callArgs: unknown[]) => {
      const cb = callArgs.find((a) => typeof a === 'function') as unknown as (
        err: Error | null,
        stdout: string,
        stderr: string
      ) => void;
      cb(
        new Error('Command failed: git clone'),
        '',
        "fatal: repository 'https://github.com/nonexist/repo.git' not found"
      );
    }) as unknown as typeof execFile);

    await expect(
      installFromGit('https://github.com/nonexist/repo.git', 'nope', '/tmp/nope')
    ).rejects.toThrow('not found');
  });

  // ── preserved install behaviors ──

  it('should throw when plugin verification fails', async () => {
    vi.mocked(verifyPlugin).mockReturnValue({
      valid: false,
      error: 'No index.ts or index.js entry point found',
      warnings: [],
    });

    await expect(
      installFromGit('https://github.com/user/bad.git', 'bad', '/tmp/bad')
    ).rejects.toThrow('Invalid git plugin: No index.ts or index.js entry point found');
  });

  it('should remove .git directory after cloning', async () => {
    await installFromGit('https://github.com/user/g.git', 'g', '/tmp/g');

    expect(fs.rmSync).toHaveBeenCalledWith(
      expect.stringContaining('/.git'),
      { recursive: true, force: true }
    );
  });

  it('should add _gitSource to package.json', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
      const path = String(p);
      return path.endsWith('package.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ name: 'meta-plugin', version: '1.0.0' })
    );

    await installFromGit('https://github.com/user/meta-plugin.git', 'meta-plugin', '/tmp/meta');

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('package.json'),
      expect.stringContaining('_gitSource')
    );
  });

  it('should not overwrite existing _gitSource', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
      const path = String(p);
      return path.endsWith('package.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ name: 'g', _gitSource: { url: 'original-url' } })
    );

    await installFromGit('https://github.com/user/new.git', 'g', '/tmp/g');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(
      (call) => String(call[0]).includes('package.json')
    );
    expect(writeCall).toBeUndefined();
  });

  it('should include warnings from verifyPlugin', async () => {
    vi.mocked(verifyPlugin).mockReturnValue({
      valid: true,
      warnings: ['No package.json found'],
    });

    const result = await installFromGit(
      'https://github.com/user/warn.git',
      'warn',
      '/tmp/warn'
    );

    expect(result.warnings).toEqual(['No package.json found']);
  });

  it('should overwrite existing target directory', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = await installFromGit(
      'https://github.com/user/ow.git',
      'overwrite',
      '/tmp/ow'
    );

    expect(result.id).toBe('overwrite');
    expect(fs.rmSync).toHaveBeenCalledWith('/tmp/ow', { recursive: true, force: true });
  });

  it('should set installedAt as valid ISO string', async () => {
    const before = new Date().toISOString();
    const result = await installFromGit(
      'https://github.com/user/time.git',
      'time',
      '/tmp/time'
    );
    const after = new Date().toISOString();

    expect(result.installedAt >= before).toBe(true);
    expect(result.installedAt <= after).toBe(true);
    expect(new Date(result.installedAt).getTime()).not.toBeNaN();
  });

  it('should use --depth 1 for shallow clone', async () => {
    await installFromGit('https://github.com/user/shallow.git', 'shallow', '/tmp/shallow');

    const args = vi.mocked(execFile).mock.calls[0][1] as string[];
    expect(args).toContain('--depth');
    expect(args[args.indexOf('--depth') + 1]).toBe('1');
  });

  it('should skip package.json update when no package.json exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await installFromGit('https://github.com/user/nopkg.git', 'nopkg', '/tmp/nopkg');

    expect(result.id).toBe('nopkg');
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('cleans up the temp directory even when clone fails', async () => {
    vi.mocked(execFile).mockImplementation(((...callArgs: unknown[]) => {
      const cb = callArgs.find((a) => typeof a === 'function') as unknown as (
        err: Error | null
      ) => void;
      cb(new Error('clone failed'));
    }) as unknown as typeof execFile);

    const { safeCleanup } = await import('@dyyz1993/xcli-core');
    await expect(
      installFromGit('https://github.com/user/gone.git', 'gone', '/tmp/gone')
    ).rejects.toThrow('clone failed');
    expect(safeCleanup).toHaveBeenCalled();
  });
});
