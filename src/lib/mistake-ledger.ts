import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const MISTAKE_THRESHOLD = 3;
export const MISTAKE_LEDGER_PATH = join(
  homedir(),
  '.xbrowser',
  'knowledge',
  'mistakes.json',
);

export interface MistakeOccurrence {
  timestamp: string;
  command: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface MistakeEntry {
  fingerprint: string;
  category: string;
  firstSeen: string;
  lastSeen: string;
  occurrences: MistakeOccurrence[];
  constrained: boolean;
}

export interface MistakeLedger {
  version: 1;
  entries: Record<string, MistakeEntry>;
}

export interface RecordMistakeInput {
  category: string;
  fingerprint?: string;
  command: string;
  message: string;
  context?: Record<string, unknown>;
  timestamp?: string;
}

export interface RecordMistakeResult {
  entry: MistakeEntry;
  newlyConstrained: boolean;
}

function emptyLedger(): MistakeLedger {
  return { version: 1, entries: {} };
}

export function normalizeMistakeText(value: string): string {
  return value
    .replace(/\d{4}-\d{2}-\d{2}T[^'"\s]+/g, '<timestamp>')
    .replace(/\d+(?:\.\d+)?\s*(?:ms|s)\b/gi, '<duration>')
    .replace(/\b\d+\b/g, '<number>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mistakeFingerprint(
  category: string,
  message: string,
): string {
  return `${category}::${normalizeMistakeText(message)}`;
}

export function readMistakeLedger(path = MISTAKE_LEDGER_PATH): MistakeLedger {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as MistakeLedger;
    if (parsed.version !== 1 || typeof parsed.entries !== 'object') {
      return emptyLedger();
    }
    return parsed;
  } catch {
    return emptyLedger();
  }
}

export function writeMistakeLedger(
  ledger: MistakeLedger,
  path = MISTAKE_LEDGER_PATH,
): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, 2), 'utf8');
}

export function listMistakes(path = MISTAKE_LEDGER_PATH): MistakeEntry[] {
  return Object.values(readMistakeLedger(path).entries)
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export function recordMistake(
  input: RecordMistakeInput,
  path = MISTAKE_LEDGER_PATH,
): RecordMistakeResult {
  if (!input.category) throw new Error('mistake category is required');
  if (!input.command) throw new Error('mistake command is required');
  if (!input.message) throw new Error('mistake message is required');

  const ledger = readMistakeLedger(path);
  const fingerprint = input.fingerprint || mistakeFingerprint(input.category, input.message);
  const previous = ledger.entries[fingerprint];
  const occurrence: MistakeOccurrence = {
    timestamp: input.timestamp ?? new Date().toISOString(),
    command: input.command,
    message: input.message,
    ...(input.context ? { context: input.context } : {}),
  };

  const entry: MistakeEntry = previous
    ? {
      ...previous,
      lastSeen: occurrence.timestamp,
      occurrences: [...previous.occurrences, occurrence].slice(-100),
      constrained: previous.constrained || previous.occurrences.length + 1 >= MISTAKE_THRESHOLD,
    }
    : {
      fingerprint,
      category: input.category,
      firstSeen: occurrence.timestamp,
      lastSeen: occurrence.timestamp,
      occurrences: [occurrence],
      constrained: false,
    };

  ledger.entries[fingerprint] = entry;
  writeMistakeLedger(ledger, path);
  return {
    entry,
    newlyConstrained: Boolean(previous && !previous.constrained && entry.constrained),
  };
}

export function constrainedMistakes(path = MISTAKE_LEDGER_PATH): MistakeEntry[] {
  return listMistakes(path).filter((entry) => entry.constrained);
}

export function isConstrainedMistake(
  category: string,
  message: string,
  path = MISTAKE_LEDGER_PATH,
): boolean {
  const entry = readMistakeLedger(path).entries[mistakeFingerprint(category, message)];
  return Boolean(entry?.constrained);
}

export function clearMistakes(path = MISTAKE_LEDGER_PATH): boolean {
  if (!existsSync(path)) return false;
  writeMistakeLedger(emptyLedger(), path);
  return true;
}
