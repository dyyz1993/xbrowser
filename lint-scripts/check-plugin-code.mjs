#!/usr/bin/env node
/**
 * check-plugin-code.mjs
 *
 * 扫描 .xcli/plugins/ 下所有插件的源码，检查常见语法和风格问题。
 *
 * 规则：
 * 1. 入口文件必须是 index.ts（zhihu 等第三方 JS 除外）
 * 2. export default 必须存在且是函数
 * 3. 不允许裸 return { data: null }（单行）
 * 4. ok()/fail() 调用参数必须是对象字面量，不能是裸标识符
 * 5. package.json 必须有顶层 name/version/description
 * 6. 不允许裸 return { data: ... }（多行）— 必须用 ok()/fail()
 * 7. site.command() 中 result: z.any() 检测
 * 8. site.command() 中 page: z.any() 参数泄露检测
 * 9. 空 catch 块检测
 * 10. 硬编码凭据检测
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

function extractSiteCommandBlocks(code) {
  const blocks = [];
  const re = /\w+\.command\s*\([^{]*\{/g;
  let match;
  while ((match = re.exec(code)) !== null) {
    const start = match.index;
    let depth = 0;
    let i = start;
    let foundOpen = false;
    while (i < code.length) {
      if (code[i] === '{') {
        depth++;
        foundOpen = true;
      } else if (code[i] === '}') {
        depth--;
        if (foundOpen && depth === 0) {
          blocks.push({
            text: code.substring(start, i + 1),
            startPos: start,
          });
          break;
        }
      }
      i++;
    }
  }
  return blocks;
}

function posToLine(code, pos) {
  let line = 1;
  for (let i = 0; i < pos && i < code.length; i++) {
    if (code[i] === '\n') line++;
  }
  return line;
}

function isInsideStringOrComment(lines, lineIdx) {
  for (let i = lineIdx; i >= Math.max(0, lineIdx - 5); i--) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return true;
    if (/^(\/\/|\/\*|\*|-->)/.test(trimmed)) return true;
  }
  const line = lines[lineIdx].trim();
  if (/^(\/\/|#)/.test(line)) return true;
  return false;
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

  // Rule 2: Must have export default
  if (!code.includes('export default') && !code.includes('module.exports')) {
    errors.push(`${entry.name}: 缺少 export default 或 module.exports（插件加载器需要）`);
  } else if (!code.includes('export default') && code.includes('module.exports')) {
    warnings.push(`${entry.name}: 使用 module.exports (CJS)，建议迁移到 export default (ESM)`);
  }

  // Rule 3: No bare return { data: null } (single-line)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^return\s*\{\s*data\s*:/.test(line) && !line.includes('ok(') && !line.includes('fail(')) {
      errors.push(`${entry.name}:${i + 1}: 使用了裸 return { data: ... }，请用 ok() 或 fail()`);
    }
  }

  // Rule 4: ok()/fail() call format
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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

  // Rule 6: Multi-line bare return { data: ... } detection
  {
    const returnRe = /\breturn\s*\{/g;
    let match;
    while ((match = returnRe.exec(code)) !== null) {
      const returnPos = match.index;
      const snippet = code.substring(returnPos, Math.min(returnPos + 200, code.length));
      if (!snippet.includes('data:')) continue;
      if (code.lastIndexOf('ok(', returnPos) > code.lastIndexOf('\n', returnPos) &&
          code.lastIndexOf('ok(', returnPos) > returnPos - 300) continue;
      const afterReturn = code.substring(0, returnPos);
      const lineStart = afterReturn.lastIndexOf('\n') + 1;
      const linePrefix = code.substring(lineStart, returnPos).trim();
      if (linePrefix.length > 0 && !linePrefix.endsWith(')')) continue;
      const nearbyBefore = code.substring(Math.max(0, returnPos - 50), returnPos);
      if (/\b(ok|fail)\s*\([^)]*$/.test(nearbyBefore)) continue;
      const lineNum = posToLine(code, returnPos);
      const snippetFirst = snippet.split('\n')[0].trim();
      if (/^return\s*\{\s*data\s*:/.test(snippetFirst)) continue;
      errors.push(`${entry.name}:${lineNum}: 使用了多行裸 return { data: ... }，请用 ok() 或 fail()`);
    }
  }

  // Rule 7: z.any() or z.record(z.any()) result schema in site.command()
  {
    for (const block of extractSiteCommandBlocks(code)) {
      const nameMatch = block.text.match(/\.command\s*\(\s*['"]([^'"]+)['"]/);
      const cmdName = nameMatch ? nameMatch[1] : '<unknown>';
      const lineNum = posToLine(code, block.startPos);
      if (/result\s*:\s*z\.any\s*\(\s*\)/.test(block.text)) {
        warnings.push(`${entry.name}:${lineNum}: 命令 "${cmdName}" 使用了 result: z.any()，建议定义明确的 result schema`);
      }
      if (/result\s*:\s*z\.record\s*\(\s*z\.any\s*\(\s*\)\s*\)/.test(block.text)) {
        warnings.push(`${entry.name}:${lineNum}: 命令 "${cmdName}" 的 result 使用了 z.record(z.any())，这是安全垫，建议逐步替换为精确的 zod schema`);
      }
    }
  }

  // Rule 8: page: z.any() parameter leakage in site.command()
  {
    for (const block of extractSiteCommandBlocks(code)) {
      const nameMatch = block.text.match(/\.command\s*\(\s*['"]([^'"]+)['"]/);
      const cmdName = nameMatch ? nameMatch[1] : '<unknown>';
      if (/page\s*:\s*z\.any\s*\(\s*\)/.test(block.text)) {
        const lineNum = posToLine(code, block.startPos);
        warnings.push(`${entry.name}:${lineNum}: 命令 "${cmdName}" 暴露了 page: z.any()，这是内部实现细节，不应出现在 API 参数中`);
      }
    }
  }

  // Rule 9: Empty catch blocks
  {
    const catchRe = /\bcatch\s*\{/g;
    let match;
    while ((match = catchRe.exec(code)) !== null) {
      const braceStart = match.index + match[0].length - 1;
      let depth = 1;
      let i = braceStart + 1;
      let body = '';
      while (i < code.length && depth > 0) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') {
          depth--;
          if (depth === 0) break;
        }
        body += code[i];
        i++;
      }
      const trimmedBody = body.trim();
      if (trimmedBody === '') {
        const lineNum = posToLine(code, match.index);
        warnings.push(`${entry.name}:${lineNum}: 空 catch 块，至少应记录错误日志`);
      }
    }
  }

  // Rule 10: Hardcoded credentials detection
  {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = lines[i].trim();

      if (isInsideStringOrComment(lines, i)) continue;
      if (/^(\/\/|#|\/\*|\*)/.test(trimmed)) continue;
      if (/\b(describe|\.describe)\s*\(/.test(line)) continue;
      if (/\.describe\s*\(\s*['"]/.test(line)) continue;

      // Password strings: password = 'xxx' or password: 'xxx' (not in zod schema)
      if (/\bpassword\s*[:=]\s*['"][^'"]{4,}['"]/.test(line) && !/\.describe|z\.\w+\(/.test(line)) {
        errors.push(`${entry.name}:${i + 1}: 可能包含硬编码密码`);
        continue;
      }

      // API keys / secrets / tokens
      if (/(?:api[_-]?key|secret|token)\s*[:=]\s*['"][a-zA-Z0-9]{10,}['"]/.test(line) &&
          !/\.describe|z\.\w+\(|import/.test(line)) {
        // Exclude common non-secret patterns
        if (/\b(process\.env|import|from\s|require)\b/.test(line)) continue;
        errors.push(`${entry.name}:${i + 1}: 可能包含硬编码的 API key/secret/token`);
        continue;
      }

      // Email in variable assignment (not in URL, not in import, not in schema description)
      if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(line) &&
          /=/.test(line) &&
          !/['"]https?:\/\//.test(line) &&
          !/\b(import|from|require)\b/.test(line) &&
          !/\.describe\s*\(/.test(line) &&
          !/\bz\.\w+\(/.test(line)) {
        errors.push(`${entry.name}:${i + 1}: 可能包含硬编码的邮箱地址`);
        continue;
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
