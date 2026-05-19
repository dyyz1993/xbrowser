import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { homedir } from 'os';
import type { Page } from 'playwright';
import { PlaybackEngine } from '../recorder/player.js';
import { SessionRecorder } from '../recorder/session-recorder.js';
import { generateJSScript, generatePythonScript, generateBashScript } from '../commands/convert.js';
import { extractAndSave, printExtractSummary } from '../commands/extract.js';
import { filterRecording, parseExcludeTypes } from '../commands/filter.js';
import { outputResult, outputError } from './output.js';
import { getSelectorGeneratorScript } from '../recorder/selector-utils.js';
import type { UserAction } from '../recorder/session-recorder.js';

const RECORDINGS_BASE = () => path.join(homedir(), '.xbrowser', 'sessions', 'default', 'recordings');
const CONTROL_FILE = () => path.join(RECORDINGS_BASE(), '.control.json');
const STOP_FILE = () => path.join(RECORDINGS_BASE(), '.stop');

const ACTION_SIGNAL_INJECT = getSelectorGeneratorScript() + `
(function() {
  if (window.__xb_action_signal) return;
  window.__xb_action_signal = true;
  window.__xb_pending_actions = [];
  window.__xb_recording_active = true;
  window.__xb_recording_start = Date.now();
  window.__xb_events = [];

  function describe(el) {
    if (!el || !el.tagName) return null;
    var selResult = window.__xb_generateSelector ? window.__xb_generateSelector(el) : null;
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().substring(0, 80),
      role: el.getAttribute('role'),
      type: el.getAttribute('type'),
      placeholder: el.getAttribute('placeholder'),
      ariaLabel: el.getAttribute('aria-label'),
      href: el.getAttribute('href') ? el.getAttribute('href').substring(0, 100) : undefined,
      id: el.id || undefined,
      className: (typeof el.className === 'string' ? el.className : '').substring(0, 80) || undefined,
      contentEditable: el.contentEditable === 'true' ? true : undefined,
      selector: selResult ? selResult.selector : undefined,
      selectorStrategy: selResult ? selResult.strategy : undefined,
      selectorConfidence: selResult ? selResult.confidence : undefined,
    };
  }

  function pushAction(type, detail) {
    var entry = {
      type: type,
      ts: Date.now(),
      url: location.href,
      title: document.title,
      detail: detail,
    };
    window.__xb_pending_actions.push(entry);
    window.__xb_events.push({
      type: type,
      ts: Date.now() - window.__xb_recording_start,
      url: location.href,
      ...detail,
    });
  }

  document.addEventListener('click', function(e) {
    pushAction('click', { target: describe(e.target), element: describe(e.target), x: e.clientX, y: e.clientY });
  }, true);

  document.addEventListener('dblclick', function(e) {
    pushAction('click', { target: describe(e.target), element: describe(e.target), x: e.clientX, y: e.clientY });
  }, true);

  document.addEventListener('input', function(e) {
    var val = e.target.value || e.target.textContent || '';
    pushAction('input', { target: describe(e.target), element: describe(e.target), value: val.substring(0, 200) });
  }, true);

  document.addEventListener('change', function(e) {
    var val = e.target.value || '';
    pushAction('change', { target: describe(e.target), element: describe(e.target), value: val.substring(0, 100) });
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape' || e.key.indexOf('Arrow') === 0) {
      pushAction('keydown', { key: e.key, target: describe(e.target), element: describe(e.target) });
    }
  }, true);

  document.addEventListener('submit', function(e) {
    pushAction('submit', { target: describe(e.target), element: describe(e.target) });
  }, true);

  document.addEventListener('focus', function(e) {
    var tag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || e.target.contentEditable === 'true') {
      pushAction('focus', { target: describe(e.target), element: describe(e.target) });
    }
  }, true);

  var __xb_last_scroll = 0;
  document.addEventListener('scroll', function() {
    if (Date.now() - __xb_last_scroll > 500) {
      __xb_last_scroll = Date.now();
      pushAction('scroll', { scrollX: window.scrollX, scrollY: window.scrollY });
    }
  }, true);

  var observer = new MutationObserver(function(mutations) {
    for (var m of mutations) {
      for (var node of m.addedNodes) {
        if (node.nodeType === 1 && node.tagName) {
          var text = (node.textContent || '').trim().substring(0, 60);
          if (text && text.length > 1) {
            window.__xb_events.push({
              type: 'dom_added',
              ts: Date.now() - window.__xb_recording_start,
              url: location.href,
              tag: node.tagName.toLowerCase(),
              role: node.getAttribute ? node.getAttribute('role') : undefined,
              text: text,
              id: node.id || undefined,
            });
          }
        }
      }
    }
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });

  console.log('[xb-recorder] Recording active with selector generation. Events in window.__xb_events / window.__xb_pending_actions');
})();
`;

interface ControlFile {
  sessionName: string;
  cdpEndpoint?: string;
  startedAt: number;
  startUrl: string;
}

function readControlFile(): ControlFile | null {
  const cp = CONTROL_FILE();
  if (!fs.existsSync(cp)) return null;
  try {
    return JSON.parse(fs.readFileSync(cp, 'utf-8')) as ControlFile;
  } catch {
    return null;
  }
}

function writeControlFile(data: ControlFile): void {
  const dir = RECORDINGS_BASE();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONTROL_FILE(), JSON.stringify(data, null, 2), 'utf-8');
}

function removeControlFile(): void {
  const cp = CONTROL_FILE();
  if (fs.existsSync(cp)) fs.unlinkSync(cp);
}

function waitForSignalFile(signalPath: string, checkIntervalMs = 500): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (fs.existsSync(signalPath)) {
        resolve();
        return;
      }
      setTimeout(check, checkIntervalMs);
    };
    check();
  });
}

function waitForFile(filePath: string, timeoutMs = 10000, checkIntervalMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (fs.existsSync(filePath)) { resolve(true); return; }
      if (Date.now() - start > timeoutMs) { resolve(false); return; }
      setTimeout(check, checkIntervalMs);
    };
    check();
  });
}

async function resolveSession(cdpEndpoint?: string, url?: string) {
  const { findOrRestoreSession, createSession } = await import('../browser.js');
  let session = await findOrRestoreSession('default', cdpEndpoint);
  if (!session) {
    session = await createSession('default', url, cdpEndpoint ? { cdpEndpoint } : {});
  }
  return session;
}

/**
 * For cdp-tunnel (9221) where Playwright pages() returns empty,
 * we bypass the session system and connect directly via CDP.
 * Returns a Page object we can actually use.
 */
async function resolvePageDirect(cdpEndpoint: string, url?: string): Promise<Page> {
  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP(cdpEndpoint);
  const contexts = browser.contexts();
  const ctx = contexts[0] || await browser.newContext();

  // Try to find an existing page with matching URL
  let page: Page | undefined;
  const pages = ctx.pages();

  if (url && pages.length > 0) {
    page = pages.find(p => p.url().includes(new URL(url).hostname));
  }

  // If no matching page, try any non-blank page
  if (!page && pages.length > 0) {
    page = pages.find(p => p.url().startsWith('http'));
  }

  // If still no page, try fetching from /json/list (cdp-tunnel fallback)
  if (!page) {
    try {
      const resp = await fetch(`${cdpEndpoint}/json/list`);
      const targets = await resp.json() as Array<{ type: string; url: string; id: string; webSocketDebuggerUrl: string }>;
      const pageTargets = targets.filter(t => t.type === 'page' && t.url.startsWith('http'));

      if (url) {
        const hostname = new URL(url).hostname;
        const match = pageTargets.find(t => t.url.includes(hostname));
        if (match) {
          // CDP tunnel exposes targets but Playwright can't see them.
          // Create a new page and navigate to the target URL.
          page = await ctx.newPage();
          await page.goto(match.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        }
      }

      if (!page && pageTargets.length > 0) {
        page = await ctx.newPage();
        await page.goto(pageTargets[0].url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }
    } catch {
      // /json/list failed
    }
  }

  // Last resort: create new page and navigate
  if (!page) {
    page = await ctx.newPage();
    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
  }

  // Navigate if URL specified and not already there
  if (url && page.url() !== url && !page.url().includes(new URL(url).hostname)) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  return page;
}

function rawActionToUserAction(raw: Record<string, unknown>, id: number): UserAction {
  const detail = raw.detail as Record<string, unknown> | undefined;
  const elementInfo = detail?.element as Record<string, unknown> | undefined;
  const targetInfo = detail?.target as Record<string, unknown> | undefined;
  const el = elementInfo || targetInfo;

  return {
    id,
    type: raw.type as UserAction['type'],
    timestamp: (raw.ts as number) || Date.now(),
    url: (raw.url as string) || '',
    pageTitle: (raw.title as string) || '',
    element: el ? {
      tag: (el.tag as string) || 'unknown',
      text: (el.text as string) || '',
      role: el.role as string | undefined,
      type: el.type as string | undefined,
      placeholder: el.placeholder as string | undefined,
      ariaLabel: el.ariaLabel as string | undefined,
      id: el.id as string | undefined,
      className: el.className as string | undefined,
      href: el.href as string | undefined,
    } : undefined,
    value: (detail?.value as string) || undefined,
    key: (detail?.key as string) || undefined,
    x: (detail?.x as number) || undefined,
    y: (detail?.y as number) || undefined,
    scrollX: (detail?.scrollX as number) || undefined,
    scrollY: (detail?.scrollY as number) || undefined,
    selector: el?.selector as string | undefined,
    selectorStrategy: el?.selectorStrategy as string | undefined,
    selectorConfidence: el?.selectorConfidence as UserAction['selectorConfidence'],
  };
}

export async function handleRecord(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case 'start': {
      const url = options.url as string;
      if (!url) outputError('Usage: xbrowser record start --url <url> [--cdp <endpoint>]');
      const cdpEndpoint = options.cdp as string | undefined;

      if (cdpEndpoint) {
        const page = await resolvePageDirect(cdpEndpoint, url);
        if (page.url() === 'about:blank' || !page.url().startsWith('http')) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }

        const recorder = new SessionRecorder(page.context(), page, 'default');
        await recorder.start(url);

        writeControlFile({
          sessionName: 'default',
          cdpEndpoint,
          startedAt: Date.now(),
          startUrl: url,
        });

        console.log(`\x1b[32m[xb-recorder]\x1b[0m Recording started on ${url}`);
        console.log(`\x1b[32m[xb-recorder]\x1b[0m Interact with browser, then run: \x1b[1mxbrowser record stop --cdp ${cdpEndpoint}\x1b[0m`);
        console.log(`\x1b[90m[xb-recorder]\x1b[0m Recording data is periodically flushed to disk.`);

        await waitForSignalFile(STOP_FILE());

        const { summary } = await recorder.stop();

        console.log(`\n\x1b[32m[xb-recorder]\x1b[0m Recording stopped.`);
        console.log(`  Duration: ${Math.round(summary.durationMs / 1000)}s`);
        console.log(`  Actions: ${summary.totalActions}`);
        console.log(`  Network requests: ${summary.totalNetworkRequests}`);
        console.log(`  Steps with selectors: ${summary.steps.filter(s => s.action.selector).length}`);
        console.log(`  Saved to: ${recorder.getRecordingsDir()}`);

        if (fs.existsSync(STOP_FILE())) fs.unlinkSync(STOP_FILE());
      } else {
        const session = await resolveSession(cdpEndpoint, url);
        const page = session.page;

        if (page.url() === 'about:blank' || !page.url().startsWith('http')) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }

        await page.evaluate(ACTION_SIGNAL_INJECT);
        await page.context().addInitScript(ACTION_SIGNAL_INJECT);

        writeControlFile({
          sessionName: 'default',
          cdpEndpoint,
          startedAt: Date.now(),
          startUrl: url,
        });

        outputResult({
          ok: true,
          url,
          message: 'Recording started. Interact with browser, then run: xbrowser record stop',
        }, mode);
      }
      break;
    }
    case 'stop': {
      const cdpEndpoint = options.cdp as string | undefined;
      const control = readControlFile();
      const effectiveCdp = cdpEndpoint || control?.cdpEndpoint;

      if (effectiveCdp && control) {
        const stopFile = STOP_FILE();
        const summaryPath = path.join(RECORDINGS_BASE(), 'summary.json');

        const dir = path.dirname(stopFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(stopFile, Date.now().toString(), 'utf-8');

        console.log(`\x1b[32m[xb-recorder]\x1b[0m Stop signal sent. Waiting for recorder to finish...`);

        const found = await waitForFile(summaryPath, 15000);
        if (found) {
          const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
          outputResult({
            ok: true,
            summaryJson: summaryPath,
            duration: `${Math.round(summary.durationMs / 1000)}s`,
            actions: summary.totalActions,
            networkRequests: summary.totalNetworkRequests,
            stepsWithSelectors: summary.steps.filter((s: Record<string, unknown>) => {
              const action = s.action as Record<string, unknown>;
              return !!action.selector;
            }).length,
          }, mode);
        } else {
          outputError('Timeout waiting for recorder to stop. The recording process may have already exited.');
        }
      } else {
        let page: Page;
        if (effectiveCdp) {
          page = await resolvePageDirect(effectiveCdp, control?.startUrl);
        } else {
          const session = await resolveSession(effectiveCdp);
          page = session.page;
        }

        const pendingRaw = await page.evaluate(() => {
          const w = window as unknown as Record<string, unknown>;
          const actions = (w.__xb_pending_actions as Array<Record<string, unknown>>) || [];
          w.__xb_pending_actions = [];
          return actions;
        }) as Array<Record<string, unknown>>;

        let legacyEvents: unknown[] = [];
        try {
          legacyEvents = await page.evaluate(() =>
            (window as unknown as Record<string, unknown>).__xb_events || []
          ) as unknown[];
        } catch {
          // page may have navigated
        }

        const userActions: UserAction[] = [];
        let counter = 0;
        for (const raw of pendingRaw) {
          counter++;
          userActions.push(rawActionToUserAction(raw, counter));
        }

        const startedAt = control?.startedAt || Date.now();
        const startUrl = control?.startUrl || page.url();
        const durationMs = Date.now() - startedAt;

        const recordingData = {
          startUrl,
          sessionName: 'default',
          startedAt: new Date(startedAt).toISOString(),
          actions: userActions,
          network: [],
          contextChanges: [],
        };

        const legacyRecording = {
          startUrl,
          recordedAt: new Date().toISOString(),
          events: legacyEvents,
        };

        const recordingsDir = path.join(homedir(), '.xbrowser', 'recordings');
        const newRecordingsDir = RECORDINGS_BASE();
        if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });
        if (!fs.existsSync(newRecordingsDir)) fs.mkdirSync(newRecordingsDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        const legacyOutPath = (options.output as string) ||
          path.join(recordingsDir, `recording-${timestamp}.yaml`);
        fs.writeFileSync(legacyOutPath, yaml.stringify(legacyRecording), 'utf8');

        const jsonOutPath = path.join(newRecordingsDir, 'recording.json');
        fs.writeFileSync(jsonOutPath, JSON.stringify(recordingData, null, 2), 'utf-8');

        const summary = {
          startUrl,
          recordedAt: new Date().toISOString(),
          durationMs,
          totalActions: userActions.length,
          totalNetworkRequests: 0,
          steps: userActions
            .filter(a => a.type !== 'scroll')
            .map((action, i) => ({
              step: i + 1,
              action,
              networkIds: [] as number[],
              contextChanges: [],
              matchedInputs: [],
            })),
        };

        const summaryPath = path.join(newRecordingsDir, 'summary.json');
        fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

        removeControlFile();

        try {
          await page.evaluate(() => {
            const w = window as unknown as Record<string, unknown>;
            w.__xb_recording_active = false;
            w.__xb_action_signal = false;
          });
        } catch {
          // ignore
        }

        outputResult({
          ok: true,
          path: legacyOutPath,
          recordingJson: jsonOutPath,
          summaryJson: summaryPath,
          events: legacyEvents.length,
          actions: userActions.length,
          duration: `${Math.round(durationMs / 1000)}s`,
          actionsWithSelectors: userActions.filter(a => a.selector).length,
        }, mode);
      }
      break;
    }
    case 'status': {
      const cdpEndpoint = options.cdp as string | undefined;
      const control = readControlFile();

      let statusPage: Page | undefined;
      try {
        if (cdpEndpoint) {
          statusPage = await resolvePageDirect(cdpEndpoint, control?.startUrl);
        } else {
          const { findOrRestoreSession } = await import('../browser.js');
          const session = await findOrRestoreSession('default', cdpEndpoint);
          if (session) statusPage = session.page;
        }
      } catch {
        // can't connect
      }

      if (!statusPage) {
        outputResult({ recording: false, message: 'No session found' }, mode);
        return;
      }

      try {
        const active = await statusPage.evaluate(() =>
          !!(window as unknown as Record<string, unknown>).__xb_recording_active
        );
        const eventCount = await statusPage.evaluate(() =>
          ((window as unknown as Record<string, unknown>).__xb_events as unknown[])?.length || 0
        );
        const pendingCount = await statusPage.evaluate(() =>
          ((window as unknown as Record<string, unknown>).__xb_pending_actions as unknown[])?.length || 0
        );
        outputResult({
          recording: active,
          hasControlFile: !!control,
          events: eventCount,
          pendingActions: pendingCount,
          url: statusPage!.url(),
          startedAt: control?.startedAt ? new Date(control.startedAt).toISOString() : undefined,
          startUrl: control?.startUrl,
        }, mode);
      } catch {
        outputResult({ recording: false, message: 'Cannot reach page' }, mode);
      }
      break;
    }
    case 'summary': {
      const summaryPath = path.join(RECORDINGS_BASE(), 'summary.json');
      if (!fs.existsSync(summaryPath)) {
        outputError('No recording summary found. Run `xbrowser record stop` first.');
        return;
      }
      try {
        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
        outputResult(summary, mode);
      } catch {
        outputError('Failed to read recording summary.');
      }
      break;
    }
    default:
      console.log('Usage: xbrowser record <start|stop|status|summary> [--url <url>] [--cdp <endpoint>]');
  }
}

export async function handleReplay(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const filePath = args[0];
  if (!filePath) outputError('Usage: xbrowser replay <file>');
  const { findOrRestoreSession, createSession } = await import('../browser.js');
  let session = await findOrRestoreSession('default', options.cdp as string | undefined);
  if (!session) {
    session = await createSession('default', undefined, options.cdp ? { cdpEndpoint: options.cdp as string } : {});
  }
  const engine = PlaybackEngine.fromFile(session.page, filePath);
  const result = await engine.play({
    slowMo: options['slow-mo'] ? Number(options['slow-mo']) : 1,
  });
  outputResult(result, mode);
}

export function handleConvert(args: string[], _mode: string): void {
  const filePath = args[0];
  const outputPath = args[1];

  if (!filePath || !outputPath) {
    console.error('Usage: xbrowser convert <recording.yaml> <output.{js,py,sh}>');
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const recording = yaml.parse(content);

  const ext = path.extname(outputPath).toLowerCase();
  let script: string;

  if (ext === '.py') {
    script = generatePythonScript(recording);
  } else if (ext === '.sh') {
    script = generateBashScript(recording);
  } else {
    script = generateJSScript(recording);
  }

  fs.writeFileSync(outputPath, script);
  fs.chmodSync(outputPath, 0o755);

  const eventCount = (recording.events || []).length;
  console.log(`Converted ${filePath} -> ${outputPath}`);
  console.log(`  Events: ${eventCount}, Start URL: ${recording.startUrl}`);
  console.log(`  Run: ${ext === '.py' ? 'python' : ext === '.sh' ? './' : 'node'} ${outputPath}`);
}

export function handleExtract(args: string[], _mode: string): void {
  const filePath = args[0];

  if (!filePath) {
    console.error('Usage: xbrowser extract <recording.yaml>');
    process.exit(1);
  }

  const { summary, outputPath } = extractAndSave(filePath);
  printExtractSummary(summary);
  console.log(`\nSaved LLM summary: ${outputPath}`);
}

export function handleFilter(args: string[], _mode: string): void {
  const filePath = args[0];
  const outputPath = args[1];

  if (!filePath || !outputPath) {
    console.error('Usage: xbrowser filter <input.yaml> <output.yaml> [--exclude-types=type1,type2]');
    process.exit(1);
  }

  const excludeTypes = parseExcludeTypes(args.slice(2));
  const result = filterRecording(filePath, outputPath, excludeTypes);

  console.log(`Filtered ${filePath} -> ${outputPath}`);
  console.log(`  Original: ${result.originalCount}, After: ${result.filteredCount}, Removed: ${result.removed} (${result.percentage}%)`);
}
