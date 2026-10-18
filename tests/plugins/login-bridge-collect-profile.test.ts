import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = new URL('../../.xcli/plugins/login-bridge/collect-profile.sh', import.meta.url).pathname;

describe('login-bridge collector launcher', () => {
  it('builds the profile under Default and launches a detached collector', () => {
    expect(existsSync(script)).toBe(true);
    const source = readFileSync(script, 'utf8');
    expect(source).toContain('Default');
    expect(source).not.toContain('cp "$HOME/Library/Application Support/Google/Chrome/Local State"');
    expect(source).toContain('--remote-debugging-port="$PORT"');
    expect(source).toContain('chrome-collect-profile');
    expect(source).toContain('XBROWSER_HUMANIZE_CDP=${XBROWSER_HUMANIZE_CDP:-on}');
  });

  it('starts and reports the collector endpoint', () => {
    const chromiumCandidates = [
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];
    if (!chromiumCandidates.some((candidate) => existsSync(candidate))) {
      console.warn('Skipping collector launch: no local Chromium/Chrome');
      return;
    }
    const output = execFileSync('/bin/sh', [script, '9445'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(output).toContain('collector');
    expect(output).toContain('9445');
  });
});
