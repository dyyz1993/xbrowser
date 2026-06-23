import { SessionRecorder } from '../recorder/session-recorder.js';
import type { RecordingSummary } from '../recorder/session-recorder.js';
import { outputResult, outputError } from './output.js';
import {
  forwardRecordStart,
  forwardRecordStop,
  forwardRecordStatus,
  forwardRecordSummary,
  forwardReplay,
  forwardRecordCheckpoint,
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
      const cdpEndpoint = options.cdp as string | undefined;

      const result = await forwardRecordStart(sessionName, url, cdpEndpoint) as Record<string, unknown>;

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
      const output = (options.output || options.o) as string | undefined;

      const result = await forwardRecordStop(sessionName, output) as Record<string, unknown>;

      if (!result.ok) {
        outputError(String(result.error || 'Failed to stop recording'));
        return;
      }

      outputResult({
        ok: true,
        message: 'Recording stopped.',
        sessionName,
        output: result.output || (output || SessionRecorder.getRecordingsDir(sessionName) + '/recording.json'),
        actions: result.actions,
        network: result.network,
        durationMs: result.durationMs,
        steps: result.steps,
      }, mode);

      const md = SessionRecorder.readMarkdownSummary(sessionName);
      if (md) {
        console.log('');
        console.log(md);
      } else {
        const summary = SessionRecorder.readSummary(sessionName);
        if (summary) {
          printRecordingSummary(summary, sessionName);
        }
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

    case 'checkpoint': {
      const sessionName = (options.session as string) || 'default';
      const type = (options.type as string) || 'custom';
      const hint = (options.hint as string) || '';
      const selector = options.selector as string | undefined;

      if (!hint) {
        outputError('Please provide --hint "description of what needs human help"');
        return;
      }

      const result = await forwardRecordCheckpoint(sessionName, type, hint, selector) as Record<string, unknown>;
      outputResult(result, mode);
      break;
    }

    case 'generate-plugin': {
      const sessionName = (options.session as string) || args[1] || 'default';
      const pluginName = (options.name as string) || '';
      const outputDir = (options.output as string) || '';
      await handleGeneratePlugin(sessionName, pluginName, outputDir);
      break;
    }

    default:
      console.log('Usage:');
      console.log('  xbrowser record start [--url <url>] [--session <name>]');
      console.log('  xbrowser record stop  [--session <name>]');
      console.log('  xbrowser record status [--session <name>]');
      console.log('  xbrowser record summary [--session <name>] [--json]');
      console.log('  xbrowser record checkpoint --type <type> --hint "description" [--selector <sel>] [--session <name>]');
      console.log('  xbrowser record generate-plugin [--session <name>] [--name <plugin>] [--output <dir>]');
      console.log('');
      console.log('Checkpoint types: dialog, captcha, login, iframe, slider, custom');
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
    const a = step.action;
    const el = a.element;
    const elDesc = el ? `<${el.tag}${el.selector ? ` ${el.selector}` : ''}>` : '';
    const elText = el?.text ? `"${el.text.substring(0, 40)}"` : '';
    let desc = '';
    if (a.type === 'input' && a.value) {
      desc = `type "${a.value.substring(0, 50)}" into ${elDesc}`;
    } else if (a.type === 'click') {
      desc = `click ${elDesc} ${elText}`;
    } else if (a.type === 'keydown') {
      desc = `press ${a.key} on ${elDesc}`;
    } else if (a.type === 'change') {
      desc = `change ${elDesc} to "${(a.value || '').substring(0, 30)}"`;
    } else if (a.type === 'submit') {
      desc = `submit ${elDesc}`;
    } else {
      desc = `${a.type} ${elDesc} ${elText}`.trim();
    }
    const navInfo = step.contextChanges.find(c => c.type === 'navigate');
    if (navInfo) desc += ` → navigate to ${navInfo.url?.substring(0, 80)}`;
    console.log(`  ${step.step}. ${desc}`);
    // Show click context (popover/dropdown items)
    if (a.clickContext) {
      const ctx = a.clickContext;
      if (ctx.appeared?.length > 0) {
        for (const popup of ctx.appeared) {
          const roleStr = popup.role ? ` [${popup.role}]` : '';
          console.log(`      ↳ ${popup.tag}${roleStr} "${(popup.text || '').substring(0, 60)}"`);
          if (popup.items?.length > 0) {
            for (const item of popup.items.slice(0, 10)) {
              const disStr = item.disabled ? ' [disabled]' : '';
              console.log(`        • ${item.text}${disStr}`);
            }
            if (popup.items.length > 10) {
              console.log(`        ... and ${popup.items.length - 10} more items`);
            }
          }
        }
      }
      if (ctx.stateChanges?.length > 0) {
        for (const sc of ctx.stateChanges) {
          const parts: string[] = [];
          if (sc.ariaExpanded !== undefined) parts.push(`expanded=${sc.ariaExpanded}`);
          if (sc.disabled) parts.push('disabled');
          if (sc.ariaSelected !== undefined) parts.push(`selected=${sc.ariaSelected}`);
          if (sc.dataState) parts.push(`state=${sc.dataState}`);
          if (parts.length > 0) {
            console.log(`      ↳ state: <${sc.tag}> "${(sc.text || '').substring(0, 30)}" ${parts.join(', ')}`);
          }
        }
      }
    }
  }

  console.log('');
  console.log(`  Files: ${SessionRecorder.getRecordingsDir(sessionName)}/`);

  if (summary.checkpoints && summary.checkpoints.length > 0) {
    console.log('');
    console.log(`  Checkpoints (${summary.checkpoints.length}):`);
    for (const cp of summary.checkpoints) {
      const src = cp.source === 'auto' ? '[auto]' : '[manual]';
      console.log(`    ${cp.id}. ${src} [${cp.type}] ${cp.hint}`);
      if (cp.selector) console.log(`       selector: ${cp.selector}`);
    }
  }
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

    // Show click context (popover/dropdown items)
    if (a.clickContext) {
      const ctx = a.clickContext;
      if (ctx.appeared?.length > 0) {
        for (const popup of ctx.appeared) {
          const roleStr = popup.role ? ` [${popup.role}]` : '';
          console.log(`    📋 ${popup.tag}${roleStr} "${(popup.text || '').substring(0, 60)}"`);
          if (popup.items?.length > 0) {
            for (const item of popup.items.slice(0, 10)) {
              const disStr = item.disabled ? ' [disabled]' : '';
              console.log(`       • ${item.text}${disStr}`);
            }
            if (popup.items.length > 10) {
              console.log(`       ... and ${popup.items.length - 10} more items`);
            }
          }
        }
      }
      if (ctx.stateChanges?.length > 0) {
        for (const sc of ctx.stateChanges) {
          const stateParts: string[] = [];
          if (sc.ariaExpanded !== undefined) stateParts.push(`expanded=${sc.ariaExpanded}`);
          if (sc.disabled) stateParts.push('disabled');
          if (sc.ariaSelected !== undefined) stateParts.push(`selected=${sc.ariaSelected}`);
          if (sc.dataState) stateParts.push(`state=${sc.dataState}`);
          if (stateParts.length > 0) {
            console.log(`    🔄 <${sc.tag}> "${(sc.text || '').substring(0, 30)}" ${stateParts.join(', ')}`);
          }
        }
      }
    }

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

  if (summary.checkpoints && summary.checkpoints.length > 0) {
    console.log('');
    console.log(`Checkpoints (${summary.checkpoints.length}):`);
    for (const cp of summary.checkpoints) {
      const src = cp.source === 'auto' ? '[auto]' : '[manual]';
      console.log(`  ${cp.id}. ${src} [${cp.type}] ${cp.hint}`);
      if (cp.selector) console.log(`     selector: ${cp.selector}`);
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
  // Normalize: new recorder uses "actions" field, old format uses "events"
  if (recording.actions && !recording.events) recording.events = recording.actions;

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

  const eventCount = (recording.events || recording.actions || []).length;
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

export async function handleFilter(args: string[], _mode: string, options?: Record<string, unknown>): Promise<void> {
  const filePath = args[0];
  const outputPath = args[1];

  if (!filePath || !outputPath) {
    console.error('Usage: xbrowser filter <input.yaml> <output.yaml> [--exclude type1,type2]');
    process.exit(1);
  }

  const { filterRecording, parseExcludeTypes } = await import('../commands/filter.js');

  // Build args list from both positional args and options for parseExcludeTypes
  const excludeArgs = args.slice(2).concat(
    Object.entries(options || {}).flatMap(([k, v]) =>
      k.startsWith('exclude') ? [`--${k}${typeof v === 'string' ? '=' + v : ''}`] : []
    )
  );
  const excludeTypes = parseExcludeTypes(excludeArgs);
  const result = filterRecording(filePath, outputPath, excludeTypes);

  console.log(`Filtered ${filePath} -> ${outputPath}`);
  console.log(`  Original: ${result.originalCount}, After: ${result.filteredCount}, Removed: ${result.removed} (${result.percentage}%)`);
}

// ─── generate-plugin: create a plugin from recording + knowledge ───

async function handleGeneratePlugin(
  sessionName: string,
  pluginName: string,
  outputDir: string,
): Promise<void> {
  const { SessionRecorder } = await import('../recorder/session-recorder.js');
  const { readSiteKnowledge, toMarkdown } = await import('../recorder/site-knowledge.js');
  const { mkdirSync, writeFileSync } = await import('fs');
  const { join } = await import('path');

  // Read recording data
  const data = SessionRecorder.readData(sessionName);
  if (!data) {
    outputError(`No recording found for session "${sessionName}". Run \`xbrowser record stop --session ${sessionName}\` first.`);
    return;
  }

  // Extract domain
  let domain = 'unknown';
  try {
    domain = new URL(data.startUrl).hostname.replace(/^www\./, '');
  } catch { /* keep unknown */ }

  const finalPluginName = pluginName || domain.split('.')[0] || 'my-site';
  const finalOutputDir = outputDir || join(process.cwd(), '.xcli', 'plugins', finalPluginName);

  // Read site knowledge if available
  const knowledge = readSiteKnowledge(domain);
  const knowledgeMd = knowledge ? toMarkdown(knowledge) : '';

  // Generate plugin code
  const pluginCode = generatePluginCode(finalPluginName, domain, data, knowledgeMd);

  // Write files
  mkdirSync(join(finalOutputDir), { recursive: true });
  writeFileSync(join(finalOutputDir, 'index.ts'), pluginCode, 'utf-8');

  // Also write knowledge.md alongside the plugin for reference
  if (knowledgeMd) {
    writeFileSync(join(finalOutputDir, 'SITE_KNOWLEDGE.md'), knowledgeMd, 'utf-8');
  }

  // Summary
  console.log('');
  console.log('=== Plugin Generated ===');
  console.log(`  Plugin:     ${finalPluginName}`);
  console.log(`  Domain:     ${domain}`);
  console.log(`  Output:     ${finalOutputDir}/index.ts`);
  if (knowledgeMd) {
    console.log(`  Knowledge:  ${finalOutputDir}/SITE_KNOWLEDGE.md`);
  }
  console.log(`  Actions:    ${data.actions.length}`);
  console.log(`  APIs:       ${data.network.filter(n => n.contentType.includes('json') || n.url.includes('/api/')).length}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Review and edit:  ${finalOutputDir}/index.ts`);
  console.log(`  2. Test:             xbrowser ${finalPluginName} <command>`);
  console.log(`  3. Reference:        ${finalOutputDir}/SITE_KNOWLEDGE.md (for LLM)`);
}

function generatePluginCode(
  pluginName: string,
  domain: string,
  data: { startUrl: string; actions: { type: string; url?: string; element?: { selector?: string; placeholder?: string } }[]; network: { contentType?: string; url: string }[] },
  _knowledgeMd: string,
): string {
  // Extract unique pages (informational — used for reference)
  const pagePaths = new Set<string>();
  for (const action of data.actions) {
    if (action.url) {
      try {
        pagePaths.add(new URL(action.url).pathname);
      } catch { /* skip */ }
    }
  }

  // Extract selectors grouped by action type
  const clickSelectors: string[] = [];
  const inputSelectors: Array<{ selector: string; placeholder?: string }> = [];

  for (const action of data.actions) {
    const el = action.element;
    if (!el) continue;
    const sel = el.selector;
    if (!sel) continue;

    if (action.type === 'click' && !clickSelectors.includes(sel)) {
      clickSelectors.push(sel);
    }
    if (action.type === 'input' && !inputSelectors.some(s => s.selector === sel)) {
      inputSelectors.push({ selector: sel, placeholder: el.placeholder });
    }
  }

  // Extract API endpoints
  const apis = data.network.filter(n =>
    (n.contentType || '').includes('json') || n.url.includes('/api/'),
  );

  // Build commands based on recorded actions
  const commands: string[] = [];

  // Command 1: goto main page
  commands.push(`  site.command({
    name: 'open',
    description: 'Open ${domain}',
    scope: 'browser',
    handler: async (_p: Record<string, unknown>, ctx: CommandContext) => {
      const page = ensurePage(ctx);
      await page.goto('${data.startUrl}', { waitUntil: 'domcontentloaded' });
      return ok({ url: page.url() });
    },
  });`);

  // Command 2: fill form (if inputs were recorded)
  if (inputSelectors.length > 0) {
    const params = inputSelectors.slice(0, 5).map((s, i) =>
      `    ${s.selector.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+/, '').toLowerCase() || `field${i}`}: z.string().describe('${s.placeholder || s.selector}'),`,
    ).join('\n');

    const fills = inputSelectors.slice(0, 5).map((s) =>
      `    await page.fill('${s.selector}', p.${s.selector.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+/, '').toLowerCase() || 'field0'}');`,
    ).join('\n');

    commands.push(`  site.command({
    name: 'fill',
    description: 'Fill form on ${domain}',
    scope: 'page',
    parameters: z.object({
${params}
    }),
    handler: async (p: Record<string, unknown>, ctx: CommandContext) => {
      const page = ensurePage(ctx);
${fills}
      return ok({ filled: true });
    },
  });`);
  }

  // Command 3: click action (if clicks were recorded)
  if (clickSelectors.length > 0) {
    commands.push(`  site.command({
    name: 'click',
    description: 'Click element on ${domain}',
    scope: 'page',
    parameters: z.object({
      selector: z.string().describe('CSS selector of element to click'),
    }),
    handler: async (p: Record<string, unknown>, ctx: CommandContext) => {
      const page = ensurePage(ctx);
      await page.click(p.selector as string);
      return ok({ clicked: p.selector });
    },
  });`);
  }

  // Command 4: scrape data (if API endpoints found)
  if (apis.length > 0) {
    commands.push(`  site.command({
    name: 'scrape',
    description: 'Scrape data from ${domain}',
    scope: 'page',
    handler: async (_p: Record<string, unknown>, ctx: CommandContext) => {
      const page = ensurePage(ctx);
      const data = await page.evaluate(() => {
        return {
          title: document.title,
          url: location.href,
          content: document.body?.innerText?.substring(0, 5000) || '',
        };
      });
      return ok(data);
    },
  });`);
  }

  // Build the full plugin file
  return `/**
 * ${pluginName} — Auto-generated plugin for ${domain}
 *
 * Generated from xbrowser recording session.
 * Review and customize before using in production.
 *
 * Site Knowledge: See SITE_KNOWLEDGE.md for LLM-readable selector/API reference.
 */

import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import { createSite, type CommandContext } from '@dyyz1993/xcli-core';

interface XBPage {
  url(): string;
  goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  click(selector: string, opts?: Record<string, unknown>): Promise<unknown>;
  fill(selector: string, value: string, opts?: Record<string, unknown>): Promise<unknown>;
  evaluate<T>(fn: string | (() => T)): Promise<T>;
}

function ensurePage(ctx: CommandContext): XBPage {
  const page = 'page' in ctx ? (ctx as Record<string, unknown>).page : undefined;
  if (!page) throw new Error('No active page. Start a session first.');
  return page as XBPage;
}

export default createSite({
  name: '${pluginName}',
  domain: '${domain}',
  description: 'Auto-generated plugin for ${domain} from recording',

  login: {
    url: '${data.startUrl}',
    detect: async (ctx: CommandContext) => {
      const page = ensurePage(ctx);
      // TODO: Add login detection logic
      return false;
    },
  },

  setup(site) {
${commands.join('\n\n')}
  },
});
`;
}
