import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../lint-scripts/check-media-constraints.mjs', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const tempRoot = mkdtempSync(join(tmpdir(), 'media-constraints-'));

function makeFixture(modify?: { pluginFile?: string; source?: string; baselineDebt?: string[] }) {
  const root = join(tempRoot, Math.random().toString(36).slice(2));
  mkdirSync(root, { recursive: true });
  cpSync(join(repoRoot, 'lint-scripts'), join(root, 'lint-scripts'), { recursive: true });
  mkdirSync(join(root, '.xcli/plugins'), { recursive: true });
  cpSync(join(repoRoot, '.xcli/plugins/gemini'), join(root, '.xcli/plugins/gemini'), {
    recursive: true,
    filter: (source) => !source.includes('node_modules'),
  });

  const pluginFile = join(root, '.xcli/plugins/gemini', modify?.pluginFile || 'music.ts');
  if (modify?.source) writeFileSync(pluginFile, modify.source);
  if (modify?.baselineDebt) {
    writeFileSync(join(root, 'lint-scripts/media-constraints-baseline.json'), JSON.stringify({ debt: modify.baselineDebt }));
  }
  return root;
}

function run(root: string, flags: string[] = [], options: { plugins?: string } = {}) {
  return spawnSync(process.execPath, [script, ...flags], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      MEDIA_CONSTRAINTS_ROOT: root,
      ...(options.plugins ? { MEDIA_CONSTRAINTS_PLUGINS: options.plugins } : {}),
    },
  });
}

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('media generation constraints', () => {
  it('passes the current locked repository state', () => {
    const result = run(repoRoot);
    expect(result.stdout).toContain('Media generation constraints passed');
    expect(result.status).toBe(0);
  });

  it('fails when protected media is downloaded without browser credentials', () => {
    const baseline = JSON.parse(readFileSync(
      join(repoRoot, 'lint-scripts/media-constraints-baseline.json'),
      'utf8',
    )) as { debt: string[] };
    const source = readFileSync(join(repoRoot, '.xcli/plugins/gemini/music.ts'), 'utf8')
      .replaceAll("await fetch(${JSON.stringify(mediaSource)}, { credentials: 'include' })", 'await globalThis.fetch(mediaSource)');

    const root = makeFixture({
      source,
      baselineDebt: baseline.debt.filter((item) => !item.includes('.xcli/plugins/gemini/music.ts')),
    });
    const result = run(root, [], { plugins: 'gemini' });
    expect(result.stderr).toMatch(/new debt: DOWNLOAD:.*gemini\/music\.ts.*media download lacks browser credentials/);
    expect(result.status).toBe(1);
  });

  it('blocks a new DOM click but locks existing click debt', () => {
    const existing = readFileSync(join(repoRoot, 'lint-scripts/media-constraints-baseline.json'), 'utf8');
    const baseline = JSON.parse(existing) as { debt: string[] };
    const root = makeFixture({
      pluginFile: 'new.ts',
      source: 'export const bad = () => { target.click(); return true; };\n',
      baselineDebt: baseline.debt,
    });
    const result = run(root);

    expect(result.stderr).toContain('critical UI uses DOM click()');
    expect(result.status).toBe(1);
  });

  it('blocks a media result contract that loses traceability fields', () => {
    const baseline = JSON.parse(readFileSync(
      join(repoRoot, 'lint-scripts/media-constraints-baseline.json'),
      'utf8',
    )) as { debt: string[] };
    const root = makeFixture({ baselineDebt: baseline.debt.filter((item) => !item.startsWith('DEBT:RESULT:gemini.music') && !item.startsWith('DOWNLOAD:.xcli/plugins/gemini/music.ts')) });
    const result = run(root, ['--update'], { plugins: 'gemini' });
    expect(readFileSync(join(root, 'lint-scripts/media-constraints-baseline.json'), 'utf8')).not.toContain('DEBT:RESULT:gemini.music');

    expect(result.status).toBe(0);
  });
});
