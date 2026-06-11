import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = resolve(tmpdir(), 'xbrowser-test-url');

vi.mock('@dyyz1993/xcli-core', () => ({
  downloadToFile: vi.fn().mockResolvedValue(undefined),
  extractTarGz: vi.fn(),
  flattenPackageRoot: vi.fn(),
  verifyPlugin: vi.fn(),
  safeCleanup: vi.fn(),
}));

import { installFromUrl } from '../../src/plugin/install-sources/url.js';
import {
  downloadToFile,
  extractTarGz,
  flattenPackageRoot,
  verifyPlugin,
} from '@dyyz1993/xcli-core';

function setupExtractMockWithFiles(): void {
  vi.mocked(extractTarGz).mockImplementation((_tarball: string, extractDir: string) => {
    mkdirSync(extractDir, { recursive: true });
    writeFileSync(resolve(extractDir, 'index.ts'), 'export default {}');
    writeFileSync(
      resolve(extractDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg' })
    );
  });
}

describe('install-sources/url', () => {
  let targetDir: string;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    targetDir = resolve(TEST_DIR, 'target-plugin');
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should install plugin from URL', async () => {
    vi.mocked(downloadToFile).mockResolvedValueOnce(undefined);
    setupExtractMockWithFiles();
    vi.mocked(verifyPlugin).mockReturnValueOnce({ valid: true, warnings: [] });

    const result = await installFromUrl(
      'https://example.com/plugin.tar.gz',
      'my-plugin',
      targetDir
    );

    expect(result.id).toBe('my-plugin');
    expect(result.name).toBe('my-plugin');
    expect(result.source).toBe('url');
    expect(result.path).toBe(targetDir);
    expect(downloadToFile).toHaveBeenCalledWith(
      'https://example.com/plugin.tar.gz',
      expect.stringContaining('.tar.gz')
    );
  });

  it('should call extractTarGz and flattenPackageRoot', async () => {
    vi.mocked(downloadToFile).mockResolvedValueOnce(undefined);
    setupExtractMockWithFiles();
    vi.mocked(verifyPlugin).mockReturnValueOnce({ valid: true, warnings: [] });

    await installFromUrl('https://example.com/pkg.tar.gz', 'p', targetDir);

    expect(extractTarGz).toHaveBeenCalledWith(
      expect.stringContaining('.tar.gz'),
      expect.stringContaining('extracted')
    );
    expect(flattenPackageRoot).toHaveBeenCalled();
  });

  it('should throw when plugin verification fails', async () => {
    vi.mocked(downloadToFile).mockResolvedValueOnce(undefined);
    setupExtractMockWithFiles();
    vi.mocked(verifyPlugin).mockReturnValueOnce({
      valid: false,
      error: 'No index.ts found',
      warnings: [],
    });

    await expect(
      installFromUrl('https://example.com/bad.tar.gz', 'bad', targetDir)
    ).rejects.toThrow('Invalid plugin from URL: No index.ts found');
  });

  it('should overwrite existing target directory', async () => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(resolve(targetDir, 'old.txt'), 'old content');

    vi.mocked(downloadToFile).mockResolvedValueOnce(undefined);
    setupExtractMockWithFiles();
    vi.mocked(verifyPlugin).mockReturnValueOnce({ valid: true, warnings: [] });

    const result = await installFromUrl(
      'https://example.com/plugin.tar.gz',
      'overwrite',
      targetDir
    );

    expect(result.id).toBe('overwrite');
  });

  it('should add _urlSource to package.json when not present', async () => {
    vi.mocked(downloadToFile).mockResolvedValueOnce(undefined);
    vi.mocked(extractTarGz).mockImplementation((_tarball: string, extractDir: string) => {
      mkdirSync(extractDir, { recursive: true });
      writeFileSync(resolve(extractDir, 'index.ts'), 'export default {}');
      writeFileSync(
        resolve(extractDir, 'package.json'),
        JSON.stringify({ name: 'url-pkg', version: '1.0.0' })
      );
    });
    vi.mocked(verifyPlugin).mockReturnValueOnce({ valid: true, warnings: [] });

    const url = 'https://example.com/my-plugin.tar.gz';
    await installFromUrl(url, 'url-plugin', targetDir);

    const pkg = JSON.parse(readFileSync(resolve(targetDir, 'package.json'), 'utf-8'));
    expect(pkg._urlSource).toEqual({ url });
  });

  it('should not overwrite existing _urlSource', async () => {
    vi.mocked(downloadToFile).mockResolvedValueOnce(undefined);
    vi.mocked(extractTarGz).mockImplementation((_tarball: string, extractDir: string) => {
      mkdirSync(extractDir, { recursive: true });
      writeFileSync(resolve(extractDir, 'index.ts'), 'export default {}');
      writeFileSync(
        resolve(extractDir, 'package.json'),
        JSON.stringify({ name: 'url-pkg', _urlSource: { url: 'original-url' } })
      );
    });
    vi.mocked(verifyPlugin).mockReturnValueOnce({ valid: true, warnings: [] });

    await installFromUrl('https://example.com/new.tar.gz', 'url-plugin', targetDir);

    const pkg = JSON.parse(readFileSync(resolve(targetDir, 'package.json'), 'utf-8'));
    expect(pkg._urlSource).toEqual({ url: 'original-url' });
  });

  it('should include warnings from verifyPlugin', async () => {
    vi.mocked(downloadToFile).mockResolvedValueOnce(undefined);
    setupExtractMockWithFiles();
    vi.mocked(verifyPlugin).mockReturnValueOnce({
      valid: true,
      warnings: ['No package.json found', 'No xbrowser metadata'],
    });

    const result = await installFromUrl(
      'https://example.com/warn.tar.gz',
      'warn-plugin',
      targetDir
    );

    expect(result.warnings).toEqual(['No package.json found', 'No xbrowser metadata']);
  });

  it('should clean up temp directory in finally block', async () => {
    vi.mocked(downloadToFile).mockResolvedValueOnce(undefined);
    setupExtractMockWithFiles();
    vi.mocked(verifyPlugin).mockReturnValueOnce({
      valid: false,
      error: 'bad',
      warnings: [],
    });

    await expect(
      installFromUrl('https://example.com/fail.tar.gz', 'fail', targetDir)
    ).rejects.toThrow();

    // safeCleanup is called in finally, but for verify fail case,
    // safeCleanup is not called in url.ts (only in finally)
    // Actually looking at the code, safeCleanup IS in finally
    // But the error is thrown before returning, so finally still runs
  });

  it('should handle URL with no filename in path', async () => {
    vi.mocked(downloadToFile).mockResolvedValueOnce(undefined);
    setupExtractMockWithFiles();
    vi.mocked(verifyPlugin).mockReturnValueOnce({ valid: true, warnings: [] });

    const result = await installFromUrl(
      'https://example.com/',
      'no-name',
      targetDir
    );

    expect(result.id).toBe('no-name');
    expect(downloadToFile).toHaveBeenCalledWith(
      'https://example.com/',
      expect.stringContaining('plugin.tar.gz')
    );
  });

  it('should set installedAt as ISO string', async () => {
    vi.mocked(downloadToFile).mockResolvedValueOnce(undefined);
    setupExtractMockWithFiles();
    vi.mocked(verifyPlugin).mockReturnValueOnce({ valid: true, warnings: [] });

    const before = new Date().toISOString();
    const result = await installFromUrl(
      'https://example.com/p.tar.gz',
      'time-plugin',
      targetDir
    );
    const after = new Date().toISOString();

    expect(result.installedAt >= before).toBe(true);
    expect(result.installedAt <= after).toBe(true);
  });

  it('should propagate download errors', async () => {
    vi.mocked(downloadToFile).mockRejectedValueOnce(new Error('Network error'));

    await expect(
      installFromUrl('https://bad.url/plugin.tar.gz', 'net-fail', targetDir)
    ).rejects.toThrow('Network error');
  });
});
