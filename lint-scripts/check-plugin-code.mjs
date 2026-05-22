#!/usr/bin/env node
/**
 * check-plugin-code.mjs
 *
 * 扫描 .xcli/plugins/ 下所有插件的源码，检查常见语法和风格问题。
 *
 * 规则：
 * 1. 入口文件必须是 index.ts（zhihu 等第三方 JS 除外）
 * 2. export default 必须存在且是函数
 * 3. 不允许裸 return { data: null } — 必须用 ok()/fail()
 * 4. ok()/fail() 调用参数必须是对象字面量，不能是裸标识符
 * 5. package.json 必须有顶层 name/version/description
 * 6. 不允许重复 import（value import 和 type import 同时存在同一标识符）
 */

import { readdirSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const PLUGINS_DIR = resolve('.xcli/plugins');

const errors = [];
const warnings = [];
let checked = 0;

if (!existsSync(PLUGINS_DIR)) {
  console.log('✅ No plugins directory found (skipped)');
  process.exit(0);
}

const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  if (entry.name === 'shared' || entry.name === 'node_modules') continue;

  const pluginPath = resolve(PLUGINS_DIR, entry.name);
  const tsPath = resolve(pluginPath, 'index.ts');
  const jsPath = resolve(pluginPath, 'index.js');
  const pkgPath = resolve(pluginPath, 'package.json');

  const hasTs = existsSync(tsPath);
  const hasJs = existsSync(jsPath);

  if (!hasTs && !hasJs) {
    errors.push(`${entry.name}: 没有入口文件 (index.ts 或 index.js)`);
    continue;
  }

  checked++;
  const entryFile = hasTs ? tsPath : jsPath;
  const code = readFileSync(entryFile, 'utf-8');
  const lines = code.split('\n');

  // Rule 1: Prefer TypeScript
  if (hasJs && !hasTs) {
    warnings.push(`${entry.name}: 使用 JS 入口 (index.js)，建议迁移到 TypeScript`);
  }

  // Rule 2: Must have export default (warning for CJS third-party plugins)
  if (!code.includes('export default') && !code.includes('module.exports')) {
    errors.push(`${entry.name}: 缺少 export default 或 module.exports（插件加载器需要）`);
  } else if (!code.includes('export default') && code.includes('module.exports')) {
    warnings.push(`${entry.name}: 使用 module.exports (CJS)，建议迁移到 export default (ESM)`);
  }

  // Rule 3: No bare return { data: null } patterns — use ok()/fail()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Catch: return { data: null, tips: [...] } — should be ok()/fail()
    if (/^return\s*\{\s*data\s*:/.test(line) && !line.includes('ok(') && !line.includes('fail(')) {
      errors.push(`${entry.name}:${i + 1}: 使用了裸 return { data: ... }，请用 ok() 或 fail()`);
    }
  }

  // Rule 4: ok()/fail() call format — must be ok({...}, tips) not ok(data: ..., tips: ...)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Catch: ok(data: ... or fail(data: ... — missing { around args
    if (/\b(ok|fail)\(\s*(data|value|result)\s*:/.test(line)) {
      errors.push(`${entry.name}:${i + 1}: ok()/fail() 参数缺少对象花括号 {}，应为 ok({ data: ... }, tips)`);
    }
  }

  // Rule 5: package.json top-level fields
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (!pkg.name) {
        warnings.push(`${entry.name}: package.json 缺少顶层 name 字段`);
      }
      if (!pkg.version) {
        warnings.push(`${entry.name}: package.json 缺少顶层 version 字段`);
      }
      if (!pkg.description && !(pkg.xbrowser && pkg.xbrowser.description)) {
        warnings.push(`${entry.name}: package.json 缺少 description`);
      }
    } catch {
      errors.push(`${entry.name}: package.json JSON 解析失败`);
    }
  } else {
    errors.push(`${entry.name}: 缺少 package.json`);
  }

  // Rule 6: Duplicate imports (same identifier as value import AND type import)
  if (hasTs) {
    const importMap = new Map();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match: import { foo } from '...'
      const valMatch = line.match(/^import\s*\{([^}]+)\}\s*from/);
      if (valMatch) {
        for (const id of valMatch[1].split(',').map(s => s.trim())) {
          if (!importMap.has(id)) importMap.set(id, []);
          importMap.get(id).push({ line: i + 1, type: 'value' });
        }
      }
      // Match: import type { foo } from '...'
      const typeMatch = line.match(/^import\s+type\s*\{([^}]+)\}\s*from/);
      if (typeMatch) {
        for (const id of typeMatch[1].split(',').map(s => s.trim())) {
          if (!importMap.has(id)) importMap.set(id, []);
          importMap.get(id).push({ line: i + 1, type: 'type' });
        }
      }
    }
    for (const [id, locs] of importMap) {
      const valLocs = locs.filter(l => l.type === 'value');
      const typeLocs = locs.filter(l => l.type === 'type');
      if (valLocs.length > 0 && typeLocs.length > 0) {
        warnings.push(`${entry.name}: "${id}" 同时有 value import (L${valLocs[0].line}) 和 type import (L${typeLocs[0].line})`);
      }
    }
  }
}

console.log(`🔍 Checking plugin code quality... (${checked} plugins)`);

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
  console.log(`❌ Found ${errors.length} plugin code issue(s).`);
  process.exit(1);
}

if (checked === 0) {
  console.log('✅ No plugins found (skipped)');
} else {
  console.log(`✅ Plugin code check passed (${checked} plugins, ${warnings.length} warnings)`);
}
