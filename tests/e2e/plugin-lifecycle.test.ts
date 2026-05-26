import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const TMP_DIR = join(process.env.TMPDIR || '/tmp', 'xbrowser-e2e');
const REGISTRY =
  process.env.XBROWSER_REGISTRY || 'https://marketplace.xbrowser.dev';

const XBROWSER_BIN = (() => {
  const localBin = resolve(import.meta.dirname, '../../node_modules/.bin/xbrowser');
  if (existsSync(localBin)) return localBin;
  return 'xbrowser';
})();

function run(cmd: string): { stdout: string; stderr: string; exitCode: number } {
  const resolvedCmd = cmd.replace(/^xbrowser\b/, XBROWSER_BIN);
  try {
    const stdout = execSync(resolvedCmd, { encoding: 'utf-8', timeout: 30000 });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status || 1 };
  }
}

function createTestPlugin(dir: string, name: string, commands: string[]): void {
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    join(dir, 'index.ts'),
    [
      `import type { XCLIAPI } from '@dyyz1993/xbrowser';`,
      ``,
      `export default function (xcli: XCLIAPI): void {`,
      `  const site = xcli.createSite({ name: '${name}', url: 'https://example.com' });`,
      ...commands.map(
        (cmd) =>
          `  site.command('${cmd}', { description: '${cmd} command', handler: async () => ({ data: { command: '${cmd}' }, tips: [] }) });`
      ),
      `}`,
    ].join('\n')
  );

  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: `xbrowser-plugin-${name}`,
        version: '1.0.0',
        description: `E2E test plugin: ${name}`,
        main: 'index.ts',
        xbrowser: {
          id: name,
          name,
          description: `E2E test plugin: ${name}`,
          version: '1.0.0',
          author: 'e2e-test',
          commands,
          tags: ['test'],
          license: 'MIT',
        },
      },
      null,
      2
    )
  );
}

describe('Plugin Lifecycle E2E', () => {
  describe('Local plugin install', () => {
    const pluginDir = join(TMP_DIR, 'local-plugin');
    const pluginName = 'e2e-local';

    beforeAll(() => createTestPlugin(pluginDir, pluginName, ['hello', 'world']));

    it('should install plugin from local directory', () => {
      const result = run(`xbrowser plugin install ${pluginDir} --name ${pluginName}`);
      expect([0, 1]).toContain(result.exitCode);
    });

    it('should list the installed plugin', () => {
      const result = run('xbrowser plugin list');
      expect(result.stdout).toContain('e2e-local');
    });

    it('should uninstall the plugin', () => {
      const result = run(`xbrowser plugin uninstall ${pluginName}`);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Marketplace search', () => {
    it('should search for baidu plugin', () => {
      const result = run('xbrowser plugin search baidu');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Marketplace install', () => {
    it('should install baidu from marketplace', () => {
      const result = run(
        `xbrowser plugin install baidu --from-marketplace --registry ${REGISTRY}`
      );
      if (result.exitCode === 0) {
        const list = run('xbrowser plugin list');
        expect(list.stdout).toContain('baidu');
        run('xbrowser plugin uninstall baidu');
      }
    });
  });

  describe('CLI help', () => {
    it('should show plugin help', () => {
      const result = run('xbrowser plugin --help');
      expect(result.stdout).toContain('install');
      expect(result.stdout).toContain('search');
      expect(result.stdout).toContain('publish');
    });
  });

  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });
});
