// Re-export from core — no need to duplicate
export { splitCommand, parseCommandArgs, registerCommandDefinition } from '@dyyz1993/xcli-core';

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
