import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../lint-scripts/check-mistakes.mjs', import.meta.url));

describe('check-mistakes lint script', () => {
  it('passes when no constrained mistakes exist', () => {
    const previousHome = process.env.HOME;
    const home = mkdtempHome('mistakes-empty-');
    process.env.HOME = home;
    try {
      const result = runScript();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('No constrained repeated mistakes');
    } finally {
      process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('fails and reports mistakes constrained by the third repeated failure', () => {
    const previousHome = process.env.HOME;
    const home = mkdtempHome('mistakes-constrained-');
    process.env.HOME = home;
    try {
      const ledgerPath = join(home, '.xbrowser', 'knowledge', 'mistakes.json');
      mkdirSync(join(ledgerPath, '..'), { recursive: true });
      writeFileSync(ledgerPath, JSON.stringify({
        version: 1,
        entries: {
          'RETRYABLE: selector-not-found::selector #buy not found': {
            fingerprint: 'RETRYABLE: selector-not-found::selector #buy not found',
            category: 'RETRYABLE: selector-not-found',
            firstSeen: '2026-10-13T00:00:00.000Z',
            lastSeen: '2026-10-15T00:00:00.000Z',
            occurrences: [
              { timestamp: '2026-10-13T00:00:00.000Z', command: 'click', message: 'selector #buy not found' },
              { timestamp: '2026-10-14T00:00:00.000Z', command: 'click', message: 'selector #buy not found' },
              { timestamp: '2026-10-15T00:00:00.000Z', command: 'click', message: 'selector #buy not found' },
            ],
            constrained: true,
          },
        },
      }));

      const result = runScript();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Constrained repeated mistakes (1)');
      expect(result.stderr).toContain('selector #buy not found');
      expect(result.stderr).toContain('command=click occurrences=3');
    } finally {
      process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

function mkdtempHome(prefix: string): string {
  return join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function runScript() {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env },
  });
}
