import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';

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

const chromiumExecutablePath = '/Applications/Chromium.app/Contents/MacOS/Chromium';
const e2eAvailable = process.env.XBROWSER_RUN_REAL_E2E === '1' && fs.existsSync(chromiumExecutablePath);
const describeE2E = e2eAvailable ? describe : describe.skip;

import {
  closeSessionByName,
  createSession,
  destroyBrowser,
  findSession,
  resetForTesting,
  type ManagedSession,
} from '../../src/index.js';
import { setActivePage } from '../../src/browser.js';
import { WSServer } from '../../src/websocket-server.js';
import { previewHTML } from '../../src/daemon/preview-templates.js';
import { HumanInteractionManager, isHumanWaitActive } from '../../src/human-interaction.js';
import type { WorkspaceStateMessage } from '../../src/ws/workspace-controller.js';
import type { Page, BrowserContext } from '../../src/browser-shim.js';
import type { WaitForHumanResult } from '../../src/human-interaction.js';
import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// E2E: viewer browser workspace (toolbar tabs / Go-Back-Forward / human
// handoff) — real headless Chromium + isolated loopback HTTP+WS server.
//
// Topology (mirrors production: the viewer always runs in the *user's* browser,
// never inside the session's own context):
//   session browser (Chromium headless, self-launched)
//   ├── session context ── pages the workspace toolbar manages (alpha/beta…)
//   └── viewer context  ── the preview UI page (not part of tab lists)
// ---------------------------------------------------------------------------

const outputDir = path.resolve('output/viewer-workspace-e2e');
const sessionName = `viewer-workspace-e2e-${Date.now()}`;

const ALPHA_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Alpha Page</title>
<style>
html,body{margin:0;height:100%}
body{display:flex;align-items:center;justify-content:center;background:#e9edf2;font-family:system-ui;color:#222}
#target{width:72%;height:58%;font-size:26px;background:#2b6cb0;color:#fff;border:6px solid #1a365d;border-radius:16px}
#state{position:fixed;top:8px;left:10px;font:13px/1.4 monospace;background:#fff;border:1px solid #99a;padding:4px 8px}
</style></head>
<body>
<span id="state">clicks=0 button=0 keys=0</span>
<button id="target" type="button">DO NOT CLICK</button>
<script>
window.__clicks=0;window.__buttonClicks=0;window.__keysDown=0;window.__keysUp=0;
function update(){var s=document.getElementById('state');if(s){s.textContent='clicks='+window.__clicks+' button='+window.__buttonClicks+' keys='+(window.__keysDown+window.__keysUp);}}
document.addEventListener('click',function(){window.__clicks++;update();},true);
document.addEventListener('keydown',function(){window.__keysDown++;update();},true);
document.addEventListener('keyup',function(){window.__keysUp++;update();},true);
document.getElementById('target').addEventListener('click',function(){window.__buttonClicks++;update();});
</script>
</body></html>`;

const BETA_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Beta Page</title>
<style>body{font-family:system-ui;margin:40px;background:#f7f2e8}h1{color:#744210}</style></head>
<body><h1>Beta</h1><p><a id="to-alpha" href="./alpha.html">back to alpha</a></p></body></html>`;

describeE2E('E2E: viewer browser workspace toolbar, tabs and handoff', () => {
  let session: ManagedSession;
  let server: WSServer;
  let httpServer: Server;
  let viewerPort: number;
  let viewerContext: BrowserContext;
  let ws: WebSocket;
  const states: WorkspaceStateMessage[] = [];

  function activeSessionPage(): Page {
    const current = findSession(sessionName);
    if (!current) throw new Error('managed session vanished');
    return current.page;
  }

  async function waitForState(
    predicate: (state: WorkspaceStateMessage) => boolean,
    timeoutMs = 15_000,
    sinceIndex = 0,
  ): Promise<WorkspaceStateMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = states.slice(sinceIndex).find(predicate);
      if (hit) return hit;
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for workspace_state; captured states: ${JSON.stringify(states.slice(-6))}`,
        );
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  /** Waits until the rendered toolbar shows exactly n tabs. */
  function waitForTabCount(viewer: Page, count: number, timeoutMs = 15_000): Promise<void> {
    return viewer.waitForFunction(
      (count: number) => document.querySelectorAll('.workspace-tab').length === count,
      { timeout: timeoutMs, polling: 200 },
      count,
    );
  }

  /**
   * Navigate the viewer UI page. The goto's load-state wait is best-effort:
   * real readiness is gated by polling for the workspace tab bar below, so a
   * missed load event on the wrapper cannot fail the test on its own.
   */
  async function gotoViewer(viewer: Page, url: string): Promise<void> {
    await viewer.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(err => {
      console.log(`[viewer goto best-effort] ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  async function openViewer(): Promise<Page> {
    const viewer = await viewerContext.newPage();
    await viewer.setViewportSize({ width: 1280, height: 900 });
    await gotoViewer(viewer, `http://127.0.0.1:${viewerPort}/preview/${sessionName}`);
    await viewer.waitForSelector('.workspace-tab', { state: 'visible', timeout: 15_000 });
    return viewer;
  }

  /**
   * Clicks a toolbar control whose DOM node lives inside the tab list. Every
   * workspace_state re-render replaces those nodes, so a resolved locator can
   * go stale before the click lands — re-resolve and retry until the expected
   * state broadcast actually arrives.
   */
  async function clickToolbarUntilState(
    viewer: Page,
    selector: string,
    predicate: (state: WorkspaceStateMessage) => boolean,
    attempts = 6,
  ): Promise<WorkspaceStateMessage> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const mark = states.length;
      await viewer.locator(selector).click({ timeout: 5_000 }).catch(err => {
        lastError = err;
      });
      try {
        return await waitForState(predicate, 4_000, mark);
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(
      `Toolbar click on "${selector}" never produced the expected state after ${attempts} attempts; ` +
      `last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  function waitForStatusText(viewer: Page, expected: string, timeoutMs = 15_000): Promise<void> {
    return viewer.waitForFunction(
      (expected: string) => document.querySelector('#workspace-status-text')?.textContent === expected,
      { timeout: timeoutMs, polling: 200 },
      expected,
    );
  }

  function waitForActiveTab(viewer: Page, label: string, timeoutMs = 15_000): Promise<void> {
    return viewer.waitForFunction(
      (label: string) =>
        document.querySelector('.workspace-tab.active .workspace-tab-select')?.textContent?.trim() === label,
      { timeout: timeoutMs, polling: 200 },
      label,
    );
  }

  function waitForAddress(viewer: Page, includes: string, timeoutMs = 15_000): Promise<void> {
    return viewer.waitForFunction(
      (includes: string) =>
        ((document.querySelector('#workspace-address') as HTMLInputElement | null)?.value || '').includes(includes),
      { timeout: timeoutMs, polling: 200 },
      includes,
    );
  }

  async function gotoViaAddress(viewer: Page, url: string): Promise<void> {
    const address = viewer.locator('#workspace-address');
    await address.click({ timeout: 5_000 });
    await address.fill(url, { timeout: 5_000 });
    await viewer.keyboard.press('Enter');
  }

  async function assertNoWorkspaceError(viewer: Page): Promise<void> {
    const errorState = await viewer.evaluate<{ hidden: boolean; text: string }>(() => {
      const el = document.querySelector('#workspace-error') as HTMLElement | null;
      return { hidden: el ? el.hidden : true, text: el?.textContent ?? '' };
    });
    expect(errorState.hidden).toBe(true);
    expect(errorState.text).toBe('');
  }

  /**
   * Asserts the session's live document as the toolbar itself sees it: the
   * context registry (`context.pages()`) is the exact source `workspace_state`
   * is built from, so it is the right truth for "did the session navigate".
   */
  async function waitForRemoteTitle(includes: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    for (;;) {
      const titles: string[] = [];
      for (const page of session.context.pages()) {
        titles.push(await page.title().catch(() => ''));
      }
      last = titles.join(' | ');
      if (titles.some(title => title.includes(includes))) return;
      if (Date.now() > deadline) {
        throw new Error(`No session tab title ever included "${includes}"; tabs: ${last}`);
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  async function remoteClickCounters(): Promise<{ clicks: number; button: number; keysDown: number; keysUp: number }> {
    return activeSessionPage().evaluate<{ clicks: number; button: number; keysDown: number; keysUp: number }>(() => {
      const w = window as unknown as {
        __clicks?: number; __buttonClicks?: number; __keysDown?: number; __keysUp?: number;
      };
      return {
        clicks: w.__clicks ?? -1,
        button: w.__buttonClicks ?? -1,
        keysDown: w.__keysDown ?? -1,
        keysUp: w.__keysUp ?? -1,
      };
    });
  }

  beforeAll(async () => {
    process.env.XBROWSER_AUTO_OPEN = 'false';
    fs.mkdirSync(outputDir, { recursive: true });

    httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      const urlPath = (req.url || '/').replace(/\?.*$/, '');
      if (urlPath === '/preview' || urlPath.startsWith('/preview/')) {
        const targetSession = urlPath.replace(/^\/preview\/?/, '').replace(/\/+$/, '') || 'default';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(previewHTML(targetSession, req.headers.host || '127.0.0.1'));
        return;
      }
      if (urlPath === '/alpha.html' || urlPath === '/beta.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(urlPath === '/alpha.html' ? ALPHA_HTML : BETA_HTML);
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
    });
    viewerPort = await new Promise<number>((resolve, reject) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const address = httpServer.address();
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Failed to bind loopback HTTP server'));
      });
      httpServer.on('error', reject);
    });

    const baseUrl = `http://127.0.0.1:${viewerPort}`;
    fs.writeFileSync(path.join(outputDir, 'alpha.html'), ALPHA_HTML);
    fs.writeFileSync(path.join(outputDir, 'beta.html'), BETA_HTML);

    session = await createSession(sessionName, `${baseUrl}/alpha.html`, {
      executablePath: chromiumExecutablePath,
      headless: true,
    });

    server = new WSServer({ port: 0 });
    server.registerSession(sessionName, session.page);
    await server.attachToServer(httpServer, '/preview');
    // Same ownership wiring as daemon-main.ts: self-launched session → full control.
    server.setWorkspaceSessionResolver(sessionId => {
      const current = findSession(sessionId);
      if (!current) return undefined;
      if (current.isCDP || current.bridge) {
        return { page: current.page, context: null, managed: false };
      }
      return {
        page: current.page,
        context: current.context,
        managed: true,
        setActivePage: page => setActivePage(current, page),
      };
    });
    server.setWorkspaceHandoffProbe(sid => isHumanWaitActive(server, sid));

    // The viewer UI must live outside the session context (like a real user's
    // browser) or it would show up in the workspace tab list.
    viewerContext = await session.browser.newContext();

    ws = new WebSocket(`ws://127.0.0.1:${viewerPort}/preview/${sessionName}`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.on('message', raw => {
      // Text frames carry JSON control messages; binary screencast frames are ignored.
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : '';
      if (!text) return;
      try {
        const message = JSON.parse(text) as { type?: string };
        if (message.type === 'workspace_state') {
          states.push(message as WorkspaceStateMessage);
          fs.writeFileSync(path.join(outputDir, 'ws-states.json'), JSON.stringify(states, null, 2));
        }
      } catch {
        // Ignore malformed frames.
      }
    });
    // workspace_request replies go ONLY to the requester, so the observer
    // asks for the initial state explicitly (mutations still broadcast).
    ws.send(JSON.stringify({ type: 'workspace_request' }));
  }, 45_000);

  afterAll(async () => {
    ws?.close();
    await server?.stop().catch(() => undefined);
    (httpServer as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    httpServer?.close();
    server?.unregisterSession(sessionName);
    await viewerContext?.close().catch(() => undefined);
    await closeSessionByName(sessionName);
    await destroyBrowser();
    resetForTesting();
  });

  it('renders session tabs in the toolbar and navigates Go, Back, Forward', async () => {
    const viewer = await openViewer();
    const baseUrl = `http://127.0.0.1:${viewerPort}`;

    await waitForStatusText(viewer, '已连接');
    await waitForActiveTab(viewer, 'Alpha Page');
    await waitForAddress(viewer, '/alpha.html');
    // Navigation controls unlock once the managed tab state arrives.
    await viewer.waitForFunction(
      () => {
        const back = document.querySelector('[data-workspace-history="back"]') as HTMLButtonElement | null;
        const address = document.querySelector('#workspace-address') as HTMLInputElement | null;
        return !!back && !back.disabled && !!address && !address.readOnly;
      },
      { timeout: 15_000 },
    );
    const firstState = await waitForState(state => state.tabs.length === 1);
    expect(firstState.sessionId).toBe(sessionName);
    expect(firstState.tabs[0]?.url).toContain('/alpha.html');
    expect(firstState.tabs[0]?.title).toBe('Alpha Page');
    fs.writeFileSync(
      path.join(outputDir, 'viewer-state-initial.json'),
      JSON.stringify(firstState, null, 2),
    );
    fs.writeFileSync(path.join(outputDir, 'toolbar-initial.png'), await viewer.screenshot({ type: 'png' }));

    // Address-submit must not leak the viewer's Enter key to the remote page:
    // a hash-only navigation keeps the same document, so the fixture's key
    // counters survive the submit and would catch a forwarded keydown/keyup.
    await gotoViaAddress(viewer, `${baseUrl}/alpha.html#leak-check`);
    await waitForAddress(viewer, '#leak-check');
    expect(await remoteClickCounters()).toEqual({ clicks: 0, button: 0, keysDown: 0, keysUp: 0 });

    // Go: address bar → beta
    await gotoViaAddress(viewer, `${baseUrl}/beta.html`);
    await waitForActiveTab(viewer, 'Beta Page');
    await waitForAddress(viewer, '/beta.html');
    await waitForRemoteTitle('Beta Page');
    await waitForState(state => state.tabs.length === 1 && state.tabs[0]?.url.includes('/beta.html'));

    // Back → alpha
    await viewer.locator('[data-workspace-history="back"]').click({ timeout: 5_000 });
    await waitForActiveTab(viewer, 'Alpha Page');
    await waitForAddress(viewer, '/alpha.html');
    await waitForRemoteTitle('Alpha Page');

    // Forward → beta again
    await viewer.locator('[data-workspace-history="forward"]').click({ timeout: 5_000 });
    await waitForActiveTab(viewer, 'Beta Page');
    await waitForRemoteTitle('Beta Page');

    await assertNoWorkspaceError(viewer);
    await viewer.close();
  }, 60_000);

  it('toolbar creates, selects and closes named session tabs', async () => {
    const baseUrl = `http://127.0.0.1:${viewerPort}`;
    const viewer = await openViewer();
    await waitForStatusText(viewer, '已连接');
    await waitForActiveTab(viewer, 'Beta Page');

    // New tab lands on about:blank, becomes active, clears the address bar.
    let mark = states.length;
    await viewer.locator('#workspace-new').click({ timeout: 5_000 });
    await waitForActiveTab(viewer, '新标签页');
    await waitForState(state => state.tabs.length === 2 && state.activeIndex === 1, 15_000, mark);
    await waitForTabCount(viewer, 2);
    expect(activeSessionPage().url()).toBe('about:blank');
    await viewer.waitForFunction(
      () => (document.querySelector('#workspace-address') as HTMLInputElement | null)?.value === '',
      { timeout: 10_000 },
    );

    // Navigate the second tab to alpha so both tabs have distinct names.
    mark = states.length;
    await gotoViaAddress(viewer, `${baseUrl}/alpha.html`);
    await waitForActiveTab(viewer, 'Alpha Page');
    await waitForState(state => state.tabs.length === 2 && state.tabs[1]?.url.includes('/alpha.html'), 15_000, mark);
    fs.writeFileSync(path.join(outputDir, 'toolbar-two-tabs.png'), await viewer.screenshot({ type: 'png' }));

    // Select the first tab by clicking its title (querySelector → first match).
    await clickToolbarUntilState(
      viewer,
      '.workspace-tab-select',
      state => state.tabs.length === 2 && state.activeIndex === 0,
    );
    await waitForActiveTab(viewer, 'Beta Page');
    await waitForRemoteTitle('Beta Page');
    // Cross-layer identity: the CLI session's active page IS the selected tab.
    expect(findSession(sessionName)?.page).toBe(session.context.pages()[0]);

    // Close the inactive tab by its accessible name.
    await clickToolbarUntilState(
      viewer,
      '[aria-label="关闭 Alpha Page"]',
      state => state.tabs.length === 1 && state.tabs[0]?.url.includes('/beta.html'),
    );
    await waitForTabCount(viewer, 1);
    await waitForActiveTab(viewer, 'Beta Page');
    // With a single tab left, close buttons disappear.
    expect(await viewer.locator('.workspace-tab .workspace-icon').count()).toBe(0);

    // Closing the ACTIVE tab rebinds the session to the remaining tab.
    mark = states.length;
    await viewer.locator('#workspace-new').click({ timeout: 5_000 });
    await waitForState(state => state.tabs.length === 2 && state.activeIndex === 1, 15_000, mark);
    await clickToolbarUntilState(
      viewer,
      '[aria-label="关闭 新标签页"]',
      state => state.tabs.length === 1 && state.activeIndex === 0 && state.tabs[0]?.url.includes('/beta.html'),
    );
    await waitForTabCount(viewer, 1);
    await waitForActiveTab(viewer, 'Beta Page');
    await waitForRemoteTitle('Beta Page');
    // Cross-layer identity after closing the active tab: rebound to tab 0.
    expect(findSession(sessionName)?.page).toBe(session.context.pages()[0]);

    await assertNoWorkspaceError(viewer);
    await viewer.close();
  }, 60_000);

  it('late-joining viewer sees the waiting handoff state and resumes via 继续任务', async () => {
    // A real waitForHuman wait on the same session/page the toolbar manages.
    const manager = new HumanInteractionManager(server, activeSessionPage(), sessionName);
    const waitPromise: Promise<WaitForHumanResult> = manager.waitForHuman({
      reason: 'E2E: 请在 viewer 中完成人工步骤',
      timeout: 60,
      autoDetect: false,
    });
    // Let the wait slot activate and the captcha-detected broadcast go out.
    await new Promise(resolve => setTimeout(resolve, 1_000));

    // Late join: this viewer connects AFTER the handoff started, so it must
    // learn the waiting state from workspace_state.handoffWaiting.
    const viewer = await openViewer();
    await waitForStatusText(viewer, '已连接');
    // The observer also polls explicitly — workspace_request replies go only
    // to the requester, so it must ask to see the late-join waiting state.
    ws.send(JSON.stringify({ type: 'workspace_request' }));
    await waitForState(state => state.handoffWaiting === true);
    await waitForStatusText(viewer, '等待人工继续');
    await viewer.waitForFunction(
      () => document.querySelector('#workspace-status')?.getAttribute('data-state') === 'waiting',
      { timeout: 10_000 },
    );
    fs.writeFileSync(path.join(outputDir, 'handoff-waiting.png'), await viewer.screenshot({ type: 'png' }));

    // 继续任务 resolves the in-flight wait through the real WS solve path.
    await viewer.locator('#handoff-done').click({ timeout: 5_000 });
    const result = await waitPromise;
    expect(result.solved).toBe(true);
    expect(result.method).toBe('preview');

    // The viewer flips back to the live state after the resolved broadcast.
    await waitForStatusText(viewer, '已连接');
    await viewer.waitForFunction(
      () => document.querySelector('#workspace-status')?.getAttribute('data-state') !== 'waiting',
      { timeout: 10_000 },
    );
    fs.writeFileSync(path.join(outputDir, 'handoff-resumed.png'), await viewer.screenshot({ type: 'png' }));

    await assertNoWorkspaceError(viewer);
    await viewer.close();
  }, 90_000);
});
