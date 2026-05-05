import { createInterface } from 'readline';
import { readFileSync } from 'fs';

export async function readStdin(): Promise<string[]> {
  if (process.stdin.isTTY) return [];

  const lines: string[] = [];
  const rl = createInterface({ input: process.stdin });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      lines.push(trimmed);
    }
  }
  return lines;
}

export function readCommandFile(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

export function splitFileLine(line: string): string[] {
  const commands: string[] = [];
  let current = '';
  let inQuote: "'" | '"' | null = null;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

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

    if (!inQuote && char === '|' && line[i + 1] !== '|') {
      if (current.trim()) commands.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) commands.push(current.trim());
  return commands;
}
