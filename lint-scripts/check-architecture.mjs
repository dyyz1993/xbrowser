#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MAX_LINES = 1200;
const ALLOWED_OVERSIZED = new Set([
  'src/daemon/preview-main-template.ts',
  'src/recorder/injection-scripts.ts',
  'src/recorder/session-replayer.ts',
]);
const FORBIDDEN_IMPORTS = [
  { directory: 'src/cdp-driver', pattern: /from\s+['"]\.\.\/(commands|daemon|recorder|cli|router)\// },
  { directory: 'src/commands', pattern: /from\s+['"]\.\.\/(daemon|cli|router)\// },
  { directory: 'src/recorder', pattern: /from\s+['"]\.\.\/(cli|daemon|router)\// },
];

const errors = [];

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath);
    else if (entry.endsWith('.ts')) visit(fullPath);
  }
}

function visit(fullPath) {
  const path = relative(ROOT, fullPath);
  const source = readFileSync(fullPath, 'utf8');
  const lines = source.split('\n').length;
  if (lines > MAX_LINES && !ALLOWED_OVERSIZED.has(path)) {
    errors.push(`${path}: ${lines} lines exceeds ${MAX_LINES}`);
  }

  for (const rule of FORBIDDEN_IMPORTS) {
    if (!path.startsWith(`${rule.directory}/`)) continue;
    const imported = source.match(rule.pattern);
    if (imported) errors.push(`${path}: forbidden upward import ${imported[0]}`);
  }
}

for (const directory of ['src/cdp-driver', 'src/commands', 'src/recorder']) {
  walk(join(ROOT, directory));
}

if (errors.length > 0) {
  console.error('Architecture check failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('Architecture boundaries passed.');
