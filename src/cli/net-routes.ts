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
          console.log(`\n  Network captures (session: ${netSession})`);
          console.log(`  Total: ${result.total}, Showing: ${result.captures.length}\n`);
          for (const c of result.captures) {
            const statusColor = c.status < 300 ? '\x1b[32m' : c.status < 400 ? '\x1b[33m' : '\x1b[31m';
            const reset = '\x1b[0m';
            console.log(`  #${c.id} ${c.method.padEnd(6)} ${statusColor}${c.status}${reset} ${c.resourceType.padEnd(10)} ${c.path}`);
            if (c.size > 0) {
              const sizeStr = c.size > 1024 ? `${(c.size / 1024).toFixed(1)}KB` : `${c.size}B`;
              console.log(`         ${c.contentType.split(';')[0]} ${sizeStr}`);
            }
          }
          console.log('');
        }
        break;
      }
      case 'clear': {
        await forwardNetworkClear(netSession);
        console.log(`Network captures cleared for session: ${netSession}`);
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
          console.log(`\n  Top valued requests (session: ${netSession})`);
          console.log(`  Showing: ${result.entries.length}\n`);
          for (const e of result.entries) {
            const scoreColor = e.score >= 50 ? '\x1b[32m' : e.score >= 20 ? '\x1b[33m' : '\x1b[90m';
            const reset = '\x1b[0m';
            const methodStr = e.method.padEnd(6);
            const scoreStr = `${scoreColor}${e.score.toString().padStart(3)}${reset}`;
            console.log(`  ${scoreStr} ${methodStr} ${e.status} ${e.resourceType.padEnd(10)} ${e.path}`);
            if (e.scoreBreakdown.content > 0) {
              console.log(`         ${e.contentType.split(';')[0]} ${e.size > 1024 ? (e.size / 1024).toFixed(1) + 'KB' : e.size + 'B'}`);
            }
          }
          console.log('');
        }
        break;
      }
      case 'log': {
        const logResult = await forwardCommandLog(netSession, options.limit ? Number(options.limit) : 50) as { session: string; commands: Array<{ id: number; timestamp: number; command: string; params: Record<string, unknown> }> };
        if (mode === 'json') {
          outputResult(logResult, mode);
        } else {
          console.log(`\n  Command log (session: ${netSession})`);
          console.log(`  Total: ${logResult.commands.length}\n`);
          for (const cmd of logResult.commands) {
            const ts = new Date(cmd.timestamp).toISOString().substring(11, 19);
            const paramsStr = Object.entries(cmd.params).map(([k, v]) => `${k}=${v}`).join(' ');
            console.log(`  #${cmd.id} [${ts}] ${cmd.command} ${paramsStr}`);
          }
          console.log('');
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
            console.log('  No command found with that ID');
            break;
          }
          const cmd = aroundResult.command as { id: number; timestamp: number; command: string };
          const ts = new Date(cmd.timestamp).toISOString().substring(11, 19);
          console.log(`\n  Command: #${cmd.id} [${ts}] ${cmd.command}`);
          console.log(`  Window: ±${windowMs}ms\n`);
          const before = (aroundResult.before as Array<Record<string, unknown>>);
          const after = (aroundResult.after as Array<Record<string, unknown>>);
          console.log(`  BEFORE (${before.length} requests):`);
          for (const r of before.slice(0, 5)) {
            console.log(`    ${r.method} ${r.status} ${String(r.resourceType).padEnd(10)} ${r.path}`);
          }
          console.log(`\n  AFTER (${aroundResult.afterCount as number} requests):`);
          for (const r of after.slice(0, 10)) {
            const highlight = r.method !== 'GET' ? ' ←' : '';
            console.log(`    ${String(r.method).padEnd(6)} ${r.status} ${String(r.resourceType).padEnd(10)} ${r.path}${highlight}`);
          }
          console.log('');
        }
        break;
      }
      case 'analyze': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await forwardNetworkAnalyze(netSession) as any;
        if (mode === 'json') {
          outputResult(result, mode);
        } else {
          console.log(`\n  API Reusability Analysis (session: ${netSession})`);
          console.log(`  Total: ${result.total}, Analyzed: ${result.analyzed.length}\n`);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const groups: Record<string, any[]> = { high: [], medium: [], low: [], unknown: [] };
          for (const e of result.analyzed) {
            groups[e.reusability.level]?.push(e);
          }

          for (const level of ['high', 'medium', 'low', 'unknown'] as const) {
            const items = groups[level];
            if (!items?.length) continue;
            const color = level === 'high' ? '\x1b[32m' : level === 'medium' ? '\x1b[33m' : level === 'low' ? '\x1b[31m' : '\x1b[90m';
            const reset = '\x1b[0m';
            console.log(`  ${color}${level.toUpperCase()}${reset} (${items.length})`);
            for (const e of items.slice(0, 5)) {
              const scoreStr = `[${e.reusability.score.toString().padStart(3)}]`;
              console.log(`    ${e.method.padEnd(6)} ${e.status} ${scoreStr} ${e.path}`);
              if (e.reusability.reasons.length > 0) {
                console.log(`           ${e.reusability.reasons.join(', ')}`);
              }
            }
            if (items.length > 5) console.log(`    ... and ${items.length - 5} more`);
            console.log('');
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
          console.log(`\n  ${result.method} ${result.url}`);
          console.log(`  Headers: ${result.headerCount}, Body: ${result.hasBody}\n`);
          console.log(result.command as string);
          console.log('');
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
          console.log(`\n  Replay Result`);
          console.log(`  ${(result.curlCommand as string)?.split('\n')[0]?.trim()}\n`);
          const replay = result.replay as Record<string, unknown> | undefined;
          if (replay?.error) {
            console.log(`  \x1b[31mFAILED\x1b[0m: ${replay.error}`);
          } else if (replay) {
            const statusColor = (replay.status as number) && (replay.status as number) < 300 ? '\x1b[32m' : '\x1b[31m';
            const status = replay.status as number;
            const size = replay.size as number;
            const duration = replay.duration as number;
            console.log(`  Status: ${statusColor}${status}\x1b[0m ${replay.statusText}`);
            console.log(`  Size: ${size > 1024 ? (size / 1024).toFixed(1) + 'KB' : size + 'B'}`);
            console.log(`  Duration: ${duration}ms`);
            console.log(`  Body Match: ${replay.bodyMatch ? '\x1b[32mYes\x1b[0m' : '\x1b[33mNo\x1b[0m'}`);
            if (status && status >= 400) {
              console.log(`  \x1b[33m⚠ API may require fresh signature/token\x1b[0m`);
            }
          }
          console.log('');
        }
        break;
      }
      case 'inspect': {
        const id = parseInt(args[1] || '0', 10);
        if (!id) {
          outputError('Usage: xbrowser net inspect <id> [--session default]');
          break;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await forwardNetworkInspect(netSession, id) as any;
        if (!result.capture) {
          outputError(`Entry #${id} not found`);
          break;
        }
        if (mode === 'json') {
          outputResult(result, mode);
        } else {
          const c = result.capture;
          console.log(`\n  Request #${c.id}`);
          console.log(`  ${c.method} ${c.url}`);
          console.log(`  Status: ${c.status} | Size: ${c.size}B | Type: ${c.contentType}`);
          console.log(`  Resource: ${c.resourceType}`);
          if (c.requestHeaders) {
            console.log(`\n  Request Headers:`);
            for (const [k, v] of Object.entries(c.requestHeaders)) {
              console.log(`    ${k}: ${String(v).substring(0, 100)}`);
            }
          }
          if (c.requestBody !== undefined) {
            console.log(`\n  Request Body:`);
            const bodyStr = typeof c.requestBody === 'string' ? c.requestBody : JSON.stringify(c.requestBody, null, 2);
            const lines = bodyStr.split('\n').slice(0, 20);
            for (const line of lines) console.log(`    ${line}`);
            if (bodyStr.split('\n').length > 20) console.log('    ...');
          }
          console.log(`\n  Response Headers:`);
          for (const [k, v] of Object.entries(c.headers)) {
            console.log(`    ${k}: ${String(v).substring(0, 100)}`);
          }
          if (c.body !== undefined) {
            console.log(`\n  Response Body:`);
            const bodyStr = typeof c.body === 'string' ? c.body : JSON.stringify(c.body, null, 2);
            const lines = bodyStr.split('\n').slice(0, 20);
            for (const line of lines) console.log(`    ${line}`);
            if (bodyStr.split('\n').length > 20) console.log('    ...');
          }
          console.log('');
        }
        break;
      }
      case 'like': {
        const id = parseInt(args[1] || '0', 10);
        if (!id) { outputError('Usage: xbrowser net like <id>'); break; }
        await forwardNetworkLike(netSession, id);
        console.log(`Marked #${id} as useful`);
        break;
      }
      case 'dislike': {
        const id = parseInt(args[1] || '0', 10);
        if (!id) { outputError('Usage: xbrowser net dislike <id>'); break; }
        await forwardNetworkDislike(netSession, id);
        console.log(`Marked #${id} as not useful`);
        break;
      }
      case 'export': {
        const id = parseInt(args[1] || '0', 10);
        if (!id) { outputError('Usage: xbrowser net export <id> [--lang ts|python|curl]'); break; }
        const lang = (options.lang as string) || 'ts';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await forwardNetworkExport(netSession, id, lang) as any;
        if (result.error) { outputError(result.error); break; }
        console.log(result.code);
        break;
      }
      default:
        outputError(`Unknown net sub-command: ${subCommand}. Use: list, clear, top, log, around, analyze, curl, replay, inspect, like, dislike, export`);
    }
  } catch (err) {
    outputError((err as Error).message || 'Network command failed');
  }
}
