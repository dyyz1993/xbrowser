// Re-export from core — no need to duplicate
export { splitCommand, parseCommandArgs } from '@dyyz1993/xcli-core';

import { registerCommandDefinition } from '@dyyz1993/xcli-core';
export { registerCommandDefinition };

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
 */
export function parseCommandChain(input: string, options?: ParseOptions): ParsedPipeline[] {
  const result: ParsedPipeline[] = [];
  let currentPipeline: string[] = [];
  let inQuote: "'" | '"' | null = null;
  let current = '';
  let parenDepth = 0;
  let lastOperator: 'sequence' | 'and' | 'or' = 'and';

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
	        lastOperator = 'sequence';
	        flushPipeline();
	        continue;
	      }

      if (char === '-' && input[i + 1] === '>' && isSpaceAround(input, i, 2)) {
        lastOperator = 'sequence';
        flushPipeline();
        i++;
        continue;
      }

      if (char === ',' && isSpaceAdjacent(input, i)) {
        lastOperator = 'sequence';
        flushPipeline();
        continue;
      }

      if (char === '+' && isSpaceAdjacent(input, i)) {
        lastOperator = 'sequence';
        flushPipeline();
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
 * Split a string on every `separator` that sits outside single/double quotes.
 *
 * Tracks quotes the same way {@link parseCommandChain} does. The quotes stay on
 * the pieces, so they can still be tokenized with {@link splitCommand}.
 *
 * @param input - The raw string to cut.
 * @param separator - A single character to split on (e.g. `;`).
 * @returns The pieces between the unquoted separators (possibly empty / untrimmed).
 */
export function splitOutsideQuotes(input: string, separator: string): string[] {
  const parts: string[] = [];
  let inQuote: "'" | '"' | null = null;
  let current = '';
  for (const char of input) {
    if (!inQuote && (char === "'" || char === '"')) {
      inQuote = char;
    } else if (inQuote && char === inQuote) {
      inQuote = null;
    } else if (!inQuote && char === separator) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/**
 * Chain operators that make a chain only when the shell handed them over as a
 * token of their own (`xbrowser goto a '&&' title`, `goto a -> title`).
 */
export const CHAIN_OPERATOR_TOKENS: ReadonlySet<string> = new Set(['&&', '||', ';', ',', '+', '->']);

/**
 * Re-quote one shell-tokenized argv word for reassembly into a chain string.
 *
 * The chain parser is quote-aware but has no escapes, so a word is wrapped in
 * the quote character it does not contain. Inside the wrapper the parser only
 * reads the characters it sees outside quotes, so those must be plain. A word
 * holding both quote types can be impossible to wrap; it is then returned as
 * is (the caller falls back to the plain rejoin).
 *
 * @param word - The argv token, quotes already removed by the shell.
 * @param force - Quote even a plain-looking word (a literal that happens to
 *   spell an operator or a flag, e.g. a value after `--`).
 * @returns The quoted word, or the word itself when nothing needs quoting.
 */
export function quoteChainToken(word: string, force = false): string {
  // `,` and `+` split a chain when a space sits on either side, so a word that
  // starts or ends with one picks up the join space as its partner.
  if (!force && !/[\s'"(),;|&]/.test(word) && !/^[+,]|[+,]$/.test(word)) return word;
  // Prefer the quote the word does not hold: nothing inside ever toggles.
  const absent = (['"', "'"] as const).find((quote) => !word.includes(quote));
  const candidates: Array<'"' | "'"> = absent
    ? [absent, absent === '"' ? "'" : '"']
    : ['"', "'"];
  for (const quote of candidates) {
    if (isOpaqueWhenQuoted(word, quote)) return `${quote}${word}${quote}`;
  }
  return word;
}

/**
 * Whether the chain parsers see nothing but ordinary characters once `word`
 * is wrapped in `quote`. Mirrors their quote toggling: a quote char flips the
 * state, so the word must hold an even number of them. A `,` or `+` seen
 * outside quotes is harmless here: its neighbours are word or quote
 * characters, never the space the parser needs beside it.
 */
function isOpaqueWhenQuoted(word: string, quote: '"' | "'"): boolean {
  let inside = true;
  for (const ch of word) {
    if (ch === quote) {
      inside = !inside;
    } else if (!inside && /[\s();|&]/.test(ch)) {
      return false;
    }
  }
  return inside;
}

// Register xbrowser command positional parameter definitions
// so parseCommandArgs can map positional args to named params.
registerCommandDefinition('goto', ['url']);
registerCommandDefinition('click', ['selector']);
registerCommandDefinition('fill', ['selector', 'value']);
registerCommandDefinition('type', ['selector', 'text']);
registerCommandDefinition('press', ['selector', 'key']);
registerCommandDefinition('select', ['selector', 'value']);
registerCommandDefinition('check', ['selector']);
registerCommandDefinition('uncheck', ['selector']);
registerCommandDefinition('hover', ['selector']);
registerCommandDefinition('dblclick', ['selector']);
registerCommandDefinition('wait', ['selector']);
registerCommandDefinition('waitForTimeout', ['timeout']);
registerCommandDefinition('screenshot', []);
registerCommandDefinition('eval', ['expression']);
registerCommandDefinition('scroll', ['direction']);
registerCommandDefinition('title', []);
registerCommandDefinition('url', []);
registerCommandDefinition('html', []);
registerCommandDefinition('text', []);
registerCommandDefinition('back', []);
registerCommandDefinition('forward', []);
registerCommandDefinition('refresh', []);
registerCommandDefinition('console', []);
registerCommandDefinition('network', []);
registerCommandDefinition('perf', []);
registerCommandDefinition('health', []);
registerCommandDefinition('scrape', ['url']);
registerCommandDefinition('structure', []);
registerCommandDefinition('get-cookies', []);
registerCommandDefinition('set-cookie', ['name', 'value']);
registerCommandDefinition('clear-cookies', []);
registerCommandDefinition('get-local-storage', []);
registerCommandDefinition('set-local-storage', ['key', 'value']);
registerCommandDefinition('clear-local-storage', []);
registerCommandDefinition('set-viewport', ['width', 'height']);
registerCommandDefinition('frames', []);
registerCommandDefinition('frame', ['selector']);
registerCommandDefinition('actions', ['url']);
registerCommandDefinition('find', ['strategy', 'value', 'operation']);
registerCommandDefinition('addinitscript', ['script']);
registerCommandDefinition('tab', ['subcommand']);
registerCommandDefinition('mouse', ['action', 'x', 'y']);
