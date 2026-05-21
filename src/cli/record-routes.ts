import { SessionRecorder } from '../recorder/session-recorder.js';
import type { RecordingSummary } from '../recorder/session-recorder.js';
import { outputResult, outputError } from './output.js';
import {
  forwardRecordStart,
  forwardRecordStop,
  forwardRecordStatus,
  forwardRecordSummary,
  forwardReplay,
} from '../client/daemon-client.js';

// ─── record start/stop/status/summary (via daemon) ────────────────

export async function handleRecord(
  args: string[],
  options: Record<string, unknown>,
  mode: string,
): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case 'start': {
      const url = options.url as string;
      const sessionName = (options.session as string) || 'default';

      const result = await forwardRecordStart(sessionName, url) as Record<string, unknown>;

      if (!result.ok) {
        outputError(String(result.error || 'Failed to start recording'));
        return;
      }

      outputResult({
        ok: true,
        message: 'Recording started via daemon.',
        sessionName,
        startUrl: result.startUrl,
        hint: 'Run: xbrowser record stop --session ' + sessionName,
      }, mode);
      break;
    }

    case 'stop': {
      const sessionName = (options.session as string) || 'default';

      const result = await forwardRecordStop(sessionName) as Record<string, unknown>;

      if (!result.ok) {
        outputError(String(result.error || 'Failed to stop recording'));
        return;
      }

      outputResult({
        ok: true,
        message: 'Recording stopped.',
        sessionName,
        actions: result.actions,
        network: result.network,
        durationMs: result.durationMs,
        steps: result.steps,
      }, mode);

      const summary = SessionRecorder.readSummary(sessionName);
      if (summary) {
        printRecordingSummary(summary, sessionName);
      }
      break;
    }

    case 'status': {
      const sessionName = (options.session as string) || 'default';

      const result = await forwardRecordStatus(sessionName) as Record<string, unknown>;
      outputResult(result, mode);
      break;
    }

    case 'summary': {
      const sessionName = (options.session as string) || 'default';

      const result = await forwardRecordSummary(sessionName) as Record<string, unknown>;

      if (!result.ok) {
        outputError(String(result.error || 'No summary available'));
        return;
      }

      if (result.live) {
        outputResult({
          ok: true,
          live: true,
          session: sessionName,
          actions: result.actions,
          network: result.network,
          hint: 'Stop recording to see full summary.',
        }, mode);
      } else if (options.json || mode === 'json') {
        outputResult(result.summary, mode);
      } else {
        printHumanReadableSummary(result.summary as RecordingSummary);
      }
      break;
    }

    default:
      console.log('Usage:');
      console.log('  xbrowser record start [--url <url>] [--session <name>]');
      console.log('  xbrowser record stop  [--session <name>]');
      console.log('  xbrowser record status [--session <name>]');
      console.log('  xbrowser record summary [--session <name>] [--json]');
  }
}

// ─── Summary printers ─────────────────────────────────────────────

function printRecordingSummary(summary: RecordingSummary, sessionName: string): void {
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

    for (const match of step.matchedInputs) {
      console.log(`    🔗 input "${match.inputValue}" → network #${match.networkId} param "${match.paramName}"`);
    }

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

export async function handleReplay(
  args: string[],
  options: Record<string, unknown>,
  mode: string,
): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    outputError('Usage: xbrowser replay <file> [--session <name>] [--slow-mo <ms>]');
    return;
  }

  const sessionName = (options.session as string) || 'default';
  const slowMo = options['slow-mo'] ? Number(options['slow-mo']) : undefined;

  const absPath = await import('node:path').then((p) => p.resolve(filePath));

  const result = await forwardReplay(absPath, sessionName, slowMo) as Record<string, unknown>;

  if (!result.ok) {
    outputError(String(result.errors
      ? (result.errors as Array<{ error: string }>).map((e) => e.error).join('; ')
      : result.error || 'Replay failed'));
    return;
  }

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
