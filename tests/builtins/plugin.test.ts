import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = resolve(tmpdir(), 'xbrowser-test-builtins');

describe('Plugin Builtins', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should export plugin install builtin', async () => {
    const { pluginInstallBuiltin } = await import('../../src/builtins/plugin.js');
    expect(pluginInstallBuiltin).toBeDefined();
    expect(pluginInstallBuiltin.name).toBe('plugin install');
    expect(typeof pluginInstallBuiltin.execute).toBe('function');
  });

  it('should export plugin uninstall builtin', async () => {
    const { pluginUninstallBuiltin } = await import('../../src/builtins/plugin.js');
    expect(pluginUninstallBuiltin).toBeDefined();
    expect(pluginUninstallBuiltin.name).toBe('plugin uninstall');
  });

  it('should export plugin list builtin', async () => {
    const { pluginListBuiltin } = await import('../../src/builtins/plugin.js');
    expect(pluginListBuiltin).toBeDefined();
    expect(pluginListBuiltin.name).toBe('plugin list');
  });

  it('should export plugin reload builtin', async () => {
    const { pluginReloadBuiltin } = await import('../../src/builtins/plugin.js');
    expect(pluginReloadBuiltin).toBeDefined();
    expect(pluginReloadBuiltin.name).toBe('plugin reload');
  });

  it('should export handlePluginHelp', async () => {
    const { handlePluginHelp } = await import('../../src/builtins/plugin.js');
    const help = handlePluginHelp();
    expect(help).toContain('install');
    expect(help).toContain('uninstall');
    expect(help).toContain('list');
    expect(help).toContain('reload');
  });
});

describe('Create Builtin', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should export create builtin', async () => {
    const { createBuiltin } = await import('../../src/builtins/create.js');
    expect(createBuiltin).toBeDefined();
    expect(createBuiltin.name).toBe('create');
    expect(typeof createBuiltin.execute).toBe('function');
  });

  it('should list available templates', async () => {
    const { listTemplates } = await import('../../src/builtins/create.js');
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThan(0);
    const names = templates.map((t) => t.name);
    expect(names).toContain('static');
    expect(names).toContain('dynamic');
    expect(names).toContain('login');
    expect(names).toContain('api');
  });

  it('should create plugin from static template', async () => {
    const { createBuiltin } = await import('../../src/builtins/create.js');
    const originalExit = process.exit;
    const exitMock = vi.fn();
    process.exit = exitMock as never;

    await createBuiltin.execute(['test-plugin'], { template: 'static' }, { cwd: TEST_DIR });

    process.exit = originalExit;
    expect(exitMock).not.toHaveBeenCalled();
    expect(existsSync(resolve(TEST_DIR, 'test-plugin', 'index.ts'))).toBe(true);
    expect(existsSync(resolve(TEST_DIR, 'test-plugin', 'package.json'))).toBe(true);
  });

  it('should create plugin from api template', async () => {
    const { createBuiltin } = await import('../../src/builtins/create.js');
    const originalExit = process.exit;
    const exitMock = vi.fn();
    process.exit = exitMock as never;

    await createBuiltin.execute(['my-api'], { template: 'api' }, { cwd: TEST_DIR });

    process.exit = originalExit;
    expect(existsSync(resolve(TEST_DIR, 'my-api', 'index.ts'))).toBe(true);
  });

  it('should reject unknown template', async () => {
    const { createBuiltin } = await import('../../src/builtins/create.js');
    const originalExit = process.exit;
    const exitMock = vi.fn((code: number) => {
      throw new Error(`Exit ${code}`);
    });
    process.exit = exitMock as never;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      createBuiltin.execute(['bad'], { template: 'nonexistent' }, { cwd: TEST_DIR })
    ).rejects.toThrow();

    process.exit = originalExit;
    errorSpy.mockRestore();
  });
});

describe('All Builtins', () => {
  it('should include all new builtins', async () => {
    const { allBuiltins } = await import('../../src/builtins/index.js');
    const names = allBuiltins.map((b) => b.name);
    expect(names).toContain('plugin install');
    expect(names).toContain('plugin uninstall');
    expect(names).toContain('plugin list');
    expect(names).toContain('plugin reload');
    expect(names).toContain('create');
  });
});
