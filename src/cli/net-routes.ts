import {
  forwardNetworkList,
  forwardNetworkClear,
  forwardNetworkTop,
  forwardCommandLog,
  forwardNetworkAround,
  forwardNetworkAnalyze,
  forwardNetworkCurl,
  forwardNetworkReplay,
  forwardNetworkLike,
  forwardNetworkDislike,
  forwardNetworkExport,
  forwardNetworkInspect,
} from '../client/daemon-client.js'
import { outputResult, outputError } from './output.js'
import { errMsg } from '../utils/error.js';

export async function handleNetCommand(args: string[], options: Record<string, unknown>, mode: string, sessionName: string): Promise<void> {
  const subCommand = args[0] || 'list';
  const netSession = sessionName;

  try {
    switch (subCommand) {
      case 'list': {
        const filter = options.filter as string | undefined;
        const method = options.method as string | undefined;
        const limit = options.limit ? Number(options.limit) : 50;
        const result = (await forwardNetworkList(netSession, { filter, method, limit })) as {
          total: number;
          captures: Array<{
            id: number;
            method: string;
            status: number;
            resourceType: string;
            path: string;
            contentType: string;
            size: number;
          }>;
        };
        if (mode === 'json') {
          outputResult(result, mode);
        } else {
          process.stdout.write(`\n  Network captures (session: ${netSession})`);
          process.stdout.write(`  Total: ${result.total}, Showing: ${result.captures.length}\n`);
          for (const c of result.captures) {
            const statusColor = c.status < 300 ? '\x1b[32m' : c.status < 400 ? '\x1b[33m' : '\x1b[31m';
            const reset = '\x1b[0m';
            process.stdout.write(`  #${c.id} ${c.method.padEnd(6)} ${statusColor}${c.status}${reset} ${c.resourceType.padEnd(10)} ${c.path}\n`);
            if (c.size > 0) {
              const sizeStr = c.size > 1024 ? `${(c.size / 1024).toFixed(1)}KB` : `${c.size}B`;
              process.stdout.write(`         ${c.contentType.split(';')[0]} ${sizeStr}\n`);
            }
          }
          process.stdout.write('\n');
        }
        break;
      }
      case 'clear': {
        await forwardNetworkClear(netSession);
        process.stdout.write(`Network captures cleared for session: ${netSession}\n`);
        break;
      }
      case 'top': {
        const minScore = options['min-score'] ? Number(options['min-score']) : 0;
        const limit = options.limit ? Number(options.limit) : 20;
        const result = (await forwardNetworkTop(netSession, { minScore, limit })) as {
          session: string;
          entries: Array<{
            score: number;
            method: string;
            status: number;
            resourceType: string;
            path: string;
            contentType: string;
            size: number;
            scoreBreakdown: { content: number };
          }>;
        };
        if (mode === 'json') {
          outputResult(result, mode);
        } else {
          process.stdout.write(`\n  Top valued requests (session: ${netSession})`);
          process.stdout.write(`  Showing: ${result.entries.length}\n`);
          for (const e of result.entries) {
            const scoreColor = e.score >= 50 ? '\x1b[32m' : e.score >= 20 ? '\x1b[33m' : '\x1b[90m';
            const reset = '\x1b[0m';
            const methodStr = e.method.padEnd(6);
            const scoreStr = `${scoreColor}${e.score.toString().padStart(3)}${reset}`;
            process.stdout.write(`  ${scoreStr} ${methodStr} ${e.status} ${e.resourceType.padEnd(10)} ${e.path}\n`);
            if (e.scoreBreakdown.content > 0) {
              process.stdout.write(`         ${e.contentType.split(';')[0]} ${e.size > 1024 ? (e.size / 1024).toFixed(1) + 'KB' : e.size + 'B'}\n`);
            }
          }
          process.stdout.write('\n');
        }
        break;
      }
      case 'log': {
        const logResult = await forwardCommandLog(netSession, options.limit ? Number(options.limit) : 50) as { session: string; commands: Array<{ id: number; timestamp: number; command: string; params: Record<string, unknown> }> };
        if (mode === 'json') {
          outputResult(logResult, mode);
        } else {
          process.stdout.write(`\n  Command log (session: ${netSession})`);
          process.stdout.write(`  Total: ${logResult.commands.length}\n`);
          for (const cmd of logResult.commands) {
            const ts = new Date(cmd.timestamp).toISOString().substring(11, 19);
            const paramsStr = Object.entries(cmd.params).map(([k, v]) => `${k}=${v}`).join(' ');
            process.stdout.write(`  #${cmd.id} [${ts}] ${cmd.command} ${paramsStr}\n`);
          }
          process.stdout.write('\n');
        }
        break;
      }
      case 'around': {
        const cmdId = parseInt(args[1] || '0', 10);
        if (!cmdId) {
          outputError('Usage: xbrowser net around <command-id> [--window 5000]');
          break;
        }
        const windowMs = options.window ? Number(options.window) : 5000;
        const aroundResult = await forwardNetworkAround(netSession, cmdId, windowMs) as Record<string, unknown> | null;
        if (mode === 'json') {
          outputResult(aroundResult, mode);
        } else {
          if (!aroundResult) {
            process.stdout.write('  No command found with that ID\n');
            break;
          }
          const cmd = aroundResult.command as { id: number; timestamp: number; command: string };
          const ts = new Date(cmd.timestamp).toISOString().substring(11, 19);
          process.stdout.write(`\n  Command: #${cmd.id} [${ts}] ${cmd.command}`);
          process.stdout.write(`  Window: ±${windowMs}ms\n`);
          const before = (aroundResult.before as Array<Record<string, unknown>>);
          const after = (aroundResult.after as Array<Record<string, unknown>>);
          process.stdout.write(`  BEFORE (${before.length} requests):\n`);
          for (const r of before.slice(0, 5)) {
            process.stdout.write(`    ${r.method} ${r.status} ${String(r.resourceType).padEnd(10)} ${r.path}\n`);
          }
          process.stdout.write(`\n  AFTER (${aroundResult.afterCount as number} requests):`);
          for (const r of after.slice(0, 10)) {
            const highlight = r.method !== 'GET' ? ' ←' : '';
            process.stdout.write(`    ${String(r.method).padEnd(6)} ${r.status} ${String(r.resourceType).padEnd(10)} ${r.path}${highlight}\n`);
          }
          process.stdout.write('\n');
        }
        break;
      }
      case 'analyze': {
        type AnalyzedEntry = {
          method: string; status: number; path: string;
          reusability: { level: string; score: number; reasons: string[] };
        };
        const result = await forwardNetworkAnalyze(netSession) as { total: number; analyzed: AnalyzedEntry[] };
        if (mode === 'json') {
          outputResult(result, mode);
        } else {
          process.stdout.write(`\n  API Reusability Analysis (session: ${netSession})`);
          process.stdout.write(`  Total: ${result.total}, Analyzed: ${result.analyzed.length}\n`);

          const groups: Record<string, AnalyzedEntry[]> = { high: [], medium: [], low: [], unknown: [] };
          for (const e of result.analyzed) {
            groups[e.reusability.level]?.push(e);
          }

          for (const level of ['high', 'medium', 'low', 'unknown'] as const) {
            const items = groups[level];
            if (!items?.length) continue;
            const color = level === 'high' ? '\x1b[32m' : level === 'medium' ? '\x1b[33m' : level === 'low' ? '\x1b[31m' : '\x1b[90m';
            const reset = '\x1b[0m';
            process.stdout.write(`  ${color}${level.toUpperCase()}${reset} (${items.length})\n`);
            for (const e of items.slice(0, 5)) {
              const scoreStr = `[${e.reusability.score.toString().padStart(3)}]`;
              process.stdout.write(`    ${e.method.padEnd(6)} ${e.status} ${scoreStr} ${e.path}\n`);
              if (e.reusability.reasons.length > 0) {
                process.stdout.write(`           ${e.reusability.reasons.join(', ')}\n`);
              }
            }
            if (items.length > 5) process.stdout.write(`    ... and ${items.length - 5} more\n`);
            process.stdout.write('\n');
          }
        }
        break;
      }
      case 'curl': {
        const id = parseInt(args[1] || '0', 10);
        if (!id) {
          outputError('Usage: xbrowser net curl <id> [--session default]');
          break;
        }
        const result = await forwardNetworkCurl(netSession, id) as Record<string, unknown>;
        if ((result as Record<string, unknown>).error) {
          outputError((result as Record<string, unknown>).error as string);
          break;
        }
        if (mode === 'json') {
          outputResult(result, mode);
        } else {
          process.stdout.write(`\n  ${result.method} ${result.url}`);
          process.stdout.write(`  Headers: ${result.headerCount}, Body: ${result.hasBody}\n`);
          process.stdout.write(result.command as string + '\n');
          process.stdout.write('\n');
        }
        break;
      }
      case 'replay': {
        const id = parseInt(args[1] || '0', 10);
        if (!id) {
          outputError('Usage: xbrowser net replay <id> [--session default]');
          break;
        }
        const result = await forwardNetworkReplay(netSession, id) as Record<string, unknown>;
        if ((result as Record<string, unknown>).error) {
          outputError((result as Record<string, unknown>).error as string);
          break;
        }
        if (mode === 'json') {
          outputResult(result, mode);
        } else {
          process.stdout.write(`\n  Replay Result`);
          process.stdout.write(`  ${(result.curlCommand as string)?.split('\n')[0]?.trim()}\n`);
          const replay = result.replay as Record<string, unknown> | undefined;
          if (replay?.error) {
            process.stdout.write(`  \x1b[31mFAILED\x1b[0m: ${replay.error}\n`);
          } else if (replay) {
            const statusColor = (replay.status as number) && (replay.status as number) < 300 ? '\x1b[32m' : '\x1b[31m';
            const status = replay.status as number;
            const size = replay.size as number;
            const duration = replay.duration as number;
            process.stdout.write(`  Status: ${statusColor}${status}\x1b[0m ${replay.statusText}\n`);
            process.stdout.write(`  Size: ${size > 1024 ? (size / 1024).toFixed(1) + 'KB' : size + 'B'}\n`);
            process.stdout.write(`  Duration: ${duration}ms\n`);
            process.stdout.write(`  Body Match: ${replay.bodyMatch ? '\x1b[32mYes\x1b[0m' : '\x1b[33mNo\x1b[0m'}\n`);
            if (status && status >= 400) {
              process.stdout.write(`  \x1b[33m⚠ API may require fresh signature/token\x1b[0m\n`);
            }
          }
          process.stdout.write('\n');
        }
        break;
      }
      case 'inspect': {
        const id = parseInt(args[1] || '0', 10);
        if (!id) {
          outputError('Usage: xbrowser net inspect <id> [--session default]');
          break;
        }
        type CaptureDetail = {
          id: number; method: string; url: string; status: number;
          size: number; contentType: string; resourceType: string;
          requestHeaders?: Record<string, unknown>;
          requestBody?: unknown;
          headers: Record<string, unknown>;
          body?: unknown;
        };
        const result = await forwardNetworkInspect(netSession, id) as { capture: CaptureDetail };
        if (!result.capture) {
          outputError(`Entry #${id} not found`);
          break;
        }
        if (mode === 'json') {
          outputResult(result, mode);
        } else {
          const c = result.capture;
          process.stdout.write(`\n  Request #${c.id}`);
          process.stdout.write(`  ${c.method} ${c.url}\n`);
          process.stdout.write(`  Status: ${c.status} | Size: ${c.size}B | Type: ${c.contentType}\n`);
          process.stdout.write(`  Resource: ${c.resourceType}\n`);
          if (c.requestHeaders) {
            process.stdout.write(`\n  Request Headers:`);
            for (const [k, v] of Object.entries(c.requestHeaders)) {
              process.stdout.write(`    ${k}: ${String(v).substring(0, 100)}\n`);
            }
          }
          if (c.requestBody !== undefined) {
            process.stdout.write(`\n  Request Body:`);
            const bodyStr = typeof c.requestBody === 'string' ? c.requestBody : JSON.stringify(c.requestBody, null, 2);
            const lines = bodyStr.split('\n').slice(0, 20);
            for (const line of lines) process.stdout.write(`    ${line}\n`);
            if (bodyStr.split('\n').length > 20) process.stdout.write('    ...');
          }
          process.stdout.write(`\n  Response Headers:`);
          for (const [k, v] of Object.entries(c.headers)) {
            process.stdout.write(`    ${k}: ${String(v).substring(0, 100)}\n`);
          }
          if (c.body !== undefined) {
            process.stdout.write(`\n  Response Body:`);
            const bodyStr = typeof c.body === 'string' ? c.body : JSON.stringify(c.body, null, 2);
            const lines = bodyStr.split('\n').slice(0, 20);
            for (const line of lines) process.stdout.write(`    ${line}\n`);
            if (bodyStr.split('\n').length > 20) process.stdout.write('    ...');
          }
          process.stdout.write('\n');
        }
        break;
      }
      case 'like': {
        const id = parseInt(args[1] || '0', 10);
        if (!id) { outputError('Usage: xbrowser net like <id>'); break; }
        await forwardNetworkLike(netSession, id);
        process.stdout.write(`Marked #${id} as useful\n`);
        break;
      }
      case 'dislike': {
        const id = parseInt(args[1] || '0', 10);
        if (!id) { outputError('Usage: xbrowser net dislike <id>'); break; }
        await forwardNetworkDislike(netSession, id);
        process.stdout.write(`Marked #${id} as not useful\n`);
        break;
      }
      case 'export': {
        const id = parseInt(args[1] || '0', 10);
        if (!id) { outputError('Usage: xbrowser net export <id> [--lang ts|python|curl]'); break; }
        const lang = (options.lang as string) || 'ts';
        const result = await forwardNetworkExport(netSession, id, lang) as { error?: string; code: string };
        if (result.error) { outputError(result.error); break; }
        process.stdout.write(result.code as string + '\n');
        break;
      }
      default:
        outputError(`Unknown net sub-command: ${subCommand}. Use: list, clear, top, log, around, analyze, curl, replay, inspect, like, dislike, export`);
    }
  } catch (err) {
    outputError(errMsg(err) || 'Network command failed');
  }
}
