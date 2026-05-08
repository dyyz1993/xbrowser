/**
 * A parsed pipeline of commands with its chain type.
 */
export interface ParsedPipeline {
  pipeline: string[];
  type: 'sequence' | 'and' | 'or';
}

export interface ParseOptions {
  fileMode?: boolean;
}

/**
 * Parse a command chain string into ordered pipelines.
 *
 * Supports `&&` (and), `||` (or), `;` (sequence), `->`, `,`, and `+` operators.
 * Respects quoted strings and parenthesized groups.
 *
 * @param input - The raw command chain string.
 * @param options - Parse options; `fileMode` treats single `|` as a pipeline separator.
 * @returns Array of parsed pipelines, each with commands and a chain type.
 *
 * @example
 * ```ts
 * const pipelines = parseCommandChain('goto https://example.com && click #btn');
 * // [{ pipeline: ['goto https://example.com', 'click #btn'], type: 'and' }]
 * ```
 */
export function parseCommandChain(input: string, options?: ParseOptions): ParsedPipeline[] {
  const result: ParsedPipeline[] = [];
  let currentPipeline: string[] = [];
  let inQuote: "'" | '"' | null = null;
  let current = '';
  let parenDepth = 0;
  let lastOperator: 'and' | 'or' = 'and';

  const pushCommand = () => {
    if (current.trim()) currentPipeline.push(current.trim());
    current = '';
  };

  const flushPipeline = () => {
    pushCommand();
    if (currentPipeline.length > 0) {
      result.push({ pipeline: currentPipeline, type: lastOperator });
    }
    currentPipeline = [];
    lastOperator = 'and';
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (!inQuote && (char === '"' || char === "'")) {
      inQuote = char;
      current += char;
      continue;
    }

    if (inQuote && char === inQuote) {
      inQuote = null;
      current += char;
      continue;
    }

    if (char === '(') parenDepth++;
    if (char === ')') parenDepth--;

    if (!inQuote && parenDepth === 0) {
      if (char === '&' && input[i + 1] === '&') {
        pushCommand();
        lastOperator = 'and';
        i++;
        continue;
      }

      if (char === '|' && input[i + 1] === '|') {
        pushCommand();
        lastOperator = 'or';
        i++;
        continue;
      }

      if (char === ';') {
        flushPipeline();
        continue;
      }

      if (char === '-' && input[i + 1] === '>' && isSpaceAround(input, i, 2)) {
        pushCommand();
        lastOperator = 'and';
        i++;
        continue;
      }

      if (char === ',' && isSpaceAdjacent(input, i)) {
        pushCommand();
        lastOperator = 'and';
        continue;
      }

      if (char === '+' && isSpaceAdjacent(input, i)) {
        pushCommand();
        lastOperator = 'and';
        continue;
      }

      if (options?.fileMode && char === '|' && input[i + 1] !== '|') {
        pushCommand();
        lastOperator = 'and';
        continue;
      }
    }

    current += char;
  }

  pushCommand();
  if (currentPipeline.length > 0) {
    result.push({ pipeline: currentPipeline, type: lastOperator });
  }

  return result;
}

function isSpaceAdjacent(input: string, pos: number): boolean {
  const before = pos > 0 && input[pos - 1] === ' ';
  const after = pos + 1 < input.length && input[pos + 1] === ' ';
  return before || after;
}

function isSpaceAround(input: string, pos: number, tokenLen: number): boolean {
  const before = pos > 0 && input[pos - 1] === ' ';
  const after = pos + tokenLen < input.length && input[pos + tokenLen] === ' ';
  return before && after;
}

/**
 * Split a command string into whitespace-separated tokens, respecting quotes.
 *
 * @param cmdStr - The raw command string (e.g. `"click '#my-btn'"`).
 * @returns Array of string tokens.
 */
export function splitCommand(cmdStr: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote: "'" | '"' | null = null;

  for (let i = 0; i < cmdStr.length; i++) {
    const char = cmdStr[i];

    if (!inQuote && (char === "'" || char === '"')) {
      inQuote = char;
      current += char;
      continue;
    }

    if (inQuote && char === inQuote) {
      inQuote = null;
      current += char;
      continue;
    }

    if (!inQuote && /\s/.test(char)) {
      if (current.trim()) {
        parts.push(current.trim());
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function unquote(s: string): string {
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  return s;
}

const SHORT_FLAG_MAP: Record<string, string> = {
  s: 'selector',
  v: 'value',
};

function coerceValue(raw: string): unknown {
  const v = unquote(raw);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  if (/^\d+\.\d+$/.test(v)) return parseFloat(v);
  if (v.startsWith('[') || v.startsWith('{')) {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

/**
 * Parse positional and flagged arguments into a parameter object.
 *
 * Supports `--key value`, `-s value` (short flags), and positional arguments
 * mapped via registered command definitions. Values are automatically coerced
 * to boolean, number, or string.
 *
 * @param name - The command name (used to look up positional parameter names).
 * @param args - Array of argument strings.
 * @returns An object with the command name and parsed params.
 *
 * @example
 * ```ts
 * const { params } = parseCommandArgs('fill', ['#email', 'hello']);
 * // { command: 'fill', params: { selector: '#email', value: 'hello' } }
 * ```
 */
export function parseCommandArgs(
  name: string,
  args: string[]
): { command: string; params: Record<string, unknown> } {
  const definitions = getCommandDefinitions();
  const def = definitions[name];
  const positionalKeys = def ? def.positional : [];
  const params: Record<string, unknown> = {};
  let positionalIndex = 0;

  for (let i = 0; i < args.length; i++) {
    const raw = args[i];
    const arg = unquote(raw);

    if (raw.startsWith('--')) {
      const key = raw.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith('-')) {
        params[key] = coerceValue(value);
        i++;
      } else {
        params[key] = true;
      }
    } else if (raw.startsWith('-') && raw.length === 2) {
      const flag = raw[1];
      const mappedKey = SHORT_FLAG_MAP[flag];
      const value = args[i + 1];
      if (mappedKey && value && !value.startsWith('-')) {
        params[mappedKey] = coerceValue(value);
        i++;
      } else if (value && !value.startsWith('-')) {
        params[flag] = coerceValue(value);
        i++;
      } else {
        params[mappedKey || flag] = true;
      }
    } else {
      if (positionalIndex < positionalKeys.length) {
        const isLast = positionalIndex === positionalKeys.length - 1;
        if (isLast && name === 'eval') {
          const remaining = args.slice(i).map(unquote).join(' ');
          params[positionalKeys[positionalIndex]] = remaining;
          break;
        }
        params[positionalKeys[positionalIndex]] = arg;
        positionalIndex++;
      }
    }
  }

  return { command: name, params };
}

interface CommandDef {
  positional: string[];
}

const commandDefCache: Record<string, CommandDef> = {
  goto: { positional: ['url'] },
  click: { positional: ['selector'] },
  fill: { positional: ['selector', 'value'] },
  type: { positional: ['selector', 'text'] },
  press: { positional: ['selector', 'key'] },
  select: { positional: ['selector', 'value'] },
  check: { positional: ['selector'] },
  uncheck: { positional: ['selector'] },
  hover: { positional: ['selector'] },
  dblclick: { positional: ['selector'] },
  wait: { positional: ['selector'] },
  screenshot: { positional: [] },
  eval: { positional: ['expression'] },
  scroll: { positional: ['direction'] },
  title: { positional: [] },
  url: { positional: [] },
  html: { positional: [] },
  text: { positional: [] },
  back: { positional: [] },
  forward: { positional: [] },
  refresh: { positional: [] },
  assert: { positional: ['type'] },
  diff: { positional: ['baseline'] },
  testsuite: { positional: [] },
  console: { positional: [] },
  network: { positional: [] },
  perf: { positional: [] },
  health: { positional: [] },
  scrape: { positional: ['url'] },
  structure: { positional: [] },
  snapshot: { positional: [] },
  getProperty: { positional: ['selector'] },
  frames: { positional: [] },
  frame: { positional: ['selector'] },
  actions: { positional: ['url'] },
};

function getCommandDefinitions(): Record<string, CommandDef> {
  return commandDefCache;
}

/**
 * Register positional parameter names for a command used by {@link parseCommandArgs}.
 *
 * @param name - The command name.
 * @param positional - Ordered array of positional parameter names.
 */
export function registerCommandDefinition(
  name: string,
  positional: string[]
): void {
  commandDefCache[name] = { positional };
}
