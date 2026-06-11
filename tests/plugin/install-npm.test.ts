import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = resolve(tmpdir(), 'xbrowser-test-install-npm');

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@dyyz1993/xcli-core', () => ({
  downloadToFile: vi.fn().mockResolvedValue(undefined),
  extractTarGz: vi.fn(),
  flattenPackageRoot: vi.fn(),
  verifyPlugin: vi.fn(),
  safeCleanup: vi.fn(),
}));

import { installFromNpm } from '../../src/plugin/install-sources/npm.js';
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

describe('install-sources/npm', () => {
  let targetDir: string;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    targetDir = resolve(TEST_DIR, 'target');
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('installFromNpm', () => {
    it('should install package from npm', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              dist: { tarball: 'https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz' },
            },
          },
        }),
      });

      vi.mocked(downloadToFile).mockResolvedValueOnce(undefined);
      setupExtractMockWithFiles();

      vi.mocked(verifyPlugin).mockReturnValueOnce({
        valid: true,
        warnings: [],
      });

      const result = await installFromNpm('test-pkg', 'test-plugin', targetDir);

      expect(result.id).toBe('test-plugin');
      expect(result.source).toBe('npm');
      expect(result.path).toBe(targetDir);
      expect(mockFetch).toHaveBeenCalledWith('https://registry.npmjs.org/test-pkg');
      expect(downloadToFile).toHaveBeenCalled();
      expect(extractTarGz).toHaveBeenCalled();
    });

    it('should throw when package not found on npm', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(
        installFromNpm('nonexistent-pkg', 'bad', targetDir)
      ).rejects.toThrow('Package "nonexistent-pkg" not found on npm');
    });

    it('should throw when no stable version', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'dist-tags': {},
          versions: {},
        }),
      });

      await expect(
        installFromNpm('no-version-pkg', 'bad', targetDir)
      ).rejects.toThrow('No stable version found');
    });

    it('should throw when no tarball URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': { dist: {} },
          },
        }),
      });

      await expect(
        installFromNpm('no-tarball-pkg', 'bad', targetDir)
      ).rejects.toThrow('No tarball URL');
    });

    it('should throw when plugin verification fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              dist: { tarball: 'https://registry.npmjs.org/test/-/test-1.0.0.tgz' },
            },
          },
        }),
      });

      vi.mocked(downloadToFile).mockResolvedValueOnce(undefined);
      setupExtractMockWithFiles();
      vi.mocked(verifyPlugin).mockReturnValueOnce({
        valid: false,
        error: 'No entry point',
        warnings: [],
      });

      await expect(
        installFromNpm('bad-plugin', 'bad', targetDir)
      ).rejects.toThrow('Invalid npm plugin: No entry point');
    });

    it('should write _npmSource to package.json', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          'dist-tags': { latest: '2.0.0' },
          versions: {
            '2.0.0': {
              dist: { tarball: 'https://registry.npmjs.org/pkg/-/pkg-2.0.0.tgz' },
            },
          },
        }),
      });

      vi.mocked(downloadToFile).mockResolvedValueOnce(undefined);

      vi.mocked(extractTarGz).mockImplementation((_tarball: string, extractDir: string) => {
        mkdirSync(extractDir, { recursive: true });
        writeFileSync(resolve(extractDir, 'index.ts'), 'export default {}');
        writeFileSync(
          resolve(extractDir, 'package.json'),
          JSON.stringify({ name: 'my-pkg' })
        );
      });

      vi.mocked(verifyPlugin).mockReturnValueOnce({
        valid: true,
        warnings: [],
      });

      await installFromNpm('my-pkg', 'my-plugin', targetDir);

      const pkg = JSON.parse(readFileSync(resolve(targetDir, 'package.json'), 'utf-8'));
      expect(pkg._npmSource).toEqual({ name: 'my-pkg', version: '2.0.0' });
    });
  });
});
