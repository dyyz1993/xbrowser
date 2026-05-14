import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { PlaybackEngine } from '../recorder/player.js';
import { generateJSScript, generatePythonScript, generateBashScript } from '../commands/convert.js';
import { extractAndSave, printExtractSummary } from '../commands/extract.js';
import { filterRecording, parseExcludeTypes } from '../commands/filter.js';
import { outputResult, outputError } from './output.js';

const INJECTED_RECORDING_JS = `
(function() {
  if (window.__xb_recording_active) return;
  window.__xb_recording_active = true;
  window.__xb_events = [];
  window.__xb_recording_start = Date.now();

  function describe(el) {
    if (!el || !el.tagName) return { tag: 'unknown' };
    const info = {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().substring(0, 80),
      role: el.getAttribute('role'),
      type: el.getAttribute('type'),
      placeholder: el.getAttribute('placeholder'),
      ariaLabel: el.getAttribute('aria-label'),
      href: el.getAttribute('href')?.substring(0, 100),
      id: el.id || undefined,
      className: (typeof el.className === 'string' ? el.className : '').substring(0, 80) || undefined,
      contentEditable: el.contentEditable === 'true' ? true : undefined,
    };
    Object.keys(info).forEach(k => info[k] === undefined && delete info[k]);
    return info;
  }

  function pushEvent(type, detail) {
    window.__xb_events.push({
      type,
      ts: Date.now() - window.__xb_recording_start,
      url: location.href,
      ...detail,
    });
  }

  document.addEventListener('click', function(e) {
    pushEvent('click', { target: describe(e.target), x: e.clientX, y: e.clientY });
  }, true);

  document.addEventListener('dblclick', function(e) {
    pushEvent('dblclick', { target: describe(e.target), x: e.clientX, y: e.clientY });
  }, true);

  document.addEventListener('input', function(e) {
    const el = e.target;
    pushEvent('input', {
      target: describe(el),
      value: (el.value || el.textContent || '').substring(0, 200),
    });
  }, true);

  document.addEventListener('change', function(e) {
    pushEvent('change', { target: describe(e.target), value: (e.target.value || '').substring(0, 100) });
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape' || e.key.startsWith('Arrow')) {
      pushEvent('keydown', { key: e.key, target: describe(e.target) });
    }
  }, true);

  document.addEventListener('submit', function(e) {
    pushEvent('submit', { target: describe(e.target) });
  }, true);

  document.addEventListener('focus', function(e) {
    const tag = e.target.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.contentEditable === 'true') {
      pushEvent('focus', { target: describe(e.target) });
    }
  }, true);

  var observer = new MutationObserver(function(mutations) {
    for (var m of mutations) {
      for (var node of m.addedNodes) {
        if (node.nodeType === 1 && node.tagName) {
          var text = (node.textContent || '').trim().substring(0, 60);
          if (text && text.length > 1) {
            pushEvent('dom_added', {
              tag: node.tagName.toLowerCase(),
              role: node.getAttribute?.('role'),
              text: text,
              id: node.id || undefined,
            });
          }
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  pushEvent('recording_started', { url: location.href });
  console.log('[xb-recorder] Recording active. Events stored in window.__xb_events');
})();
`;

async function resolveSession(cdpEndpoint?: string, url?: string) {
  const { findOrRestoreSession, createSession } = await import('../browser.js');
  let session = await findOrRestoreSession('default', cdpEndpoint);
  if (!session) {
    session = await createSession('default', url, cdpEndpoint ? { cdpEndpoint } : {});
  }
  return session;
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
      const session = await resolveSession(cdpEndpoint, url);
      const page = session.page;

      if (page.url() !== url && !page.url().startsWith('about:blank')) {
        // already on a page, inject directly
      } else if (page.url() === 'about:blank' || !page.url().startsWith('http')) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }

      await page.evaluate(INJECTED_RECORDING_JS);
      await page.context().addInitScript(INJECTED_RECORDING_JS);

      outputResult({ ok: true, url, message: 'Recording injected into page. Interact with browser, then run: xbrowser record stop --cdp <endpoint>', injected: true }, mode);
      break;
    }
    case 'stop': {
      const cdpEndpoint = options.cdp as string | undefined;
      const session = await resolveSession(cdpEndpoint);
      const page = session.page;

      let events: unknown[] = [];
      try {
        const raw = await page.evaluate(() => (window as unknown as Record<string, unknown>).__xb_events || []);
        events = raw as unknown[];
      } catch {
        outputError('Could not read events from page. Page may have navigated away.');
      }

      if (events.length === 0) {
        outputResult({ ok: true, events: 0, message: 'No events captured' }, mode);
        return;
      }

      const recording = {
        startUrl: page.url(),
        recordedAt: new Date().toISOString(),
        events,
      };

      const recordingsDir = path.join(process.env.HOME || '', '.xbrowser', 'recordings');
      if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

      const outPath = options.output as string || path.join(recordingsDir, `recording-${new Date().toISOString().replace(/[:.]/g, '-')}.yaml`);
      fs.writeFileSync(outPath, yaml.stringify(recording), 'utf8');

      const duration = events.length > 0 ? (events[events.length - 1] as Record<string, unknown>).ts : 0;
      outputResult({
        ok: true,
        path: outPath,
        events: events.length,
        duration: `${Math.round(Number(duration) / 1000)}s`,
      }, mode);
      break;
    }
    case 'status': {
      const cdpEndpoint = options.cdp as string | undefined;
      const { findOrRestoreSession } = await import('../browser.js');
      const session = await findOrRestoreSession('default', cdpEndpoint);
      if (!session) {
        outputResult({ recording: false, message: 'No session found' }, mode);
        return;
      }
      try {
        const active = await session.page.evaluate(() => !!(window as unknown as Record<string, unknown>).__xb_recording_active);
        const count = await session.page.evaluate(() => ((window as unknown as Record<string, unknown>).__xb_events as unknown[])?.length || 0);
        outputResult({ recording: active, events: count, url: session.page.url() }, mode);
      } catch {
        outputResult({ recording: false, message: 'Cannot reach page' }, mode);
      }
      break;
    }
    default:
      console.log('Usage: xbrowser record <start|stop|status> [--url <url>] [--cdp <endpoint>]');
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
