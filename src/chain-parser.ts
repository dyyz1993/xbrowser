export interface ParsedPipeline {
  pipeline: string[];
  type: 'sequence' | 'and' | 'or';
}

export function parseCommandChain(input: string): ParsedPipeline[] {
  const result: ParsedPipeline[] = [];
  let currentPipeline: string[] = [];
  let inQuote: "'" | '"' | null = null;
  let current = '';
  let parenDepth = 0;
  let lastOperator: 'and' | 'or' = 'and';

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
        if (current.trim()) currentPipeline.push(current.trim());
        current = '';
        lastOperator = 'and';
        i++;
        continue;
      }

      if (char === '|' && input[i + 1] === '|') {
        if (current.trim()) currentPipeline.push(current.trim());
        current = '';
        lastOperator = 'or';
        i++;
        continue;
      }

      if (char === ';') {
        if (current.trim()) currentPipeline.push(current.trim());
        if (currentPipeline.length > 0) {
          result.push({ pipeline: currentPipeline, type: lastOperator });
        }
        currentPipeline = [];
        current = '';
        lastOperator = 'and';
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) currentPipeline.push(current.trim());
  if (currentPipeline.length > 0) {
    result.push({ pipeline: currentPipeline, type: lastOperator });
  }

  return result;
}

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
      if (value && !value.startsWith('--')) {
        const unquotedValue = unquote(value);
        if (unquotedValue === 'true') params[key] = true;
        else if (unquotedValue === 'false') params[key] = false;
        else if (/^\d+$/.test(unquotedValue)) params[key] = parseInt(unquotedValue, 10);
        else if (/^\d+\.\d+$/.test(unquotedValue)) params[key] = parseFloat(unquotedValue);
        else params[key] = unquotedValue;
        i++;
      } else {
        params[key] = true;
      }
    } else if (!raw.startsWith('-')) {
      if (positionalIndex < positionalKeys.length) {
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
};

function getCommandDefinitions(): Record<string, CommandDef> {
  return commandDefCache;
}

export function registerCommandDefinition(
  name: string,
  positional: string[]
): void {
  commandDefCache[name] = { positional };
}
