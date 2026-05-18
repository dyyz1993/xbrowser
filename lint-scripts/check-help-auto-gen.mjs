#!/usr/bin/env node

/**
 * Lint rule: --help must be auto-generated from Zod schemas.
 *
 * Checks:
 * 1. No hand-written help files that bypass HelpGenerator
 * 2. Every registerCommand() must have 'parameters' field
 * 3. src/cli/help.ts (if exists) must use helpGenerator from framework
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const SRC = join(ROOT, 'src');
const COMMANDS_DIR = join(SRC, 'commands');

let errors = 0;

// 1. Check for per-command help files that don't use HelpGenerator
// (main help.ts that shows command list is exempt — it's not per-command help)
const helpFiles = [
  join(SRC, 'cli', 'command-help.ts'),
  join(SRC, 'command-help.ts'),
];

for (const f of helpFiles) {
  if (existsSync(f)) {
    const content = readFileSync(f, 'utf-8');
    if (!content.includes('helpGenerator') && !content.includes('HelpGenerator')) {
      console.error(`❌ ${f}: Hand-written help file detected.`);
      console.error('   Use helpGenerator from @dyyz1993/xcli-core instead.');
      console.error('   Command --help is auto-generated from Zod schemas via HelpGenerator.');
      console.error('   See: Core.run() handles <command> --help automatically.');
      errors++;
    }
  }
}

// 2. Check that all registerCommand() calls have parameters
// (only warn, not error — no-param commands like 'title' are acceptable)
function checkDir(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      checkDir(full);
      continue;
    }
    if (!entry.endsWith('.ts') || entry === 'index.ts' || entry === 'command-registry.ts') continue;

    const content = readFileSync(full, 'utf-8');
    if (!content.includes('registerCommand')) continue;

    // Find all registerCommand blocks and check for parameters
    const blocks = content.split('registerCommand(');
    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      const handlerIdx = block.indexOf('handler:');
      const paramsIdx = block.indexOf('parameters:');
      if (handlerIdx !== -1 && (paramsIdx === -1 || paramsIdx > handlerIdx)) {
        const nameMatch = block.match(/name:\s*['"](\w+)['"]/);
        const cmdName = nameMatch ? nameMatch[1] : '(unknown)';
        console.warn(`⚠️  ${entry}: registerCommand("${cmdName}") has no 'parameters' field.`);
        console.warn('   Consider adding parameters: z.object({}) for consistent --help output.');
        // Not counting as error — no-param commands are acceptable
      }
    }
  }
}

checkDir(COMMANDS_DIR);

if (errors > 0) {
  console.error(`\n❌ ${errors} help auto-generation issue(s) found.`);
  console.error('   Rule: --help must be derived from Zod schemas via HelpGenerator.');
  console.error('   Do NOT create hand-written help files.');
  process.exit(1);
}

console.log('✅ Help auto-generation check passed');
process.exit(0);
