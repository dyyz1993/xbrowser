import { executeCommand } from '../executor.js';
import { outputResult, outputError } from './output.js';
import { normalizeSelector } from '../utils/selector.js';

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
  mode: string
): Promise<void> {
  let cmdName: string;
  let params: Record<string, unknown>;

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
      default:
        cmdName = command;
        params = { ...options };
        break;
    }
  }

  const result = await executeCommand(cmdName, params, sessionName);
  if (mode === 'json' || mode === 'yaml') {
    outputResult(result, mode);
  } else if (!result.success) {
    outputError(result.message || 'Command failed');
  } else {
    outputResult(result.data, mode);
  }
}
