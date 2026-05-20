import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { SessionRecorder } from '../recorder/session-recorder.js';
import type { RecordingControlFile, RecordingSummary } from '../recorder/session-recorder.js';
import { outputResult, outputError } from './output.js';

// ─── Helper: resolve session ──────────────────────────────────────

function getControlFilePath(sessionName: string): string {
  return join(homedir(), '.xbrowser', 'sessions', sessionName, 'recordings', '.control.json');
}

function readControlFile(sessionName: string): RecordingControlFile | null {
  const path = getControlFilePath(sessionName);
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

// ─── record start ─────────────────────────────────────────────────
//
// Blocks the process. Continuously captures CDP events until
// `record stop` writes a .stop signal file.

export async function handleRecord(
  args: string[],
  options: Record<string, unknown>,
  mode: string,
): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case 'start': {
      const url = options.url as string;
      const cdpEndpoint = options.cdp as string | undefined;
      const sessionName = (options.session as string) || 'default';

      if (!cdpEndpoint) {
        outputError('CDP endpoint is required for recording. Use --cdp <endpoint>');
        return;
      }

      // Check if already recording
      const existing = readControlFile(sessionName);
      if (existing) {
        outputResult({
          ok: false,
          error: 'Recording already in progress',
          pid: existing.pid,
          startedAt: existing.startedAt,
          startUrl: existing.startUrl,
        }, mode);
        return;
      }

      // Connect directly via CDP and find the right page
      const { chromium } = await import('playwright');
      const rawEp = String(cdpEndpoint || '');
      // Resolve CDP WebSocket URL
      let wsEndpoint = rawEp;
      if (rawEp.startsWith('http://') || rawEp.startsWith('https://')) {
        try {
          const resp = await fetch(`${rawEp}/json/version`);
          const data = await resp.json() as { webSocketDebuggerUrl?: string };
          if (data.webSocketDebuggerUrl) wsEndpoint = data.webSocketDebuggerUrl;
        } catch { /* use as-is */ }
      } else if (/^\d+$/.test(rawEp)) {
        try {
          const resp = await fetch(`http://localhost:${rawEp}/json/version`);
          const data = await resp.json() as { webSocketDebuggerUrl?: string };
          if (data.webSocketDebuggerUrl) wsEndpoint = data.webSocketDebuggerUrl;
        } catch { /* use as-is */ }
      }

      const browser = await chromium.connectOverCDP(wsEndpoint);
      await new Promise(r => setTimeout(r, 1000)); // wait for contexts to populate

      const contexts = browser.contexts();
      const context = contexts[0] || await browser.newContext();

      // Try to find an existing page matching the target URL
      let page = null;
      if (url) {
        const hostname = new URL(url).hostname;
        for (const ctx of contexts) {
          for (const p of ctx.pages()) {
            if (p.url().includes(hostname)) { page = p; break; }
          }
          if (page) break;
        }
      }

      // If no matching page, use the first non-blank page, or create one
      if (!page) {
        for (const ctx of contexts) {
          for (const p of ctx.pages()) {
            if (p.url() && p.url() !== 'about:blank' && !p.url().startsWith('chrome://')) {
              page = p; break;
            }
          }
          if (page) break;
        }
      }

      if (!page) {
        // Try CDP targets as last resort
        try {
          const ep = rawEp.startsWith('http') ? rawEp : `http://localhost:${rawEp}`;
          const resp = await fetch(`${ep}/json/list`);
          const targets = await resp.json() as Array<{url: string; type: string}>;
          const target = targets.find(t => t.type === 'page' && t.url && t.url !== 'about:blank' && !t.url.startsWith('chrome://'));
          if (target) {
            page = await context.newPage();
            await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          }
        } catch { /* ignore */ }
      }

      if (!page) {
        page = await context.newPage();
      }

      // Navigate to target URL if needed
      if (url && page.url() !== url && !page.url().includes(new URL(url).hostname)) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      }

      const recorder = new SessionRecorder(context, page, sessionName);
      await recorder.start(url);

      outputResult({
        ok: true,
        message: 'Recording started. Process will block until stopped.',
        pid: process.pid,
        sessionName,
        startUrl: url || page.url(),
        hint: 'Run: xbrowser record stop --session ' + sessionName + ' --cdp ' + cdpEndpoint,
      }, mode);

      // ── BLOCK here: wait for stop signal ──
      await recorder.waitForStopSignal();

      // Stop and flush
      const { summary } = await recorder.stop();

      // Output summary
      console.log('');
      console.log('=== Recording Summary ===');
      console.log(`  Duration: ${Math.round(summary.durationMs / 1000)}s`);
      console.log(`  Actions:  ${summary.totalActions}`);
      console.log(`  Network:  ${summary.totalNetworkRequests}`);
      console.log(`  Steps:    ${summary.steps.length}`);
      console.log('');
      console.log(`  Recording: ${recorder.recordingsDir}/recording.json`);
      console.log(`  Summary:   ${recorder.recordingsDir}/summary.json`);

      // Close the session connection (CDP: just disconnect)
      const { ensureProcessCanExit } = await import('../browser.js');
      await ensureProcessCanExit();
      break;
    }

    case 'stop': {
      const sessionName = (options.session as string) || 'default';

      const control = await SessionRecorder.sendStopSignal(sessionName);

      if (!control) {
        // No active recording — check if there's a recording.json on disk already
        const existingData = SessionRecorder.readData(sessionName);
        if (existingData) {
          outputResult({
            ok: true,
            message: 'Recorder process already exited. Recording data found on disk.',
            sessionName,
            actions: existingData.actions.length,
            network: existingData.network.length,
          }, mode);
        } else {
          outputResult({
            ok: false,
            error: 'No active recording found for session: ' + sessionName,
          }, mode);
        }
        return;
      }

      outputResult({
        ok: true,
        message: 'Stop signal sent to recording process',
        pid: control.pid,
        sessionName: control.sessionName,
      }, mode);

      // Wait a moment for the recorder to finish writing
      await new Promise(r => setTimeout(r, 2000));

      // Read and display the summary
      const summary = SessionRecorder.readSummary(sessionName);
      if (summary) {
        console.log('');
        console.log('=== Recording Summary ===');
        console.log(`  Start URL: ${summary.startUrl}`);
        console.log(`  Duration:  ${Math.round(summary.durationMs / 1000)}s`);
        console.log(`  Actions:   ${summary.totalActions}`);
        console.log(`  Network:   ${summary.totalNetworkRequests}`);
        console.log(`  Steps:     ${summary.steps.length}`);

        for (const step of summary.steps) {
          console.log(`  ${step.step}. ${step.action.type}` +
            (step.action.element ? ` <${step.action.element.tag}> "${step.action.element.text?.substring(0, 30)}"` : '') +
            (step.action.value ? ` value="${step.action.value.substring(0, 30)}"` : '') +
            (step.network.length > 0 ? ` → ${step.network.length} network requests` : '') +
            (step.matchedInputs.length > 0 ? ` [${step.matchedInputs.length} input→API matches]` : ''),
          );
        }

        console.log('');
        console.log(`  Files: ${SessionRecorder.getRecordingsDir(sessionName)}/`);
      }
      break;
    }

    case 'status': {
      const sessionName = (options.session as string) || 'default';
      const control = readControlFile(sessionName);

      if (!control) {
        outputResult({ recording: false, sessionName }, mode);
        return;
      }

      // Check if the process is still alive
      let alive = false;
      try {
        process.kill(control.pid, 0);
        alive = true;
      } catch {
        alive = false;
      }

      outputResult({
        recording: alive,
        sessionName,
        pid: control.pid,
        startedAt: control.startedAt,
        startUrl: control.startUrl,
      }, mode);
      break;
    }

    case 'summary': {
      const sessionName = (options.session as string) || 'default';
      const summary = SessionRecorder.readSummary(sessionName);
      if (!summary) {
        outputError('No recording summary found for session: ' + sessionName);
        return;
      }

      if (options.json || mode === 'json') {
        outputResult(summary, mode);
      } else {
        printHumanReadableSummary(summary);
      }
      break;
    }

    default:
      console.log('Usage:');
      console.log('  xbrowser record start --cdp <endpoint> [--url <url>] [--session <name>]');
      console.log('  xbrowser record stop  [--session <name>]');
      console.log('  xbrowser record status [--session <name>]');
      console.log('  xbrowser record summary [--session <name>] [--json]');
  }
}

// ─── Human-readable summary printer ───────────────────────────────

function printHumanReadableSummary(summary: RecordingSummary): void {
  console.log(`Start URL: ${summary.startUrl}`);
  console.log(`Recorded:  ${summary.recordedAt}`);
  console.log(`Duration:  ${Math.round(summary.durationMs / 1000)}s`);
  console.log(`Actions:   ${summary.totalActions}`);
  console.log(`Network:   ${summary.totalNetworkRequests}`);
  console.log('');

  for (const step of summary.steps) {
    const a = step.action;
    const el = a.element;
    const parts: string[] = [];

    parts.push(`Step ${step.step}: [${a.type}]`);

    if (el) {
      parts.push(`<${el.tag}>`);
      if (el.text) parts.push(`"${el.text.substring(0, 40)}"`);
      if (el.selector) parts.push(`(${el.selector})`);
      if (el.type) parts.push(`type=${el.type}`);
      if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
    }

    if (a.value) parts.push(`value="${a.value.substring(0, 50)}"`);
    if (a.key) parts.push(`key=${a.key}`);
    if (a.x !== undefined && a.y !== undefined) parts.push(`@(${a.x},${a.y})`);

    console.log(parts.join(' '));

    // Network requests
    for (const net of step.network) {
      console.log(`    → ${net.method} ${net.path} [${net.status}] ${net.resourceType}`);
      if (net.requestBody && typeof net.requestBody === 'object') {
        const bodyStr = JSON.stringify(net.requestBody);
        if (bodyStr.length <= 200) {
          console.log(`      body: ${bodyStr}`);
        } else {
          console.log(`      body: ${bodyStr.substring(0, 200)}... (${bodyStr.length} bytes)`);
        }
      }
    }

    // Matched inputs
    for (const match of step.matchedInputs) {
      console.log(`    🔗 input "${match.inputValue}" → network #${match.networkId} param "${match.paramName}"`);
    }

    // Context changes
    for (const ctx of step.contextChanges) {
      if (ctx.type === 'navigate') {
        console.log(`    ↗ navigate → ${ctx.url}`);
      } else if (ctx.type === 'new_tab') {
        console.log(`    ↗ new tab: ${ctx.url}`);
      }
    }
  }
}

// ─── Legacy commands (replay, convert, extract, filter) ───────────
// Keep these as-is for backward compatibility.

export async function handleReplay(
  args: string[],
  options: Record<string, unknown>,
  mode: string,
): Promise<void> {
  const filePath = args[0];
  if (!filePath) outputError('Usage: xbrowser replay <file>');
  const { findOrRestoreSession, createSession } = await import('../browser.js');
  let session = await findOrRestoreSession('default', options.cdp as string | undefined);
  if (!session) {
    session = await createSession('default', undefined, options.cdp ? { cdpEndpoint: options.cdp as string } : {});
  }
  const { PlaybackEngine } = await import('../recorder/player.js');
  const engine = PlaybackEngine.fromFile(session.page, filePath);
  const result = await engine.play({
    slowMo: options['slow-mo'] ? Number(options['slow-mo']) : 1,
  });
  outputResult(result, mode);
}

export async function handleConvert(args: string[], _mode: string): Promise<void> {
  const filePath = args[0];
  const outputPath = args[1];

  if (!filePath || !outputPath) {
    console.error('Usage: xbrowser convert <recording.yaml> <output.{js,py,sh}>');
    process.exit(1);
  }

  const fs = await import('node:fs');
  const path = await import('node:path');
  const { default: yaml } = await import('yaml');

  const { generateJSScript, generatePythonScript, generateBashScript } = await import('../commands/convert.js');

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

export async function handleExtract(args: string[], _mode: string): Promise<void> {
  const filePath = args[0];

  if (!filePath) {
    console.error('Usage: xbrowser extract <recording.yaml>');
    process.exit(1);
  }

  const { extractAndSave, printExtractSummary } = await import('../commands/extract.js');

  const { summary, outputPath } = extractAndSave(filePath);
  printExtractSummary(summary);
  console.log(`\nSaved LLM summary: ${outputPath}`);
}

export async function handleFilter(args: string[], _mode: string): Promise<void> {
  const filePath = args[0];
  const outputPath = args[1];

  if (!filePath || !outputPath) {
    console.error('Usage: xbrowser filter <input.yaml> <output.yaml> [--exclude-types=type1,type2]');
    process.exit(1);
  }

  const { filterRecording, parseExcludeTypes } = await import('../commands/filter.js');

  const excludeTypes = parseExcludeTypes(args.slice(2));
  const result = filterRecording(filePath, outputPath, excludeTypes);

  console.log(`Filtered ${filePath} -> ${outputPath}`);
  console.log(`  Original: ${result.originalCount}, After: ${result.filteredCount}, Removed: ${result.removed} (${result.percentage}%)`);
}
