import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = resolve(tmpdir(), 'xbrowser-test-publisher');

vi.mock('../../src/plugin/metadata-parser.js', () => ({
  PluginMetadataParser: {
    extractAuthor: vi.fn((author: unknown) => {
      if (typeof author === 'string') return author;
      if (typeof author === 'object' && author !== null) {
        return (author as { name?: string }).name || 'Unknown';
      }
      return 'Unknown';
    }),
  },
}));

vi.mock('../../src/config.js', () => ({
  NPM_REGISTRY_URL: 'https://registry.npmjs.org',
}));

vi.mock('../../src/utils/json-file.js', () => ({
  readJsonFile: vi.fn((filePath: string, defaultValue: unknown) => {
    try {
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return defaultValue;
    }
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { createTarball } from '../../src/plugin/publisher.js';

describe('publisher', () => {
  let pluginDir: string;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    pluginDir = resolve(TEST_DIR, 'test-plugin');
    mkdirSync(pluginDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  function createPluginFiles(opts: {
    indexContent?: string;
    packageJson?: Record<string, unknown>;
    extraFiles?: Record<string, string>;
  }): void {
    writeFileSync(
      resolve(pluginDir, 'index.ts'),
      opts.indexContent || `export default function(xcli) { xcli.createSite({ name: 'test' }); }`
    );

    if (opts.packageJson) {
      writeFileSync(
        resolve(pluginDir, 'package.json'),
        JSON.stringify(opts.packageJson, null, 2)
      );
    }

    if (opts.extraFiles) {
      for (const [name, content] of Object.entries(opts.extraFiles)) {
        const dir = resolve(pluginDir, name);
        mkdirSync(resolve(pluginDir, name.split('/').slice(0, -1).join('/')), {
          recursive: true,
        });
        writeFileSync(dir, content);
      }
    }
  }

  it('should throw when index.ts is missing', async () => {
    rmSync(resolve(pluginDir, 'index.ts'), { force: true });

    await expect(
      createTarball(pluginDir, { registry: 'http://localhost', token: 'tok' })
    ).rejects.toThrow('No index.ts found');
  });

  it('should throw when no description in package.json or xbrowser', async () => {
    createPluginFiles({});

    await expect(
      createTarball(pluginDir, { registry: 'http://localhost', token: 'tok' })
    ).rejects.toThrow('Plugin must have a description');
  });

  it('should create tarball with package.json description', async () => {
    createPluginFiles({
      packageJson: {
        name: 'my-plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
      },
    });

    const result = await createTarball(pluginDir, {
      registry: 'http://localhost',
      token: 'tok',
    });

    expect(result.name).toBe('my-plugin');
    expect(result.version).toBe('1.0.0');
    expect(result.description).toBe('A test plugin');
    expect(result.slug).toBe('my-plugin');
    expect(result.author).toBe('Test Author');
    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.size).toBeGreaterThan(0);
    expect(result.checksum).toMatch(/^sha256-/);
  });

  it('should use xbrowser metadata over package.json fields', async () => {
    createPluginFiles({
      packageJson: {
        name: 'pkg-name',
        version: '1.0.0',
        description: 'pkg desc',
        author: 'Pkg Author',
        xbrowser: {
          name: 'xb-name',
          version: '2.0.0',
          description: 'xb desc',
          slug: 'custom-slug',
          commands: ['cmd1', 'cmd2'],
          tags: ['tag1'],
          sites: ['https://site.com'],
        },
      },
    });

    const result = await createTarball(pluginDir, {
      registry: 'http://localhost',
      token: 'tok',
    });

    expect(result.name).toBe('xb-name');
    expect(result.version).toBe('2.0.0');
    expect(result.description).toBe('xb desc');
    expect(result.slug).toBe('custom-slug');
    expect(result.commands).toEqual(['cmd1', 'cmd2']);
    expect(result.tags).toEqual(['tag1']);
    expect(result.sites).toEqual(['https://site.com']);
  });

  it('should detect commands from source code', async () => {
    createPluginFiles({
      indexContent: `
        export default function(xcli) {
          const site = xcli.createSite({ name: 'test' });
          site.command('scrape', { handler: async () => {} });
          site.command('extract', { handler: async () => {} });
        }
      `,
      packageJson: {
        name: 'cmd-plugin',
        version: '1.0.0',
        description: 'Command detection test',
      },
    });

    const result = await createTarball(pluginDir, {
      registry: 'http://localhost',
      token: 'tok',
    });

    expect(result.commands).toContain('scrape');
    expect(result.commands).toContain('extract');
  });

  it('should use npm storage and validate package exists', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    createPluginFiles({
      packageJson: {
        name: 'npm-pkg',
        version: '1.0.0',
        description: 'npm publish test',
      },
    });

    const result = await createTarball(pluginDir, {
      registry: 'http://localhost',
      token: 'tok',
      storage: 'npm',
    });

    expect(result.fileCount).toBe(0);
    expect(result.size).toBe(0);
    expect(result.checksum).toBe('npm-managed');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/npm-pkg/1.0.0'
    );
  });

  it('should throw when npm package not found', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    createPluginFiles({
      packageJson: {
        name: 'missing-pkg',
        version: '1.0.0',
        description: 'missing test',
      },
    });

    await expect(
      createTarball(pluginDir, {
        registry: 'http://localhost',
        token: 'tok',
        storage: 'npm',
      })
    ).rejects.toThrow('Package missing-pkg@1.0.0 not found on npm');
  });

  it('should ignore node_modules, .git, .DS_Store, dist, .env files', async () => {
    createPluginFiles({
      packageJson: {
        name: 'ignore-test',
        version: '1.0.0',
        description: 'ignore test',
      },
      extraFiles: {
        'src/main.ts': 'content',
        'node_modules/pkg/index.js': 'ignored',
        '.git/config': 'ignored',
        '.DS_Store': 'ignored',
        'dist/bundle.js': 'ignored',
        '.env': 'ignored',
        '.env.local': 'ignored',
        'debug.log': 'ignored',
      },
    });

    const result = await createTarball(pluginDir, {
      registry: 'http://localhost',
      token: 'tok',
    });

    expect(result.fileCount).toBe(3); // index.ts + package.json + src/main.ts
  });

  it('should set license from xbrowser metadata or package.json', async () => {
    createPluginFiles({
      packageJson: {
        name: 'lic-test',
        version: '1.0.0',
        description: 'license test',
        license: 'MIT',
      },
    });

    const result = await createTarball(pluginDir, {
      registry: 'http://localhost',
      token: 'tok',
    });

    expect(result.slug).toBe('lic-test');
  });

  it('should slugify name correctly', async () => {
    createPluginFiles({
      packageJson: {
        name: '@scope/My Awesome Plugin',
        version: '1.0.0',
        description: 'slugify test',
      },
    });

    const result = await createTarball(pluginDir, {
      registry: 'http://localhost',
      token: 'tok',
    });

    expect(result.slug).toBe('my-awesome-plugin');
  });

  it('should include formData with metadata blob', async () => {
    createPluginFiles({
      packageJson: {
        name: 'fd-test',
        version: '1.0.0',
        description: 'form data test',
        author: 'Tester',
      },
    });

    const result = await createTarball(pluginDir, {
      registry: 'http://localhost',
      token: 'tok',
    });

    expect(result.formData).toBeInstanceOf(FormData);
  });

  it('should default storage to r2', async () => {
    createPluginFiles({
      packageJson: {
        name: 'r2-test',
        version: '1.0.0',
        description: 'r2 storage test',
      },
    });

    const result = await createTarball(pluginDir, {
      registry: 'http://localhost',
      token: 'tok',
    });

    expect(result.checksum).toMatch(/^sha256-/);
    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.size).toBeGreaterThan(0);
  });

  it('should handle author as object', async () => {
    createPluginFiles({
      packageJson: {
        name: 'author-obj',
        version: '1.0.0',
        description: 'author object test',
        author: { name: 'Obj Author', email: 'obj@test.com' },
      },
    });

    const result = await createTarball(pluginDir, {
      registry: 'http://localhost',
      token: 'tok',
    });

    expect(result.author).toBe('Obj Author');
  });
});
