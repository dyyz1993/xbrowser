#!/usr/bin/env node

/**
 * Docs Consistency Check — verifies documentation stays in sync with code.
 *
 * Checks:
 *   1. No removed commands in docs (`daemon start/stop/status`, `getProperty`,
 *      `evaluateFn`, `getSessionStorage`/`setSessionStorage`/`clearSessionStorage`,
 *      `waitForTimeout`)
 *   2. No old project name (`agent-browser`) in docs or src/
 *   3. AGENTS.md plugin count and command count match reality
 *   4. README.md plugin count and command count match reality
 *   5. docs/commands.md Scope table does not contain `daemon`
 *
 * Usage: node lint-scripts/check-docs-consistency.mjs
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
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

// ── Count what actually exists (shared by the number checks) ────────────────
function countPlugins() {
  return readdirSync(resolve(ROOT, '.xcli/plugins'), { withFileTypes: true })
    // 排除非插件目录：shared/testsuite 是公共资产；node_modules 是插件安装的副产物
    // （git 不跟踪，有它的机器会被误计一个插件，导致本地与 CI 计数不一致）
    .filter(d => d.isDirectory() && d.name !== 'shared' && d.name !== 'testsuite' && d.name !== 'node_modules')
    .length;
}

function countCommands() {
  const commandFiles = readdirSync(resolve(ROOT, 'src/commands'))
    .filter(f => f.endsWith('.ts') && f !== 'index.ts' && f !== 'command-registry.ts' && f !== 'definitions.ts');
  let total = 0;
  for (const f of commandFiles) {
    const content = readFileSync(resolve(ROOT, 'src/commands', f), 'utf-8');
    total += (content.match(/registerCommand\(\{/g) || []).length;
  }
  return total;
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
    const actualPlugins = countPlugins();
    if (Number(pluginMatch[1]) !== actualPlugins) {
      errors.push(`❌ AGENTS.md: plugin count is ${pluginMatch[1]}, actual is ${actualPlugins}`);
    }
  }

  // Check command count: 49
  const cmdMatch = content.match(/(\d+)\s*个内置命令/);
  if (cmdMatch) {
    const actualCommands = countCommands();
    if (Number(cmdMatch[1]) !== actualCommands) {
      errors.push(`❌ AGENTS.md: command count is ${cmdMatch[1]}, actual is ${actualCommands}`);
    }
  }

  return errors;
}

// ── Check README.md numbers ─────────────────────────────────────────────────
// README 对外展示的命令数 / 插件数必须与仓库实际一致（曾同时漂出 57 / 51 / 132 三种口径）。
// 每条规则只在正则命中时校验：文案改写后不再命中则静默跳过，不会误伤。
function checkReadmeNumbers() {
  const errors = [];
  const readmePath = resolve(ROOT, 'README.md');
  if (!existsSync(readmePath)) return errors;

  const content = readFileSync(readmePath, 'utf-8');
  const actualPlugins = countPlugins();
  const actualCommands = countCommands();

  const checks = [
    [/— (\d+) built-in commands/g, 'command count (Features)', actualCommands],
    [/— (\d+) 个内置命令/g, 'command count (特性)', actualCommands],
    [/# (\d+) 个浏览器命令定义/g, 'command count (项目结构)', actualCommands],
    [/\*\*(\d+) site plugins\*\*/g, 'plugin count (Features)', actualPlugins],
    [/\*\*(\d+) 个站点插件\*\*/g, 'plugin count (特性)', actualPlugins],
    [/站点插件（(\d+) 个）/g, 'plugin count (项目结构)', actualPlugins],
    [/\| \*\*Plugin Ecosystem\*\* \| (\d+) plugins/g, 'plugin count (对比表)', actualPlugins],
  ];

  for (const [pattern, label, actual] of checks) {
    for (const match of content.matchAll(pattern)) {
      if (Number(match[1]) !== actual) {
        errors.push(`❌ README.md: ${label} is ${match[1]}, actual is ${actual}`);
      }
    }
  }

  return errors;
}

// ── 文档里的 `xbrowser <site> <command>`：site 是已知插件时，command 必须真实存在 ──────
// 2026-11-27 实录：docs/seo-plugins.md 把 28 条命令写成了不存在的 `<site>-seo` 插件名，
// 还写着 tumblr publish / quora publish-article 这类从未注册过的命令——读者照抄必然报错。
// 共享发布层（shared/publishing）按 options 动态注册命令名，静态扫描看不到，先放进白名单。
const ALWAYS_VALID_COMMANDS = new Set(['draft', 'publish']);

function pluginCommands() {
  const root = resolve(ROOT, '.xcli/plugins');
  const map = new Map();
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || ['shared', 'testsuite', 'node_modules'].includes(entry.name)) continue;
    const names = new Set(ALWAYS_VALID_COMMANDS);
    const visit = (dir) => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, item.name);
        if (item.isDirectory()) {
          if (item.name !== 'node_modules') visit(fullPath);
          continue;
        }
        if (!/\.(ts|js|mjs)$/.test(item.name) || item.name.endsWith('.d.ts')) continue;
        for (const match of readFileSync(fullPath, 'utf-8').matchAll(/\.command\(\s*['"`]([a-z0-9-]+)['"`]/g)) {
          names.add(match[1]);
        }
      }
    };
    visit(join(root, entry.name));
    map.set(entry.name, names);
  }
  return map;
}

function checkDocumentedCommands() {
  const errors = [];
  const plugins = pluginCommands();
  for (const relPath of DOC_FILES) {
    const fullPath = resolve(ROOT, relPath);
    if (!existsSync(fullPath)) continue;
    const lines = readFileSync(fullPath, 'utf-8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      // 带 ❌ 的行是文档刻意写的反例（如 `devto devto-publish`），不判
      if (lines[i].includes('❌')) continue;
      for (const match of lines[i].matchAll(/\bxbrowser\s+([a-z][a-z0-9-]*)\s+([a-z][a-z0-9-]*)/g)) {
        const [, site, command] = match;
        // 未知 site 可能是文档里的占位符 / 脚手架示例，不在这里判
        if (!plugins.has(site)) continue;
        if (!plugins.get(site).has(command)) {
          const known = [...plugins.get(site)].sort().join(', ');
          errors.push(`❌ ${relPath}:${i + 1} — \`xbrowser ${site} ${command}\`: plugin "${site}" has no command "${command}" (has: ${known})`);
        }
      }
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

  const readmeNumberErrors = checkReadmeNumbers();
  allErrors = allErrors.concat(readmeNumberErrors);

  const scopeErrors = checkScopeTable();
  allErrors = allErrors.concat(scopeErrors);
  const commandErrors = checkDocumentedCommands();
  allErrors = allErrors.concat(commandErrors);

  if (allErrors.length > 0) {
    console.log(allErrors.join('\n'));
    console.log(`\n❌ Found ${allErrors.length} documentation consistency issue(s).`);
    console.log('   Run `npm run lint:docs` to re-check after fixing.\n');
    process.exit(1);
  }

  console.log('✅ No removed commands, fictional commands, or old project names found in docs.');
  console.log('✅ AGENTS.md numbers match reality.');
  console.log('✅ README.md numbers match reality.');
  console.log('✅ Scope table is clean.');
  console.log('✅ Documented plugin commands exist.\n');
}

main();
