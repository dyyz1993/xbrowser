import { executeCommand } from '../executor.js';
import { outputResult, outputError } from './output.js';
import { normalizeSelector } from '../utils/selector.js';
import { asZodSchema } from '../utils/zod-internal.js';
import { getCommand } from '../commands/command-registry.js';
import { helpGenerator } from '@dyyz1993/xcli-core';

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
  // Auto-generate --help from Zod schema via HelpGenerator
  if (args.includes('--help') || args.includes('-h') || options.help || options.h) {
    const cmdDef = getCommand(command);
    if (cmdDef) {
      if (mode === 'json') {
        // JSON mode: output structured parameter info
        const paramsList: Array<{ name: string; type: string; required: boolean; description: string }> = [];
        const schema = asZodSchema(cmdDef.parameters);
        const shape = schema?.shape ?? (schema?._def as Record<string, unknown>)?.shape as Record<string, unknown> | undefined;
        if (shape) {
          for (const [key, value] of Object.entries(shape)) {
            const fieldSchema = asZodSchema(value);
            const fieldDef = fieldSchema._def as Record<string, unknown> | undefined;
            const description = (fieldSchema.description as string) || (fieldDef?.description as string) || '';
            const typeName = (fieldDef?.typeName as string) || '';
            const isOptional = typeName === 'ZodOptional' || typeof (fieldSchema as Record<string, unknown>).isOptional === 'function' && ((fieldSchema as Record<string, unknown>).isOptional as () => boolean)();
            const innerType = asZodSchema(fieldDef?.innerType);
            const innerTypeName = innerType?._def ? (innerType._def as Record<string, unknown>).typeName as string : typeName;
            let type = 'unknown';
            if (innerTypeName === 'ZodString' || typeName === 'ZodString') type = 'string';
            else if (innerTypeName === 'ZodNumber' || typeName === 'ZodNumber') type = 'number';
            else if (innerTypeName === 'ZodBoolean' || typeName === 'ZodBoolean') type = 'boolean';
            else if (innerTypeName === 'ZodEnum' || typeName === 'ZodEnum') {
              const vals = (fieldDef?.values || (innerType?._def as Record<string, unknown>)?.values) as string[] | undefined;
              type = vals ? vals.join('|') : 'enum';
            }
            paramsList.push({ name: key, type, required: !isOptional, description });
          }
        }
        outputResult({ command: cmdDef.name, description: cmdDef.description, scope: cmdDef.scope, parameters: paramsList }, mode);
      } else {
        console.log(helpGenerator.generate(cmdDef as Parameters<typeof helpGenerator.generate>[0], { color: true, emoji: false }));
      }
    } else {
      outputError(`Unknown command: ${command}`);
    }
    return;
  }

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
        // press can be used with or without a selector:
        //   press Enter            → key=Enter, no selector
        //   press "#btn" Enter     → selector=#btn, key=Enter
        //   press -s "#btn" Enter  → selector=#btn, key=Enter
        const key = parsed.value || (sel ? parsed.remaining[1] : parsed.remaining[0]);
        if (!key) outputError('Usage: xbrowser press [selector] <key>');
        cmdName = 'press';
        params = { ...(sel ? { selector: sel } : {}), key };
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
        cmdName = 'wait';
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
      case 'open':
        if (!args[0]) outputError(`Usage: xbrowser ${command} <url>`);
        cmdName = 'goto';
        params = {
          url: /^https?:\/\//i.test(args[0]) || /^wss?:\/\//i.test(args[0]) ? args[0] : 'https://' + args[0],
          waitUntil: options.waitUntil as string | undefined,
          ...(options.timeout ? { timeout: Number(options.timeout) } : {}),
        };
        break;
      case 'screenshot':
        cmdName = 'screenshot';
        params = {
          fullPage: !!(options['full-page'] || options.fullPage),
          type: options.type as string | undefined,
          selector: (options.selector || options.s) as string | undefined,
          base64: !!(options.base64),
          output: (options.output || options.o) as string | undefined,
        };
        break;
      case 'eval':
        if (!args[0]) outputError('Usage: xbrowser eval <expression>');
        cmdName = 'eval';
        params = { expression: args.join(' ') };
        break;
      case 'scroll': {
        // scroll supports:
        //   scroll                → scroll down (default)
        //   scroll up/down/...    → scroll in direction
        //   scroll 500            → scroll down 500px (number = distance)
        //   scroll down 500       → scroll down 500px
        let direction = 'down';
        let distance: number | undefined;
        const firstArg = args[0];
        if (firstArg && ['up', 'down', 'left', 'right'].includes(firstArg)) {
          direction = firstArg;
          if (args[1] && /^\d+$/.test(args[1])) distance = Number(args[1]);
        } else if (firstArg && /^\d+$/.test(firstArg)) {
          distance = Number(firstArg);
        } else if (firstArg) {
          outputError(`Invalid scroll argument: "${firstArg}". Use up/down/left/right or a pixel number.`);
        }
        distance = distance ?? (options.distance ? Number(options.distance) : options.amount ? Number(options.amount) : undefined);
        cmdName = 'scroll';
        params = {
          direction,
          distance,
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
      case 'set-viewport': {
        // Supports: set-viewport 1280 720  OR  set-viewport --width 1280 --height 720
        const width = options.width ? Number(options.width) : (args[0] ? Number(args[0]) : undefined);
        const height = options.height ? Number(options.height) : (args[1] ? Number(args[1]) : undefined);
        if (!width || !height) outputError('Usage: xbrowser set-viewport <width> <height>');
        cmdName = 'set-viewport';
        params = { width, height };
        break;
      }
      case 'mouse': {
        // Supports: mouse move 100 200  OR  mouse click 50 50  OR  mouse --action move --x 100 --y 200
        const action = (options.action as string) || args.find(a => ['move','click','dblclick','down','up'].includes(a));
        const actionIdx = action ? args.indexOf(action) : -1;
        const x = options.x !== undefined ? Number(options.x) : (actionIdx >= 0 && args[actionIdx+1] ? Number(args[actionIdx+1]) : undefined);
        const y = options.y !== undefined ? Number(options.y) : (actionIdx >= 0 && args[actionIdx+2] ? Number(args[actionIdx+2]) : undefined);
        if (!action || x === undefined || y === undefined) {
          outputError('Usage: xbrowser mouse <move|click|dblclick> <x> <y>\n       xbrowser mouse --action <action> --x <x> --y <y>');
        }
        cmdName = 'mouse';
        params = { action, x, y, ...(options.button ? { button: options.button } : {}) };
        break;
      }
      case 'html':
        cmdName = 'html';
        params = { selector: (options.selector || options.s) as string | undefined };
        break;
      case 'text':
        cmdName = 'text';
        params = { selector: (options.selector || options.s) as string | undefined };
        break;
      case 'find': {
        if (!args[0] || !args[1]) {
          outputError('Usage: xbrowser find <text|role|label|placeholder|testid|alt|title|first|last|nth> <value> [action] [--name <name>]');
        }
        const strategy = args[0];
        const value = args[1];
        const operation = args.slice(2).join(' ') || undefined;
        cmdName = 'find';
        params = {
          strategy,
          value,
          ...(operation ? { operation } : {}),
          name: options.name as string | undefined,
          exact: !!options.exact,
          timeout: options.timeout ? Number(options.timeout) : undefined,
          index: options.index ? Number(options.index) : undefined,
        };
        break;
      }
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
          if (!args[0]) outputError('Usage: xbrowser scrape <url> [--format markdown|html|text] [--mode raw|clean|compact] [--selector <sel>] [--timeout <ms>]');
          cmdName = 'scrape';
          params = {
            url: args[0],
            selector: (options.selector || options.s) as string | undefined,
            timeout: options.timeout ? Number(options.timeout) : undefined,
            format: options.format as string | undefined,
            onlyMainContent: options['only-main-content'] !== 'false',
            mode: options.mode as string | undefined,
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
          if (!args[0]) outputError('Usage: xbrowser search "query" [--engine bing|google|baidu] [--limit N] [--full] [--format markdown|json] [--timeout ms] [--recency hour|day|week|month|year] [--site domain.com] [--fallback]');
          cmdName = 'search';
          params = {
            query: args.join(' '),
            engine: (options.engine || options.e) as string | undefined,
            limit: options.limit || options.l ? Number(options.limit || options.l) : undefined,
            full: !!(options.full || options.f),
            format: (options.format || options.F) as string | undefined,
            timeout: options.timeout || options.t ? Number(options.timeout || options.t) : undefined,
            recency: (options.recency || options.r) as string | undefined,
            fallback: !!(options.fallback),
            site: (options.site || options.s) as string | undefined,
          };
          break;
          case 'network': {
            const subCmd = args[0];
            if (subCmd === 'intercept') {
              args = args.slice(1);
            }
            const isListen = !!(options.listen);
            if (!args[0] && !isListen) outputError('Usage: xbrowser network <url> [--filter pattern] [--match keyword] [--search keyword] [--console] [--timeout ms] [--wait ms] [--limit N] [--format summary|json] [--listen --duration ms]');
            cmdName = 'network';
            params = {
              url: args[0] || '',
              filter: options.filter as string | undefined,
             match: options.match as string | undefined,
             search: options.search as string | undefined,
             console: !!(options.console),
             timeout: options.timeout ? Number(options.timeout) : undefined,
              wait: options.wait ? Number(options.wait) : undefined,
              limit: options.limit ? Number(options.limit) : undefined,
              format: (options.format as string | undefined),
              listen: isListen,
              duration: options.duration ? Number(options.duration) : undefined,
              ws: !!(options.ws),
            };
            break;
          }
        default:
         cmdName = command;
         params = { ...options };
         break;
     }
  }

  const target = options.target as string | undefined;
  if (target) {
    params = { ...params, _target: target };
  }

  const result = cdpEndpoint
    ? await executeCommand(cmdName, params, sessionName, { cdpEndpoint })
    : await executeCommand(cmdName, params, sessionName);
  if (mode === 'json' || mode === 'yaml') {
    outputResult(result, mode);
  } else if (!result.success) {
    outputError(result.message || 'Command failed');
  } else {
    // Detect "silent empty" — command succeeded but returned no meaningful data.
    // This usually means no browser page is connected (e.g. about:blank with no title).
    const data = result.data as Record<string, unknown> | null;
    const isEmptyResult = data && typeof data === 'object' &&
      Object.values(data).every(v => v === '' || v === null || v === undefined);
    if (isEmptyResult) {
      const hint = cdpEndpoint
        ? `可能未连接到浏览器。请确认 ${cdpEndpoint} 上有 Chrome 运行（--remote-debugging-port）。`
        : '可能未连接到浏览器。请使用 --cdp <endpoint> 连接，或安装 cdp-tunnel 复用已有 Chrome。';
      outputResult(result.data, mode);
      console.error(`\n  ⚠️  ${hint}`);
    } else {
      outputResult(result.data, mode);
    }
  }

  // Write to file if --output is specified (e.g. scrape --output result.md)
  const outputFile = options.output as string | undefined;
  if (outputFile && result.success && result.data) {
    const { writeFileSync } = await import('fs');
    const content = typeof result.data === 'string'
      ? result.data
      : (result.data as Record<string, unknown>).content as string
        || (result.data as Record<string, unknown>).text as string
        || JSON.stringify(result.data, null, 2);
    writeFileSync(outputFile, content, 'utf-8');
    console.log(`\n  📄 Written to ${outputFile}`);
  }
}
