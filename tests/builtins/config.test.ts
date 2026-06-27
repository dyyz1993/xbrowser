import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TMP = join(tmpdir(), 'xbrowser-config-test');

describe('config persistence', () => {
  let loadConfig: typeof import('../../src/config.js').loadConfig;
  let saveConfig: typeof import('../../src/config.js').saveConfig;
  let getConfigValue: typeof import('../../src/config.js').getConfigValue;
  let setConfigValue: typeof import('../../src/config.js').setConfigValue;
  let origHome: string | undefined;

  beforeEach(async () => {
    origHome = process.env.HOME;
    process.env.HOME = TMP;
    mkdirSync(TMP, { recursive: true });
    const mod = await import('../../src/config.js');
    loadConfig = mod.loadConfig;
    saveConfig = mod.saveConfig;
    getConfigValue = mod.getConfigValue;
    setConfigValue = mod.setConfigValue;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(TMP, { recursive: true, force: true });
  });

  it('returns empty object when no config file exists', () => {
    const config = loadConfig();
    expect(config).toEqual({});
  });

  it('saves and loads config', () => {
    saveConfig({ 'browser.executablePath': '/usr/bin/chromium' });
    const config = loadConfig();
    expect(config['browser.executablePath']).toBe('/usr/bin/chromium');
  });

  it('getConfigValue returns value for existing key', () => {
    saveConfig({ port: 9222 });
    expect(getConfigValue('port')).toBe(9222);
  });

  it('getConfigValue returns undefined for missing key', () => {
    expect(getConfigValue('nonexistent')).toBeUndefined();
  });

  it('setConfigValue adds new key', () => {
    saveConfig({ existing: 'value' });
    setConfigValue('newKey', 'newValue');
    const config = loadConfig();
    expect(config.existing).toBe('value');
    expect(config.newKey).toBe('newValue');
  });

  it('setConfigValue overwrites existing key', () => {
    setConfigValue('key', 'old');
    setConfigValue('key', 'new');
    expect(getConfigValue('key')).toBe('new');
  });

  it('persists to disk as JSON', () => {
    setConfigValue('daemon.port', 8080);
    const file = join(TMP, '.xbrowser', 'config.json');
    expect(existsSync(file)).toBe(true);
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    expect(data.daemon?.port).toBe(8080);
  });

  it('preserves existing keys when setting new ones', () => {
    setConfigValue('a', 1);
    setConfigValue('b', 2);
    const config = loadConfig();
    expect(config.a).toBe(1);
    expect(config.b).toBe(2);
  });
});

describe('config builtin', () => {
  let origHome: string | undefined;
  const TMP2 = join(tmpdir(), 'xbrowser-config-builtin-test');

  beforeEach(() => {
    origHome = process.env.HOME;
    process.env.HOME = TMP2;
    mkdirSync(TMP2, { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(TMP2, { recursive: true, force: true });
  });

  it('config list shows empty when no config', async () => {
    const { configBuiltin } = await import('../../src/builtins/config.js');
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    await configBuiltin.execute(['list'], {}, { cwd: process.cwd() });
    console.log = origLog;
    expect(logs[0]).toContain('empty');
  });

  it('config set persists and config get retrieves', async () => {
    const { configBuiltin } = await import('../../src/builtins/config.js');

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    await configBuiltin.execute(['set', 'browser.testKey', 'test-value'], {}, { cwd: process.cwd() });
    console.log = origLog;
    expect(logs[0]).toContain('browser.testKey = test-value');

    const getLogs: string[] = [];
    console.log = (...args: unknown[]) => getLogs.push(args.join(' '));
    await configBuiltin.execute(['get', 'browser.testKey'], {}, { cwd: process.cwd() });
    console.log = origLog;
    expect(getLogs[0]).toContain('test-value');
  });

  it('config set rejects unknown key outside known namespaces', async () => {
    const { configBuiltin } = await import('../../src/builtins/config.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(' '));

    await expect(
      configBuiltin.execute(['set', 'hello', 'world'], {}, { cwd: process.cwd() })
    ).rejects.toThrow('exit');

    console.error = origErr;
    exitSpy.mockRestore();
    expect(errors.some(e => e.includes('Unknown config key: "hello"'))).toBe(true);

    // Must NOT be persisted
    const { getConfigValue } = await import('../../src/config.js');
    expect(getConfigValue('hello')).toBeUndefined();
  });

  it('config set accepts unknown key under known namespace (browser.*)', async () => {
    const { configBuiltin } = await import('../../src/builtins/config.js');
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    await configBuiltin.execute(['set', 'browser.customArg', '--foo'], {}, { cwd: process.cwd() });
    console.log = origLog;
    expect(logs[0]).toContain('browser.customArg = --foo');
  });

  it('config get shows (not set) for missing key', async () => {
    const { configBuiltin } = await import('../../src/builtins/config.js');
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    await configBuiltin.execute(['get', 'missing.key'], {}, { cwd: process.cwd() });
    console.log = origLog;
    expect(logs[0]).toContain('(not set)');
  });

  it('config list shows values when config exists', async () => {
    const { configBuiltin } = await import('../../src/builtins/config.js');
    const { setConfigValue } = await import('../../src/config.js');
    setConfigValue('browser.path', '/usr/bin/chromium');
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    await configBuiltin.execute(['list'], {}, { cwd: process.cwd() });
    console.log = origLog;
    expect(logs.some(l => l.includes('browser.path'))).toBe(true);
    expect(logs.some(l => l.includes('/usr/bin/chromium'))).toBe(true);
  });

  it('config with no subcommand acts as list', async () => {
    const { configBuiltin } = await import('../../src/builtins/config.js');
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    await configBuiltin.execute([], {}, { cwd: process.cwd() });
    console.log = origLog;
    expect(logs.some(l => l.includes('empty') || l.includes('Configuration'))).toBe(true);
  });

  it('config set without value shows error', async () => {
    const { configBuiltin } = await import('../../src/builtins/config.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(' '));
    await expect(configBuiltin.execute(['set', 'key'], {}, { cwd: process.cwd() })).rejects.toThrow('exit');
    console.error = origErr;
    exitSpy.mockRestore();
    expect(errors.some(e => e.includes('Usage'))).toBe(true);
  });

  it('config with unknown subcommand shows error', async () => {
    const { configBuiltin } = await import('../../src/builtins/config.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(' '));
    await expect(configBuiltin.execute(['badcmd'], {}, { cwd: process.cwd() })).rejects.toThrow('exit');
    console.error = origErr;
    exitSpy.mockRestore();
    expect(errors.some(e => e.includes('Unknown subcommand'))).toBe(true);
  });

  it('config get without key shows error', async () => {
    const { configBuiltin } = await import('../../src/builtins/config.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(' '));
    await expect(configBuiltin.execute(['get'], {}, { cwd: process.cwd() })).rejects.toThrow('exit');
    console.error = origErr;
    exitSpy.mockRestore();
    expect(errors.some(e => e.includes('Usage'))).toBe(true);
  });
});
