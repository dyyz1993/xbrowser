#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ledgerPath = join(homedir(), '.xbrowser', 'knowledge', 'mistakes.json');

function readLedger() {
  try {
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    if (ledger.version !== 1 || typeof ledger.entries !== 'object') return [];
    return Object.values(ledger.entries);
  } catch {
    return [];
  }
}

const constrained = readLedger().filter((entry) => entry?.constrained);
if (constrained.length === 0) {
  console.log('No constrained repeated mistakes.');
  process.exit(0);
}

console.error(`Constrained repeated mistakes (${constrained.length}):`);
for (const entry of constrained) {
  const first = entry.occurrences?.[0];
  console.error(`  - [${entry.category}] ${first?.message ?? '<missing message>'}`);
  console.error(`    command=${first?.command ?? '<missing>'} occurrences=${entry.occurrences?.length ?? 0}`);
}
process.exit(1);
