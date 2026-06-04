import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';

vi.mock('../../src/client/daemon-client.js', () => ({
  isDaemonRunning: vi.fn().mockResolvedValue(false),
  forwardExec: vi.fn(),
  forwardChain: vi.fn(),
}));
vi.mock('../../src/daemon/daemon.js', () => ({
  startDaemonProcess: vi.fn().mockRejectedValue(new Error('no daemon')),
  stopDaemonProcess: vi.fn(),
  getDaemonProcessStatus: vi.fn(),
}));

const playwrightChromiumPath = '/Users/xuyingzhou/Library/Caches/ms-playwright/chromium_headless_shell-1217';
const playwrightExecutablePath = `${playwrightChromiumPath}/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const e2eAvailable = process.env.XBROWSER_RUN_REAL_E2E === '1' && fs.existsSync(playwrightExecutablePath);
const describeE2E = e2eAvailable ? describe : describe.skip;

import {
  closeSessionByName,
  createSession,
  destroyBrowser,
  executeCommand,
  resetForTesting,
} from '../../src/index.js';
import type { AgentObservation, AgentTarget } from '../../src/runtime/types.js';

const TEST_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Agent Loop Fixture</title></head>
  <body>
    <main>
      <h1>Agent Loop</h1>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" aria-label="Email" />
      <button id="submit" type="button">Submit</button>
      <button id="reset" type="button">Reset</button>
      <p id="status">Idle</p>
    </main>
    <script>
      const email = document.querySelector('#email');
      const status = document.querySelector('#status');
      document.querySelector('#submit').addEventListener('click', () => {
        status.textContent = email.value ? 'Done: ' + email.value : 'Missing email';
      });
      document.querySelector('#reset').addEventListener('click', () => {
        email.value = '';
        status.textContent = 'Reset done';
      });
    </script>
  </body>
</html>`;

function targetBy(observation: AgentObservation, predicate: (target: AgentTarget) => boolean): AgentTarget {
  const target = observation.targets.find(predicate);
  if (!target) {
    throw new Error(`Target not found in observation: ${observation.compact || JSON.stringify(observation.targets)}`);
  }
  return target;
}

describeE2E('E2E: default-session agent loop', () => {
  beforeAll(async () => {
    await closeSessionByName('default').catch(() => false);
    const session = await createSession('default', undefined, {
      executablePath: playwrightExecutablePath,
      headless: true,
    });
    await session.page.setContent(TEST_HTML, { waitUntil: 'domcontentloaded' });
  }, 30000);

  afterAll(async () => {
    await closeSessionByName('default');
    await destroyBrowser();
    resetForTesting();
  });

  it('runs snapshot refs, ref actions, waitFor, and semantic find on the default session', async () => {
    const snapshot = await executeCommand('snapshot', {
      i: true,
      selectors: true,
      compact: true,
    });
    expect(snapshot.success).toBe(true);

    const observation = snapshot.data as AgentObservation;
    expect(observation.compact).toContain('@e');
    expect(observation.selectors).toBeDefined();

    const email = targetBy(observation, (target) => target.role === 'textbox' && target.name === 'Email');
    const submit = targetBy(observation, (target) => target.role === 'button' && target.name === 'Submit');

    const fill = await executeCommand('fill', {
      selector: `@${email.ref}`,
      value: 'agent@example.com',
    });
    expect(fill.success).toBe(true);

    const click = await executeCommand('click', {
      selector: `@${submit.ref}`,
    });
    expect(click.success).toBe(true);

    const wait = await executeCommand('waitFor', {
      text: 'Done: agent@example.com',
      timeout: 3000,
    });
    expect(wait.success).toBe(true);

    const find = await executeCommand('find', {
      strategy: 'role',
      value: 'button',
      name: 'Reset',
      operation: 'click',
      exact: false,
      timeout: 3000,
    });
    expect(find.success).toBe(true);

    const resetWait = await executeCommand('waitFor', {
      text: 'Reset done',
      timeout: 3000,
    });
    expect(resetWait.success).toBe(true);
  }, 30000);
});
