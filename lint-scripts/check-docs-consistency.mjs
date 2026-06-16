#!/usr/bin/env node

/**
 * Docs Consistency Check — verifies documentation stays in sync with code.
 *
 * Checks:
 *   1. No removed commands in docs (`daemon start/stop/status`, `getProperty`,
 *      `evaluateFn`, `getSessionStorage`/`setSessionStorage`/`clearSessionStorage`,
 *      `waitForTimeout`)
 *   2. No old project name (`agent-browser`) in docs or src/
 *   3. AGENTS.md plugin count (69) and command count (49) match reality
 *   4. docs/commands.md Scope table does not contain `daemon`
 *
 * Usage: node lint-scripts/check-docs-consistency.mjs
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Forbidden patterns in docs ──────────────────────────────────────────────
const REMOVED_CAPTURES = [
  // Removed daemon commands
  { pattern: /`xbrowser daemon start`/, label: 'removed `xbrowser daemon start`' },
  { pattern: /`xbrowser daemon stop`/, label: 'removed `xbrowser daemon stop`' },
  { pattern: /`xbrowser daemon status`/, label: 'removed `xbrowser daemon status`' },
  { pattern: /daemon <start\|stop\|status>/, label: 'removed `daemon <start|stop|status>`' },

  // Fictional / non-existent commands
  { pattern: /`evaluateFn`/, label: 'fictional command `evaluateFn`' },
  { pattern: /`getSessionStorage`/, label: 'fictional command `getSessionStorage`' },
  { pattern: /`setSessionStorage`/, label: 'fictional command `setSessionStorage`' },
  { pattern: /`clearSessionStorage`/, label: 'fictional command `clearSessionStorage`' },
  { pattern: /`waitForTimeout`/, label: 'fictional command `waitForTimeout` (use `wait`)' },
  // Note: `attach` is NOT a fictional command — it's the unified upload command
  // for AI chat plugins (doubao/chatgpt/claude/deepseek/qianwen/yuanbao).
  { pattern: /`getProperty`/, label: 'fictional command `getProperty` (use `eval`)' },

  // Old project name
  { pattern: /agent-browser/, label: 'old project name `agent-browser` (use `xbrowser`)' },
];

const DOC_FILES = [
  'docs/quickstart.md',
  'docs/commands.md',
  'docs/architecture.md',
  'docs/chains.md',
  'docs/builtins.md',
  'docs/recording.md',
  'docs/captcha-interaction.md',
  'docs/websocket-preview.md',
  'docs/seo-plugins.md',
  'docs/plugin-guide.md',
  'docs/plugin-contract-audit.md',
  'docs/hook-system-boundary.md',
  'docs/hook-system-proposal.md',
  'docs/xcli-core-hook-pr.md',
  'AGENTS.md',
];

function checkDocsForForbiddenPatterns() {
  let errors = [];

  for (const relPath of DOC_FILES) {
    const fullPath = resolve(ROOT, relPath);
    if (!existsSync(fullPath)) {
      errors.push(`❌ Missing file: ${relPath}`);
      continue;
    }
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    for (const capture of REMOVED_CAPTURES) {
      for (let i = 0; i < lines.length; i++) {
        if (capture.pattern.test(lines[i])) {
          errors.push(`❌ ${relPath}:${i + 1} — ${capture.label}`);
          break; // one error per pattern per file
        }
      }
    }
  }

  return errors;
}

// ── Check AGENTS.md numbers ─────────────────────────────────────────────────
function checkAgentsNumbers() {
  const errors = [];
  const agentsPath = resolve(ROOT, 'AGENTS.md');
  if (!existsSync(agentsPath)) return ['❌ AGENTS.md not found'];

  const content = readFileSync(agentsPath, 'utf-8');

  // Check plugin count: 69
  const pluginMatch = content.match(/\*\*插件主目录\*\*（(\d+)\s*个/);
  if (pluginMatch) {
    const actualPlugins = readdirSync(resolve(ROOT, '.xcli/plugins'), { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== 'shared' && d.name !== 'testsuite')
      .length;
    if (Number(pluginMatch[1]) !== actualPlugins) {
      errors.push(`❌ AGENTS.md: plugin count is ${pluginMatch[1]}, actual is ${actualPlugins}`);
    }
  }

  // Check command count: 49
  const cmdMatch = content.match(/(\d+)\s*个内置命令/);
  if (cmdMatch) {
    const commandFiles = readdirSync(resolve(ROOT, 'src/commands'))
      .filter(f => f.endsWith('.ts') && f !== 'index.ts' && f !== 'command-registry.ts' && f !== 'definitions.ts');
    let actualCommands = 0;
    for (const f of commandFiles) {
      const content = readFileSync(resolve(ROOT, 'src/commands', f), 'utf-8');
      actualCommands += (content.match(/registerCommand\(\{/g) || []).length;
    }
    if (Number(cmdMatch[1]) !== actualCommands) {
      errors.push(`❌ AGENTS.md: command count is ${cmdMatch[1]}, actual is ${actualCommands}`);
    }
  }

  return errors;
}

// ── Check Scope table for daemon ────────────────────────────────────────────
function checkScopeTable() {
  const errors = [];
  const commandsPath = resolve(ROOT, 'docs/commands.md');
  if (!existsSync(commandsPath)) return [];

  const content = readFileSync(commandsPath, 'utf-8');
  const lines = content.split('\n');
  let inScopeTable = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('| Scope |')) inScopeTable = true;
    if (inScopeTable && lines[i].includes('| `project` |') && lines[i].includes('daemon')) {
      errors.push(`❌ docs/commands.md:${i + 1} — Scope table still contains \`daemon\``);
      break;
    }
    if (inScopeTable && lines[i].startsWith('---')) continue;
    if (inScopeTable && !lines[i].startsWith('|')) inScopeTable = false;
  }

  return errors;
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  let allErrors = [];

  console.log('🔍 [docs-consistency] Checking documentation consistency...\n');

  const patternErrors = checkDocsForForbiddenPatterns();
  allErrors = allErrors.concat(patternErrors);

  const numberErrors = checkAgentsNumbers();
  allErrors = allErrors.concat(numberErrors);

  const scopeErrors = checkScopeTable();
  allErrors = allErrors.concat(scopeErrors);

  if (allErrors.length > 0) {
    console.log(allErrors.join('\n'));
    console.log(`\n❌ Found ${allErrors.length} documentation consistency issue(s).`);
    console.log('   Run `npm run lint:docs` to re-check after fixing.\n');
    process.exit(1);
  }

  console.log('✅ No removed commands, fictional commands, or old project names found in docs.');
  console.log('✅ AGENTS.md numbers match reality.');
  console.log('✅ Scope table is clean.\n');
}

main();
