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
registerCommandDefinition('screenshot', []);
registerCommandDefinition('eval', ['expression', 'output']);
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
registerCommandDefinition('set-cookie', []);
registerCommandDefinition('clear-cookies', []);
registerCommandDefinition('get-local-storage', []);
registerCommandDefinition('set-local-storage', []);
registerCommandDefinition('clear-local-storage', []);
registerCommandDefinition('set-viewport', []);
registerCommandDefinition('frames', []);
registerCommandDefinition('frame', ['selector']);
registerCommandDefinition('actions', ['url']);
registerCommandDefinition('find', ['strategy', 'value', 'operation']);
registerCommandDefinition('addinitscript', ['script']);
registerCommandDefinition('tab', ['subcommand']);
