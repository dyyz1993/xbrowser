#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
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

// ── 仓库布局：AGENTS.md §1「所有自动化脚本 → 插件」 ─────────────────────────────
// scripts/ 只允许 release/ 与下面明确保留的工具；一次性脚本留在本地（.gitignore 已全量忽略）。
// 要新增必须同时改这里和 .gitignore——两处都在，说明是有意为之。
const SCRIPTS_ALLOWLIST = new Set([
  'scripts/arena-round.sh',
  'scripts/check-editors.ts',
  'scripts/check-logins.ts',
  'scripts/inline-stealth.mjs',
  'scripts/mcp-smoke.mjs',
]);
// src/ 是 TS 框架代码；.mjs/.cjs/.js 形式的站点自动化只属于插件
const FORBIDDEN_SRC_SCRIPT_EXT = /\.(mjs|cjs|js)$/;

const errors = [];

function gitLines(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

function checkRepoLayout() {
  let trackedScripts;
  let ignoredTracked;
  try {
    trackedScripts = gitLines(['ls-files', '--', 'scripts']);
    // 全仓库范围：任何「已跟踪却被 .gitignore 忽略」的文件都不该存在（数据/报告误入库、ignore 规则写错）
    ignoredTracked = gitLines(['ls-files', '-i', '-c', '--exclude-standard']);
  } catch (error) {
    console.warn(`  (skipped repo-layout checks: git unavailable — ${error.message})`);
    return;
  }

  for (const file of trackedScripts) {
    if (file.startsWith('scripts/release/') || SCRIPTS_ALLOWLIST.has(file)) continue;
    errors.push(
      `${file}: tracked file under scripts/ is not allowlisted — put the capability into a plugin `
      + '(.xcli/plugins/<site>/), or add it to SCRIPTS_ALLOWLIST here AND .gitignore on purpose',
    );
  }

  // 已跟踪却被 .gitignore 判为忽略：要么不该入库（git rm --cached），要么 ignore 规则写错了
  for (const file of ignoredTracked) {
    errors.push(`${file}: tracked but ignored by .gitignore — untrack it (git rm --cached) or fix the ignore rule`);
  }

  const visitSource = (directory) => {
    for (const entry of readdirSync(directory)) {
      const fullPath = join(directory, entry);
      if (statSync(fullPath).isDirectory()) visitSource(fullPath);
      else if (FORBIDDEN_SRC_SCRIPT_EXT.test(entry)) {
        errors.push(`${relative(ROOT, fullPath)}: script file under src/ — site automation belongs in a plugin`);
      }
    }
  };
  visitSource(join(ROOT, 'src'));
}

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

checkRepoLayout();

if (errors.length > 0) {
  console.error('Architecture check failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('Architecture boundaries passed.');
