import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = resolve(tmpdir(), 'xbrowser-test-git');

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  cpSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../../src/plugin/install-utils.js', () => ({
  verifyPlugin: vi.fn(),
  safeCleanup: vi.fn(),
}));

import { installFromGit } from '../../src/plugin/install-sources/git.js';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { verifyPlugin } from '../../src/plugin/install-utils.js';

describe('install-sources/git', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.cpSync).mockImplementation(() => {});
    vi.mocked(fs.rmSync).mockImplementation(() => {});
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.mkdirSync).mockImplementation(() => '');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should install plugin from git URL', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.alloc(0));
    vi.mocked(verifyPlugin).mockResolvedValue({ valid: true, warnings: [] });

    const result = await installFromGit(
      'https://github.com/user/plugin.git',
      'my-plugin',
      '/tmp/target'
    );

    expect(result.id).toBe('my-plugin');
    expect(result.name).toBe('my-plugin');
    expect(result.source).toBe('git');
    expect(result.path).toBe('/tmp/target');
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('git clone --depth 1'),
      { stdio: 'pipe' }
    );
    expect(fs.cpSync).toHaveBeenCalled();
  });

  it('should throw when plugin verification fails', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.alloc(0));
    vi.mocked(verifyPlugin).mockResolvedValue({
      valid: false,
      error: 'No index.ts or index.js entry point found',
      warnings: [],
    });

    await expect(
      installFromGit('https://github.com/user/bad.git', 'bad', '/tmp/bad')
    ).rejects.toThrow('Invalid git plugin: No index.ts or index.js entry point found');
  });

  it('should throw when git clone fails', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("fatal: repository 'https://github.com/nonexist/repo.git' not found");
    });

    await expect(
      installFromGit('https://github.com/nonexist/repo.git', 'nope', '/tmp/nope')
    ).rejects.toThrow('not found');
  });

  it('should remove .git directory after cloning', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.alloc(0));
    vi.mocked(verifyPlugin).mockResolvedValue({ valid: true, warnings: [] });

    await installFromGit('https://github.com/user/g.git', 'g', '/tmp/g');

    expect(fs.rmSync).toHaveBeenCalledWith(
      expect.stringContaining('/.git'),
      { recursive: true, force: true }
    );
  });

  it('should add _gitSource to package.json', async () => {
    const gitUrl = 'https://github.com/user/meta-plugin.git';
    vi.mocked(execSync).mockReturnValue(Buffer.alloc(0));
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
      const path = String(p);
      return path.endsWith('package.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ name: 'meta-plugin', version: '1.0.0' })
    );
    vi.mocked(verifyPlugin).mockResolvedValue({ valid: true, warnings: [] });

    await installFromGit(gitUrl, 'meta-plugin', '/tmp/meta');

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('package.json'),
      expect.stringContaining('_gitSource')
    );
  });

  it('should not overwrite existing _gitSource', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.alloc(0));
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => {
      const path = String(p);
      return path.endsWith('package.json');
    });
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ name: 'g', _gitSource: { url: 'original-url' } })
    );
    vi.mocked(verifyPlugin).mockResolvedValue({ valid: true, warnings: [] });

    await installFromGit('https://github.com/user/new.git', 'g', '/tmp/g');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(
      (call) => String(call[0]).includes('package.json')
    );
    expect(writeCall).toBeUndefined();
  });

  it('should include warnings from verifyPlugin', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.alloc(0));
    vi.mocked(verifyPlugin).mockResolvedValue({
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
    vi.mocked(execSync).mockReturnValue(Buffer.alloc(0));
    vi.mocked(verifyPlugin).mockResolvedValue({ valid: true, warnings: [] });

    const result = await installFromGit(
      'https://github.com/user/ow.git',
      'overwrite',
      '/tmp/ow'
    );

    expect(result.id).toBe('overwrite');
    expect(fs.rmSync).toHaveBeenCalledWith('/tmp/ow', { recursive: true, force: true });
  });

  it('should set installedAt as valid ISO string', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.alloc(0));
    vi.mocked(verifyPlugin).mockResolvedValue({ valid: true, warnings: [] });

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
    vi.mocked(execSync).mockReturnValue(Buffer.alloc(0));
    vi.mocked(verifyPlugin).mockResolvedValue({ valid: true, warnings: [] });

    await installFromGit('https://github.com/user/shallow.git', 'shallow', '/tmp/shallow');

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('--depth 1'),
      { stdio: 'pipe' }
    );
  });

  it('should skip package.json update when no package.json exists', async () => {
    vi.mocked(execSync).mockReturnValue(Buffer.alloc(0));
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(verifyPlugin).mockResolvedValue({ valid: true, warnings: [] });

    const result = await installFromGit('https://github.com/user/nopkg.git', 'nopkg', '/tmp/nopkg');

    expect(result.id).toBe('nopkg');
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });
});
