#!/usr/bin/env node
/**
 * 插件完成度看板生成 + 债务闸门
 *
 * 做两件事：
 *   1. 扫描 .xcli/plugins/*，统计每个插件的命令数/测试覆盖，生成 docs/plugin-status.md
 *   2. 与 baseline 对比：当前债务 > baseline → exit 1（禁止债务增长）
 *
 * 分类：
 *   DONE     有命令 + 有测试
 *   NO_TEST  有命令 + 无测试   （债务）
 *   SCAFFOLD 无命令（纯壳）     （债务）
 *   LOAD_ERR 加载失败
 *
 * 用法：node lint-scripts/check-plugin-status.mjs
 *   --no-baseline  跳过 baseline 闸门（仅生成看板）
 *   --update       债务下降时自动更新 baseline 文件
 */

import { Core } from '@dyyz1993/xcli-core';
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PLUGINS_DIR = resolve(ROOT, '.xcli/plugins');
const TESTS_DIR = resolve(ROOT, 'tests/plugins');
const STATUS_FILE = resolve(ROOT, 'docs/plugin-status.md');
const BASELINE_FILE = resolve(import.meta.dirname, 'plugin-status-baseline.json');

const SKIP_DIRS = new Set(['shared', 'node_modules']);
const SKIP_FILES = new Set(['package.json', 'tsconfig.json', 'types.d.ts']);

// ---------- 收集插件目录 ----------
function pluginEntries() {
  if (!existsSync(PLUGINS_DIR)) return [];
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
    .map((e) => {
      const dir = resolve(PLUGINS_DIR, e.name);
      const ts = resolve(dir, 'index.ts');
      const js = resolve(dir, 'index.js');
      const indexPath = existsSync(ts) ? ts : existsSync(js) ? js : undefined;
      return { name: e.name, dir, indexPath };
    })
    .filter((e) => e.indexPath)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- 加载单个插件，返回命令元数据 ----------
async function loadSinglePlugin(entry) {
  const core = new Core({
    name: 'xbrowser-plugin-status-audit',
    version: '0.0.0',
    description: 'Plugin status audit',
    configDirName: '.xbrowser',
    envPrefix: 'XBROWSER',
    pluginDirs: [],
  });
  try {
    await core.loader.loadPlugin(entry.indexPath, entry.name);
    const sites = core.loader.getSites();
    const commands = [];
    let siteUrl = '';
    let siteName = '';
    for (const site of sites) {
      siteName = site.name;
      siteUrl = site.url || '';
      for (const summary of site.getAllCommands()) {
        const cmd = site.getCommand(summary.name) || summary;
        commands.push({
          name: summary.name,
          scope: cmd.scope || summary.scope || '?',
          hasHandler: typeof (cmd.handler || summary.handler) === 'function',
        });
      }
    }
    return { siteName, siteUrl, commands };
  } finally {
    await core.loader.unload().catch(() => {});
  }
}

// ---------- 读 package.json 拿 url（加载失败时的兜底） ----------
function urlFromPackageJson(dir) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
    return pkg?.xbrowser?.site || pkg?.xbrowser?.url || '';
  } catch {
    return '';
  }
}

function countLines(filePath) {
  try {
    return readFileSync(filePath, 'utf8').split('\n').length;
  } catch {
    return 0;
  }
}

function hasTest(name) {
  return existsSync(resolve(TESTS_DIR, `${name}.test.ts`));
}

// ---------- 主流程 ----------
async function main() {
  const args = new Set(process.argv.slice(2));
  const checkBaseline = !args.has('--no-baseline');
  const allowUpdate = args.has('--update');

  const entries = pluginEntries();
  const plugins = [];

  for (const entry of entries) {
    const lines = countLines(entry.indexPath);
    const tested = hasTest(entry.name);
    let loaded;
    try {
      loaded = await loadSinglePlugin(entry);
    } catch (err) {
      plugins.push({
        name: entry.name, lines, tested,
        status: 'LOAD_ERR',
        commandCount: 0,
        scopes: [],
        url: urlFromPackageJson(entry.dir),
        error: (err instanceof Error ? err.message : String(err)).split('\n')[0],
      });
      continue;
    }
    const commandCount = loaded.commands.length;
    const scopes = [...new Set(loaded.commands.map((c) => c.scope))].sort();
    let status;
    if (commandCount === 0) status = 'SCAFFOLD';
    else if (tested) status = 'DONE';
    else status = 'NO_TEST';
    plugins.push({
      name: entry.name, lines, tested, status,
      commandCount, scopes,
      url: loaded.siteUrl || urlFromPackageJson(entry.dir),
    });
  }

  // 分类
  const done = plugins.filter((p) => p.status === 'DONE');
  const noTest = plugins.filter((p) => p.status === 'NO_TEST');
  const scaffold = plugins.filter((p) => p.status === 'SCAFFOLD');
  const loadErr = plugins.filter((p) => p.status === 'LOAD_ERR');
  const debt = noTest.length + scaffold.length + loadErr.length;

  // ---------- 写看板 ----------
  writeStatusBoard({
    total: plugins.length,
    done: done.length,
    noTest: noTest.length,
    scaffold: scaffold.length,
    loadErr: loadErr.length,
    debt,
    doneList: done, noTestList: noTest, scaffoldList: scaffold, loadErrList: loadErr,
  });

  // ---------- baseline 闸门 ----------
  const today = new Date().toISOString().slice(0, 10);
  let baseline = null;
  if (existsSync(BASELINE_FILE)) {
    baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  }
  const baselineVal = baseline?.baseline ?? debt;

  console.log('');
  console.log(`Plugin status: ${plugins.length} plugins · DONE ${done.length} · NO_TEST ${noTest.length} · SCAFFOLD ${scaffold.length} · LOAD_ERR ${loadErr.length}`);
  console.log(`Debt: ${debt} / baseline ${baselineVal}`);

  if (loadErr.length > 0) {
    console.log('');
    for (const p of loadErr) {
      console.log(`\x1b[31m⚠️  ${p.name}: load error — ${p.error}\x1b[0m`);
    }
  }

  // 没有传入 --no-baseline 才检查闸门
  if (checkBaseline) {
    if (debt > baselineVal) {
      console.log(`\n\x1b[31m❌ Plugin debt GREW: ${debt} > baseline ${baselineVal}.\x1b[0m`);
      console.log(`   新增插件必须同时带测试，或先跑一次生成看板并提高 baseline。`);
      console.log(`   看板已刷新：docs/plugin-status.md`);
      process.exit(1);
    }
    if (debt < baselineVal && allowUpdate) {
      const updated = { baseline: debt, updatedAt: today, note: `auto-lowered from ${baselineVal}` };
      writeFileSync(BASELINE_FILE, JSON.stringify(updated, null, 2) + '\n');
      console.log(`\x1b[32m✓ Debt decreased ${baselineVal}→${debt}; baseline auto-updated.\x1b[0m`);
    } else if (debt < baselineVal) {
      console.log(`\x1b[33m⏳ Debt decreased ${baselineVal}→${debt} but --update not set; baseline unchanged.\x1b[0m`);
    }
  }

  console.log(`\x1b[32m✓ Plugin status board written to docs/plugin-status.md\x1b[0m`);
}

// ---------- 看板 Markdown ----------
function scopeBadge(s) {
  if (s === 'project') return '`project`';
  return `\`${s}\``;
}

function writeStatusBoard(s) {
  const lines = [];
  lines.push('# 插件完成度看板');
  lines.push('');
  lines.push('> **自动生成，请勿手改** · 由 `lint-scripts/check-plugin-status.mjs` 生成');
  lines.push(`> 生成时间：${new Date().toISOString().slice(0, 10)} · 规范见 \`docs/plans/2026-06-27-plugin-completion-spec.md\``);
  lines.push('');
  lines.push('## 汇总');
  lines.push('');
  lines.push(`| 指标 | 值 |`);
  lines.push(`|------|-----|`);
  lines.push(`| 插件总数 | ${s.total} |`);
  lines.push(`| ✅ 已完成（有实现+有测试） | ${s.done} |`);
  lines.push(`| 🟡 有实现无测试 | ${s.noTest} |`);
  lines.push(`| 🔴 scaffold 待实现 | ${s.scaffold} |`);
  if (s.loadErr > 0) lines.push(`| ⛔ 加载失败 | ${s.loadErr} |`);
  lines.push(`| **当前债务** | **${s.debt}** |`);
  lines.push('');
  lines.push('> 债务 = 🟡无测试 + 🔴scaffold + ⛔加载失败。目标：债务 → 0。');
  lines.push('');

  // Scaffold
  lines.push(`## 🔴 Scaffold 待实现（${s.scaffoldList.length}）`);
  lines.push('');
  lines.push('| 插件 | 行数 | URL |');
  lines.push('|------|------|-----|');
  for (const p of [...s.scaffoldList].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`| ${p.name} | ${p.lines} | ${p.url} |`);
  }
  lines.push('');

  // No test (P1 priority)
  lines.push(`## 🟡 有实现无测试（${s.noTestList.length}） — P1 优先`);
  lines.push('');
  lines.push('| 插件 | 行数 | 命令数 | scope |');
  lines.push('|------|------|--------|-------|');
  for (const p of [...s.noTestList].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`| ${p.name} | ${p.lines} | ${p.commandCount} | ${p.scopes.map(scopeBadge).join(', ')} |`);
  }
  lines.push('');

  // Load errors
  if (s.loadErrList.length > 0) {
    lines.push(`## ⛔ 加载失败（${s.loadErrList.length}）`);
    lines.push('');
    lines.push('| 插件 | 错误 |');
    lines.push('|------|------|');
    for (const p of [...s.loadErrList].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`| ${p.name} | ${p.error} |`);
    }
    lines.push('');
  }

  // Done
  lines.push(`## ✅ 已完成（${s.doneList.length}）`);
  lines.push('');
  lines.push('| 插件 | 命令数 | scope |');
  lines.push('|------|--------|-------|');
  for (const p of [...s.doneList].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`| ${p.name} | ${p.commandCount} | ${p.scopes.map(scopeBadge).join(', ')} |`);
  }
  lines.push('');

  writeFileSync(STATUS_FILE, lines.join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
