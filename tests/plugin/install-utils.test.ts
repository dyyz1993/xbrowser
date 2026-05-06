import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = resolve(tmpdir(), 'xbrowser-test-install-utils');

vi.mock('../../src/config.js', () => ({
  getConfigValue: vi.fn(() => undefined),
}));

import { execSync } from 'child_process';
import {
  verifyPlugin,
  flattenPackageRoot,
  extractTarGz,
  downloadToFile,
  getMarketplaceUrl,
  safeCleanup,
} from '../../src/plugin/install-utils.js';

describe('install-utils', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('verifyPlugin', () => {
    it('should return valid when index.ts exists', async () => {
      const pluginDir = resolve(TEST_DIR, 'valid-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(resolve(pluginDir, 'index.ts'), 'export default {}');
      writeFileSync(
        resolve(pluginDir, 'package.json'),
        JSON.stringify({ name: 'test', xbrowser: { id: 'test' } })
      );

      const result = await verifyPlugin(pluginDir);

      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual([]);
    });

    it('should return valid when index.js exists', async () => {
      const pluginDir = resolve(TEST_DIR, 'js-plugin');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(resolve(pluginDir, 'index.js'), 'module.exports = {}');

      const result = await verifyPlugin(pluginDir);

      expect(result.valid).toBe(true);
    });

    it('should return invalid when no entry point', async () => {
      const pluginDir = resolve(TEST_DIR, 'no-entry');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(resolve(pluginDir, 'package.json'), '{}');

      const result = await verifyPlugin(pluginDir);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('No index.ts or index.js entry point found');
    });

    it('should warn when package.json missing', async () => {
      const pluginDir = resolve(TEST_DIR, 'no-pkg');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(resolve(pluginDir, 'index.ts'), 'export default {}');

      const result = await verifyPlugin(pluginDir);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('No package.json found');
    });

    it('should warn when no xbrowser metadata', async () => {
      const pluginDir = resolve(TEST_DIR, 'no-xbrowser');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(resolve(pluginDir, 'index.ts'), 'export default {}');
      writeFileSync(resolve(pluginDir, 'package.json'), JSON.stringify({ name: 'test' }));

      const result = await verifyPlugin(pluginDir);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('No xbrowser metadata in package.json');
    });

    it('should warn when package.json is invalid JSON', async () => {
      const pluginDir = resolve(TEST_DIR, 'bad-json');
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(resolve(pluginDir, 'index.ts'), 'export default {}');
      writeFileSync(resolve(pluginDir, 'package.json'), 'not-json');

      const result = await verifyPlugin(pluginDir);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Invalid package.json');
    });
  });

  describe('flattenPackageRoot', () => {
    it('should flatten package subdirectory into parent', () => {
      const targetDir = resolve(TEST_DIR, 'flatten-test');
      const pkgDir = resolve(targetDir, 'package');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(resolve(pkgDir, 'index.ts'), 'export default {}');
      writeFileSync(resolve(pkgDir, 'package.json'), '{"name":"test"}');

      flattenPackageRoot(targetDir);

      expect(existsSync(resolve(targetDir, 'index.ts'))).toBe(true);
      expect(existsSync(resolve(targetDir, 'package.json'))).toBe(true);
      expect(existsSync(pkgDir)).toBe(false);
    });

    it('should not flatten when there are multiple directories', () => {
      const targetDir = resolve(TEST_DIR, 'multi-dir');
      mkdirSync(resolve(targetDir, 'package'), { recursive: true });
      mkdirSync(resolve(targetDir, 'other'), { recursive: true });
      writeFileSync(resolve(targetDir, 'package', 'file.txt'), 'a');
      writeFileSync(resolve(targetDir, 'other', 'file.txt'), 'b');

      flattenPackageRoot(targetDir);

      expect(existsSync(resolve(targetDir, 'package'))).toBe(true);
      expect(existsSync(resolve(targetDir, 'other'))).toBe(true);
    });

    it('should not flatten when single dir is not named package', () => {
      const targetDir = resolve(TEST_DIR, 'not-package');
      mkdirSync(resolve(targetDir, 'dist'), { recursive: true });
      writeFileSync(resolve(targetDir, 'dist', 'file.txt'), 'a');

      flattenPackageRoot(targetDir);

      expect(existsSync(resolve(targetDir, 'dist'))).toBe(true);
      expect(existsSync(resolve(targetDir, 'file.txt'))).toBe(false);
    });
  });

  describe('extractTarGz', () => {
    it('should extract a tar.gz archive', () => {
      const archiveDir = resolve(TEST_DIR, 'archive-src');
      mkdirSync(archiveDir, { recursive: true });
      writeFileSync(resolve(archiveDir, 'hello.txt'), 'hello world');
      writeFileSync(resolve(archiveDir, 'package.json'), '{"name":"test"}');

      const tarballPath = resolve(TEST_DIR, 'test.tar.gz');
      execSync(`tar -czf "${tarballPath}" -C "${archiveDir}" .`, { stdio: 'pipe' });

      const extractDir = resolve(TEST_DIR, 'extracted');
      extractTarGz(tarballPath, extractDir);

      expect(existsSync(resolve(extractDir, 'hello.txt'))).toBe(true);
      expect(readFileSync(resolve(extractDir, 'hello.txt'), 'utf-8')).toBe('hello world');
    });

    it('should create target dir if not exists', () => {
      const archiveDir = resolve(TEST_DIR, 'simple');
      mkdirSync(archiveDir, { recursive: true });
      writeFileSync(resolve(archiveDir, 'a.txt'), 'a');

      const tarballPath = resolve(TEST_DIR, 'simple.tar.gz');
      execSync(`tar -czf "${tarballPath}" -C "${archiveDir}" .`, { stdio: 'pipe' });

      const extractDir = resolve(TEST_DIR, 'new-dir');
      expect(existsSync(extractDir)).toBe(false);

      extractTarGz(tarballPath, extractDir);

      expect(existsSync(extractDir)).toBe(true);
    });
  });

  describe('downloadToFile', () => {
    it('should copy file for file:// URLs', async () => {
      const srcDir = resolve(TEST_DIR, 'dl-src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(resolve(srcDir, 'data.bin'), 'test-content');

      const destPath = resolve(TEST_DIR, 'dl-dest.bin');
      await downloadToFile(`file://${resolve(srcDir, 'data.bin')}`, destPath);

      expect(existsSync(destPath)).toBe(true);
      expect(readFileSync(destPath, 'utf-8')).toBe('test-content');
    });

    it('should throw on failed HTTP download', async () => {
      const destPath = resolve(TEST_DIR, 'fail.bin');

      await expect(
        downloadToFile('https://invalid-host-that-does-not-exist.test/file.tar.gz', destPath)
      ).rejects.toThrow();
    });
  });

  describe('getMarketplaceUrl', () => {
    it('should return default URL when no config', () => {
      const url = getMarketplaceUrl();
      expect(url).toBe('https://xbrowser-marketplace.dyyz1993.workers.dev');
    });

    it('should return env var when set', () => {
      const original = process.env.XBROWSER_MARKETPLACE_URL;
      process.env.XBROWSER_MARKETPLACE_URL = 'http://custom.test';
      const url = getMarketplaceUrl();
      expect(url).toBe('http://custom.test');
      if (original !== undefined) {
        process.env.XBROWSER_MARKETPLACE_URL = original;
      } else {
        delete process.env.XBROWSER_MARKETPLACE_URL;
      }
    });
  });

  describe('safeCleanup', () => {
    it('should remove directory without throwing', () => {
      const dir = resolve(TEST_DIR, 'to-clean');
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, 'file.txt'), 'x');

      safeCleanup(dir);

      expect(existsSync(dir)).toBe(false);
    });

    it('should not throw when directory does not exist', () => {
      expect(() => safeCleanup(resolve(TEST_DIR, 'nonexistent'))).not.toThrow();
    });
  });
});
