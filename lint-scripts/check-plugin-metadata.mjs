#!/usr/bin/env node
/**
 * check-plugin-metadata.mjs
 *
 * 检查所有已安装的插件是否有合法的 package.json（含 xbrowser metadata）。
 *
 * 规则：
 * - 每个插件目录必须有 package.json
 * - package.json 必须包含 xbrowser 字段（或 xbrowser-plugin 关键词）
 * - xbrowser 字段中必须有 description
 *
 * 原因：
 * 没有 package.json 的裸插件：
 * - plugin list 无法显示版本和描述
 * - plugin publish 需要额外 fallback 逻辑
 * - marketplace 无法索引
 * - 用户无法通过 --help 看到插件信息
 */

import { readdirSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const PLUGIN_DIRS = [
  resolve('.xcli/plugins'),
  resolve('../.xcli/plugins'),
  resolve(homedir(), '.xcli/plugins'),
  resolve(homedir(), '.xbrowser/plugins'),
];

const errors = [];
const warnings = [];
const seen = new Set(); // deduplicate by plugin path
let checked = 0;

for (const dir of PLUGIN_DIRS) {
  if (!existsSync(dir)) continue;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginPath = resolve(dir, entry.name);
    const pkgPath = resolve(pluginPath, 'package.json');
    const indexPath = resolve(pluginPath, 'index.ts');
    const indexJsPath = resolve(pluginPath, 'index.js');

    // Deduplicate: skip if already checked this exact path
    if (seen.has(pluginPath)) continue;
    seen.add(pluginPath);

    // Skip directories without plugin entry file
    if (!existsSync(indexPath) && !existsSync(indexJsPath)) continue;

    checked++;

    if (!existsSync(pkgPath)) {
      errors.push(`${entry.name}: 缺少 package.json（路径：${pluginPath}）`);
      continue;
    }

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

      if (!pkg.xbrowser && !(pkg.keywords || []).includes('xbrowser-plugin')) {
        warnings.push(`${entry.name}: package.json 缺少 xbrowser 字段或 xbrowser-plugin 关键词`);
      }

      if (pkg.xbrowser && !pkg.xbrowser.description && !pkg.description) {
        warnings.push(`${entry.name}: 缺少 description`);
      }

      if (pkg.xbrowser && !pkg.xbrowser.commands) {
        // commands 不是必须的（运行时可以从代码提取），但建议声明
        // 这里用 info 级别，不阻塞
      }
    } catch (e) {
      errors.push(`${entry.name}: package.json 解析失败 - ${e.message}`);
    }
  }
}

console.log(`🔍 Checking plugin metadata... (${checked} plugins in ${PLUGIN_DIRS.filter(d => existsSync(d)).length} dirs)`);

if (warnings.length > 0) {
  console.log('');
  for (const w of warnings) {
    console.log(`  ⚠️  ${w}`);
  }
}

if (errors.length > 0) {
  console.log('');
  for (const e of errors) {
    console.log(`  ❌ ${e}`);
  }
  console.log('');
  console.log(`❌ Found ${errors.length} plugin(s) without valid package.json.`);
  console.log('   → Use "xbrowser create <name> --template static" to create plugins properly.');
  console.log('   → Or add a package.json with { "xbrowser": { "description": "..." } }');
  console.log('   → See lint-scripts/RULES.md for guidelines');
  process.exit(1);
}

if (checked === 0) {
  console.log('✅ No plugins found (skipped)');
} else {
  console.log(`✅ Plugin metadata check passed (${checked} plugins, ${warnings.length} warnings)`);
}
