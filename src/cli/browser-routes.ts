import { executeCommand } from '../executor.js';
import { outputResult, outputError } from './output.js';
import { normalizeSelector } from '../utils/selector.js';
import { destroyBrowser } from '../browser.js';

interface ParsedSelectorArgs {
  selector?: string;
  value?: string;
  remaining: string[];
}

function parseSelectorFlags(args: string[], options: Record<string, unknown>): ParsedSelectorArgs {
  const selector = (options.s || options.selector || options['selector']) as string | undefined;
  const value = (options.v || options.value) as string | undefined;

  const remaining = args.filter((a) => !a.startsWith('-'));

  return {
    selector: selector ? normalizeSelector(selector) : undefined,
    value,
    remaining,
  };
}

const SELECTOR_COMMANDS = new Set([
  'click', 'fill', 'type', 'press', 'select',
  'check', 'uncheck', 'hover', 'dblclick', 'wait',
]);

export async function handleBrowserCommand(
  command: string,
  args: string[],
  options: Record<string, unknown>,
  sessionName: string,
  mode: string,
  cdpEndpoint?: string
): Promise<void> {
  let cmdName = '';
  let params: Record<string, unknown> = {};

  if (SELECTOR_COMMANDS.has(command)) {
    const parsed = parseSelectorFlags(args, options);
    const sel = parsed.selector
      || (parsed.remaining[0] ? normalizeSelector(parsed.remaining[0]) : undefined);

    switch (command) {
      case 'click':
        if (!sel) outputError('Usage: xbrowser click <selector>\n       xbrowser click -s <selector>');
        cmdName = 'click';
        params = { selector: sel };
        break;
      case 'fill': {
        const val = parsed.value || parsed.remaining[1];
        if (!sel || !val)
          outputError('Usage: xbrowser fill <selector> <value>\n       xbrowser fill -s <selector> -v <value>');
        cmdName = 'fill';
        params = { selector: sel, value: val };
        break;
      }
      case 'type': {
        const txt = parsed.value || parsed.remaining[1];
        if (!sel || !txt)
          outputError('Usage: xbrowser type <selector> <text>\n       xbrowser type -s <selector> -v <text>');
        cmdName = 'type';
        params = { selector: sel, text: txt };
        break;
      }
      case 'press': {
        const key = parsed.value || parsed.remaining[1];
        if (!sel && !key) outputError('Usage: xbrowser press [selector] <key>');
        cmdName = 'press';
        params = { ...(sel ? { selector: sel } : {}), key: key || sel };
        break;
      }
      case 'select': {
        const selVal = parsed.value || parsed.remaining[1];
        if (!sel || !selVal)
          outputError('Usage: xbrowser select <selector> <value>\n       xbrowser select -s <selector> -v <value>');
        cmdName = 'select';
        params = { selector: sel, value: selVal };
        break;
      }
      case 'check':
      case 'uncheck':
        if (!sel) outputError(`Usage: xbrowser ${command} <selector>\n       xbrowser ${command} -s <selector>`);
        cmdName = command;
        params = { selector: sel };
        break;
      case 'hover':
        if (!sel) outputError('Usage: xbrowser hover <selector>\n       xbrowser hover -s <selector>');
        cmdName = 'hover';
        params = { selector: sel };
        break;
      case 'dblclick':
        if (!sel) outputError('Usage: xbrowser dblclick <selector>\n       xbrowser dblclick -s <selector>');
        cmdName = 'dblclick';
        params = { selector: sel };
        break;
      case 'wait':
        if (!sel)
          outputError('Usage: xbrowser wait <selector> [--timeout <ms>]\n       xbrowser wait -s <selector> [--timeout <ms>]');
        cmdName = 'waitForSelector';
        params = {
          selector: sel,
          state: options.state as string | undefined,
          timeout: options.timeout ? Number(options.timeout) : undefined,
        };
        break;
      default:
        cmdName = command;
        params = { ...options };
    }
  } else {
    switch (command) {
      case 'goto':
        if (!args[0]) outputError('Usage: xbrowser goto <url>');
        cmdName = 'goto';
        params = {
          url: args[0],
          waitUntil: options.waitUntil as string | undefined,
        };
        break;
      case 'screenshot':
        cmdName = 'screenshot';
        params = {
          fullPage: !!(options['full-page'] || options.fullPage),
          type: options.type as string | undefined,
          selector: (options.selector || options.s) as string | undefined,
        };
        break;
      case 'eval':
        if (!args[0]) outputError('Usage: xbrowser eval <expression>');
        cmdName = 'eval';
        params = { expression: args.join(' ') };
        break;
      case 'scroll': {
        const direction = args[0] || 'down';
        if (!['up', 'down', 'left', 'right'].includes(direction))
          outputError('Direction must be: up, down, left, right');
        cmdName = 'scroll';
        params = {
          direction,
          distance: options.distance ? Number(options.distance) : undefined,
          selector: (options.selector || options.s) as string | undefined,
        };
        break;
      }
      case 'title':
        cmdName = 'title';
        params = {};
        break;
      case 'url':
        cmdName = 'url';
        params = {};
        break;
      case 'html':
        cmdName = 'html';
        params = { selector: (options.selector || options.s) as string | undefined };
        break;
      case 'text':
        cmdName = 'text';
        params = { selector: (options.selector || options.s) as string | undefined };
        break;
      case 'back':
        cmdName = 'back';
        params = {};
        break;
      case 'forward':
        cmdName = 'forward';
        params = {};
        break;
       case 'refresh':
         cmdName = 'refresh';
         params = {};
         break;
       case 'actions': {
          if (!args[0]) {
            outputError('Usage: xbrowser actions <url> --action "wait 1000" --action "click #btn" --action "scrape"\n       xbrowser actions <url> --actions-file ./actions.json\n       xbrowser actions <url> --actions \'[...]\' (legacy JSON)');
            break;
          }

          let parsedActions: unknown[] | undefined;

          if (options.action) {
            const actionList = Array.isArray(options.action) ? options.action : [options.action];
            const { parseActionDsl } = await import('../lib/parse-action-dsl.js');
            parsedActions = actionList.map((a: string) => parseActionDsl(a));
          } else if (options['actions-file']) {
            const fs = await import('fs');
            const content = fs.readFileSync(options['actions-file'] as string, 'utf-8');
            parsedActions = JSON.parse(content);
          } else if (options.actions) {
            const raw = options.actions;
            if (typeof raw === 'string') {
              parsedActions = JSON.parse(raw);
            } else if (Array.isArray(raw)) {
              const joined = '[' + (raw as string[]).join(',') + ']';
              parsedActions = JSON.parse(joined);
            }
          }

          if (!parsedActions || parsedActions.length === 0) {
            outputError('No actions provided. Use --action, --actions-file, or --actions');
            break;
          }

          cmdName = 'actions';
          params = {
            url: args[0],
            actions: parsedActions,
            output: options.output as string | undefined,
          };
          break;
        }
       case 'scrape':
          if (!args[0]) outputError('Usage: xbrowser scrape <url> [--format markdown|html|text] [--selector <sel>] [--timeout <ms>]');
          cmdName = 'scrape';
          params = {
            url: args[0],
            selector: (options.selector || options.s) as string | undefined,
            timeout: options.timeout ? Number(options.timeout) : undefined,
            format: options.format as string | undefined,
            onlyMainContent: options['only-main-content'] !== 'false',
          };
          break;
        case 'map':
          if (!args[0]) outputError('Usage: xbrowser map <url> [--search <query>] [--sitemap include|only] [--include-subdomains] [--limit <n>]');
          cmdName = 'map';
          params = {
            url: args[0],
            search: options.search as string | undefined,
            sitemap: options.sitemap as 'include' | 'only' | undefined,
            includeSubdomains: !!(options['include-subdomains'] || options.includeSubdomains),
            limit: options.limit ? Number(options.limit) : undefined,
          };
          break;
        case 'crawl':
          if (!args[0]) outputError('Usage: xbrowser crawl <url> [--limit <n>] [--max-depth <n>] [--format markdown|html] [--concurrency <n>] [--retries <n>] [--verbose]');
          cmdName = 'crawl';
          params = {
            url: args[0],
            limit: options.limit ? Number(options.limit) : undefined,
            maxDepth: options['max-depth'] ? Number(options['max-depth']) : undefined,
            includePaths: options['include-paths'] ? String(options['include-paths']).split(',') : undefined,
            excludePaths: options['exclude-paths'] ? String(options['exclude-paths']).split(',') : undefined,
            allowSubdomains: options['allow-subdomains'] === 'true',
            allowExternalLinks: options['allow-external-links'] === 'true',
            format: options.format as string | undefined,
            onlyMainContent: options['only-main-content'] !== 'false',
            concurrency: options.concurrency ? Number(options.concurrency) : undefined,
            retries: options.retries ? Number(options.retries) : undefined,
            verbose: options.verbose === 'true' || options.verbose === '',
          };
          break;
        case 'search':
          if (!args[0]) outputError('Usage: xbrowser search "query" [--engine bing|google|baidu|duckduckgo] [--limit N] [--full] [--format markdown|json] [--timeout ms]');
          cmdName = 'search';
          params = {
            query: args.join(' '),
            engine: (options.engine || options.e) as string | undefined,
            limit: options.limit || options.l ? Number(options.limit || options.l) : undefined,
            full: !!(options.full || options.f),
            format: (options.format || options.F) as string | undefined,
            timeout: options.timeout || options.t ? Number(options.timeout || options.t) : undefined,
          };
          break;
        case 'network': {
          const subCmd = args[0];
          if (subCmd === 'intercept') {
            args = args.slice(1);
          }
          if (!args[0]) outputError('Usage: xbrowser network <url> [--filter pattern] [--match keyword] [--console] [--timeout ms] [--wait ms] [--limit N] [--format summary|json]');
          cmdName = 'network';
          params = {
            url: args[0],
            filter: options.filter as string | undefined,
            match: options.match as string | undefined,
            console: !!(options.console),
            timeout: options.timeout ? Number(options.timeout) : undefined,
            wait: options.wait ? Number(options.wait) : undefined,
            limit: options.limit ? Number(options.limit) : undefined,
            format: (options.format as string | undefined),
          };
          break;
        }
       default:
         cmdName = command;
         params = { ...options };
         break;
     }
  }

  const result = cdpEndpoint
    ? await executeCommand(cmdName, params, sessionName, { cdpEndpoint })
    : await executeCommand(cmdName, params, sessionName);
  if (mode === 'json' || mode === 'yaml') {
    outputResult(result, mode);
  } else if (!result.success) {
    outputError(result.message || 'Command failed');
  } else {
    outputResult(result.data, mode);
  }
  await destroyBrowser();
  if (cdpEndpoint) process.exit(0);
}
