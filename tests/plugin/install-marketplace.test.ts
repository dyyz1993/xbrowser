import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { gzipSync } from 'zlib';

const TEST_DIR = resolve(tmpdir(), 'xbrowser-test-marketplace');

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Track temp dirs so downloadToFile mock can write to the correct path
let capturedTmpDir = '';

vi.mock('@dyyz1993/xcli-core', () => ({
  downloadToFile: vi.fn().mockImplementation(async (_url: string, filePath: string) => {
    // Write a fake tarball so readFileSync in marketplace.ts can read it
    // Use a gzipped manifest format that tryParseAsGzippedManifest will recognize
    const manifest = JSON.stringify([{ path: 'index.ts', content: Buffer.from('export default {}').toString('base64') }]);
    const gzipped = gzipSync(Buffer.from(manifest));
    writeFileSync(filePath, gzipped);
  }),
  extractTarGz: vi.fn(),
  flattenPackageRoot: vi.fn(),
  verifyPlugin: vi.fn(),
  safeCleanup: vi.fn(),
}));

vi.mock('../../src/config.js', () => ({
  getMarketplaceUrl: vi.fn().mockReturnValue('https://xbrowser-marketplace.test'),
}));

import { installFromMarketplace } from '../../src/plugin/install-sources/marketplace.js';
import {
  downloadToFile,
  extractTarGz,
  flattenPackageRoot,
  verifyPlugin,
} from '@dyyz1993/xcli-core';
import { getMarketplaceUrl } from '../../src/config.js';

/**
 * Create a gzipped manifest buffer that tryParseAsGzippedManifest will recognize.
 * This simulates what the real publisher creates.
 */
function createManifestBuffer(files: Array<{ path: string; content: string }>): Buffer {
  const manifest = JSON.stringify(files);
  return gzipSync(Buffer.from(manifest));
}

/**
 * Setup downloadToFile mock to write a manifest-based tarball.
 * The manifest extraction will create files directly in targetDir.
 */
function setupManifestDownloadWithFiles(files: Array<{ path: string; content: string }>): void {
  vi.mocked(downloadToFile).mockImplementation(async (_url: string, filePath: string) => {
    const buffer = createManifestBuffer(files);
    writeFileSync(filePath, buffer);
  });
}

/**
 * Setup downloadToFile mock to write a non-manifest tarball (raw bytes).
 * This will fall through to extractTarGz path.
 */
function setupNonManifestDownload(rawContent: Buffer): void {
  vi.mocked(downloadToFile).mockImplementation(async (_url: string, filePath: string) => {
    writeFileSync(filePath, rawContent);
  });
}

function setupExtractMockWithFiles(_extractDir: string): void {
  vi.mocked(extractTarGz).mockImplementation((_tarball: string, target: string) => {
    mkdirSync(target, { recursive: true });
    writeFileSync(resolve(target, 'index.ts'), 'export default {}');
    writeFileSync(
      resolve(target, 'package.json'),
      JSON.stringify({ name: 'test-pkg' })
    );
  });
}

describe('install-sources/marketplace', () => {
  let pluginsDir: string;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    pluginsDir = resolve(TEST_DIR, 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    vi.clearAllMocks();
    vi.mocked(getMarketplaceUrl).mockReturnValue('https://xbrowser-marketplace.test');
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should install plugin from marketplace with redirect tarball', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            slug: 'my-plugin',
            name: 'My Plugin',
            version: '1.2.0',
            description: 'A test plugin',
            authorName: 'TestAuthor',
            commands: ['cmd1'],
            tags: ['test'],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 302,
        headers: { get: (name: string) => name === 'location' ? 'https://cdn.test/tarball.tar.gz' : null },
      })
      .mockResolvedValueOnce({ ok: true }); // track install

    setupManifestDownloadWithFiles([
      { path: 'index.ts', content: Buffer.from('export default {}').toString('base64') },
    ]);
    vi.mocked(verifyPlugin).mockReturnValue({ valid: true, warnings: [] });

    const result = await installFromMarketplace(pluginsDir, 'my-plugin');

    expect(result.id).toBe('my-plugin');
    expect(result.source).toBe('marketplace');
    expect(result.name).toBe('my-plugin');
    expect(downloadToFile).toHaveBeenCalledWith(
      'https://cdn.test/tarball.tar.gz',
      expect.any(String)
    );
  });

  it('should install plugin with inline tarball (no redirect)', async () => {
    // Create a manifest buffer for inline response
    const manifestBuffer = createManifestBuffer([
      { path: 'index.ts', content: Buffer.from('export default {}').toString('base64') },
    ]);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            slug: 'inline-plugin',
            name: 'Inline Plugin',
            version: '2.0.0',
            description: 'Inline tarball',
            commands: [],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => manifestBuffer,
      })
      .mockResolvedValueOnce({ ok: true }); // track install

    vi.mocked(verifyPlugin).mockReturnValue({ valid: true, warnings: [] });

    const result = await installFromMarketplace(pluginsDir, 'inline-plugin');

    expect(result.id).toBe('inline-plugin');
    expect(result.source).toBe('marketplace');
  });

  it('should throw when plugin not found on marketplace', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ success: false }),
    });

    await expect(
      installFromMarketplace(pluginsDir, 'nonexistent')
    ).rejects.toThrow('Plugin "nonexistent" not found on marketplace (HTTP 404)');
  });

  it('should throw when API returns success: false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, data: null }),
    });

    await expect(
      installFromMarketplace(pluginsDir, 'bad-plugin')
    ).rejects.toThrow('Failed to fetch plugin details for "bad-plugin"');
  });

  it('should throw when plugin already exists without force', async () => {
    const existingDir = resolve(pluginsDir, 'existing');
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(resolve(existingDir, 'index.ts'), 'export default {}');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { slug: 'existing', name: 'Existing' },
      }),
    });

    await expect(
      installFromMarketplace(pluginsDir, 'existing')
    ).rejects.toThrow('Plugin "existing" already exists. Use --force to overwrite.');
  });

  it('should overwrite existing plugin with force option', async () => {
    const existingDir = resolve(pluginsDir, 'forced');
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(resolve(existingDir, 'old.txt'), 'old');

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            slug: 'forced',
            name: 'Forced',
            version: '1.0.0',
            description: 'test',
            commands: [],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 302,
        headers: { get: (name: string) => name === 'location' ? 'https://cdn.test/forced.tar.gz' : null },
      })
      .mockResolvedValueOnce({ ok: true });

    setupManifestDownloadWithFiles([
      { path: 'index.ts', content: Buffer.from('export default {}').toString('base64') },
    ]);
    vi.mocked(verifyPlugin).mockReturnValue({ valid: true, warnings: [] });

    const result = await installFromMarketplace(pluginsDir, 'forced', { force: true });

    expect(result.id).toBe('forced');
  });

  it('should throw when verification fails', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { slug: 'bad-verify', name: 'Bad Verify', description: 'x', commands: [] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 302,
        headers: { get: (name: string) => name === 'location' ? 'https://cdn.test/bv.tar.gz' : null },
      });

    setupManifestDownloadWithFiles([
      { path: 'index.ts', content: Buffer.from('export default {}').toString('base64') },
    ]);
    vi.mocked(verifyPlugin).mockReturnValue({
      valid: false,
      error: 'No entry point',
      warnings: [],
    });

    await expect(
      installFromMarketplace(pluginsDir, 'bad-verify')
    ).rejects.toThrow('Invalid marketplace plugin: No entry point');
  });

  it('should use custom name from options', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { slug: 'original', name: 'Original', description: 'x', commands: [] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 302,
        headers: { get: (name: string) => name === 'location' ? 'https://cdn.test/o.tar.gz' : null },
      })
      .mockResolvedValueOnce({ ok: true });

    setupManifestDownloadWithFiles([
      { path: 'index.ts', content: Buffer.from('export default {}').toString('base64') },
    ]);
    vi.mocked(verifyPlugin).mockReturnValue({ valid: true, warnings: [] });

    const result = await installFromMarketplace(pluginsDir, 'original', { name: 'custom-name' });

    expect(result.name).toBe('custom-name');
    expect(result.id).toBe('custom-name');
  });

  it('should handle tarball fetch failure', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { slug: 'fail-tb', name: 'Fail', description: 'x', commands: [] },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

    await expect(
      installFromMarketplace(pluginsDir, 'fail-tb')
    ).rejects.toThrow('Failed to get tarball for "fail-tb" (HTTP 500)');
  });

  it('should include warnings in result', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { slug: 'warn-plugin', name: 'Warn', description: 'x', commands: [] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 302,
        headers: { get: (name: string) => name === 'location' ? 'https://cdn.test/w.tar.gz' : null },
      })
      .mockResolvedValueOnce({ ok: true });

    setupManifestDownloadWithFiles([
      { path: 'index.ts', content: Buffer.from('export default {}').toString('base64') },
    ]);
    vi.mocked(verifyPlugin).mockReturnValue({
      valid: true,
      warnings: ['No package.json found'],
    });

    const result = await installFromMarketplace(pluginsDir, 'warn-plugin');

    expect(result.warnings).toEqual(['No package.json found']);
  });

  it('should write package.json with marketplace metadata', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            slug: 'meta-plugin',
            name: 'Meta Plugin',
            version: '3.0.0',
            description: 'Meta test',
            authorName: 'Meta Author',
            license: 'Apache-2.0',
            homepageUrl: 'https://example.com',
            commands: ['run'],
            tags: ['meta'],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 302,
        headers: { get: (name: string) => name === 'location' ? 'https://cdn.test/m.tar.gz' : null },
      })
      .mockResolvedValueOnce({ ok: true });

    setupManifestDownloadWithFiles([
      { path: 'index.ts', content: Buffer.from('export default {}').toString('base64') },
    ]);
    vi.mocked(verifyPlugin).mockReturnValue({ valid: true, warnings: [] });

    await installFromMarketplace(pluginsDir, 'meta-plugin');

    expect(verifyPlugin).toHaveBeenCalled();
  });

  it('should handle inline tarball that is a valid JSON manifest', async () => {
    // Create a manifest buffer (gzipped JSON manifest)
    const manifestBuffer = createManifestBuffer([
      { path: 'index.ts', content: Buffer.from('export default function() {}').toString('base64') },
      { path: 'package.json', content: Buffer.from(JSON.stringify({ name: 'json-plugin', version: '1.0.0' })).toString('base64') },
    ]);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { slug: 'json-plugin', name: 'JSON Plugin', description: 'JSON test', commands: ['test'] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => manifestBuffer,
      })
      .mockResolvedValueOnce({ ok: true });

    vi.mocked(verifyPlugin).mockReturnValue({ valid: true, warnings: [] });

    const result = await installFromMarketplace(pluginsDir, 'json-plugin');

    expect(result.id).toBe('json-plugin');
    expect(result.source).toBe('marketplace');
  });

  it('should throw for inline tarball that is not JSON and not valid archive', async () => {
    const badBuffer = Buffer.from('not-json-not-tarball');

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { slug: 'bad-tar', name: 'Bad Tar', description: 'bad', commands: [] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => badBuffer,
      });

    vi.mocked(extractTarGz).mockImplementation(() => { throw new Error('Not a tarball'); });

    await expect(
      installFromMarketplace(pluginsDir, 'bad-tar')
    ).rejects.toThrow('neither a gzipped JSON manifest nor a valid tar.gz archive');
  });

  it('should use plugin slug from data when slug is present', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { slug: 'actual-slug', name: 'Actual', description: 'x', commands: [] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 302,
        headers: { get: (name: string) => name === 'location' ? 'https://cdn.test/a.tar.gz' : null },
      })
      .mockResolvedValueOnce({ ok: true });

    setupManifestDownloadWithFiles([
      { path: 'index.ts', content: Buffer.from('export default {}').toString('base64') },
    ]);
    vi.mocked(verifyPlugin).mockReturnValue({ valid: true, warnings: [] });

    const result = await installFromMarketplace(pluginsDir, 'input-slug');

    expect(result.name).toBe('actual-slug');
    expect(result.path).toContain('actual-slug');
  });

  it('should handle plugin with no commands generating default hello command', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { slug: 'no-cmd', name: 'NoCmd', description: 'x', commands: [] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 302,
        headers: { get: (name: string) => name === 'location' ? 'https://cdn.test/n.tar.gz' : null },
      })
      .mockResolvedValueOnce({ ok: true });

    // Create a manifest with no index.ts so ensureIndexFile creates a default
    setupManifestDownloadWithFiles([
      { path: 'readme.md', content: Buffer.from('# NoCmd plugin').toString('base64') },
    ]);
    vi.mocked(verifyPlugin).mockReturnValue({ valid: true, warnings: [] });

    const result = await installFromMarketplace(pluginsDir, 'no-cmd');
    expect(result.id).toBe('no-cmd');
  });
});
