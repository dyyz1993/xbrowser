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
