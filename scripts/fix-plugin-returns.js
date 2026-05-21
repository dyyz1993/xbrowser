#!/usr/bin/env node

/**
 * 批量修复插件返回值，使其符合 xcli-core 的 CommandResult 接口
 *
 * 改造规则：
 * 1. 在 import 语句中添加 ok, fail 的导入
 * 2. 将 `return { data: x, tips: y, message: z }` 改为 `return ok(x, y)`
 * 3. 将 catch 块中的 `return { data: null, tips: y, message: z }` 改为 `return fail(z, y)`
 */

import fs from 'fs';
import path from 'path';

const PLUGINS_DIR = path.resolve(process.cwd(), '.xcli/plugins');

function fixPluginReturn(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let changed = false;
  const newLines = [];

  // 状态跟踪
  let hasImported = false;
  let importsAdded = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. 检查是否已经导入了 ok/fail
    if (line.includes('from \'@dyyz1993/xcli-core\'') || line.includes('from "@dyyz1993/xcli-core"')) {
      hasImported = true;

      // 检查是否已经导入了 ok/fail
      if (!importsAdded && (line.includes('{') || line.includes('import'))) {
        // 解析导入的内容
        const importMatch = line.match(/import\s+(?:type\s+)?(?:{([^}]+)}|(\S+))/);
        if (importMatch) {
          const imports = (importMatch[1] || importMatch[2] || '').split(',').map(s => s.trim());
          if (!imports.includes('ok') && !imports.includes('fail')) {
            // 添加 ok, fail 到导入列表
  
            const newImports = [...imports, 'ok', 'fail'].join(', ');
            const typeKeyword = line.includes('type') && line.includes('{') ? 'type ' : '';

            newLines.push(line.replace(
              /import\s+(?:type\s+)?{([^}]+)}/,
              `import ${typeKeyword}{ ${newImports} }`
            ));
            importsAdded = true;
            changed = true;
            continue;
          }
        }
      }
    }

    // 2. 处理 return { data: x, tips: y, message: z } 模式
    if (!importsAdded && !hasImported && line.includes('import') && line.includes('xcli-core')) {
      // 在第一处 xcli-core 导入后添加一行
      if (line.includes('{') && line.includes('}')) {
        // 已经有解构导入，添加 ok, fail
        const newLine = line.replace(
          /{([^}]+)}/,
          '{ $1, ok, fail }'
        );
        newLines.push(newLine);
        importsAdded = true;
        changed = true;
        continue;
      } else if (line.includes('*')) {
        // 是 * 导入，没问题
        newLines.push(line);
        continue;
      }
    }

    // 3. 处理 return 语句
    const returnMatch = line.match(/^\s*return\s*{/);
    if (returnMatch) {
      // 查找完整的 return 对象（可能跨越多行）
      let objStr = line.substring(returnMatch[0].length);
      let j = i + 1;

      // 收集对象内容直到找到匹配的 }
      while (j < lines.length) {
        objStr += '\n' + lines[j];
        if (lines[j].includes('}')) {
          break;
        }
        j++;
      }

      // 尝试解析对象
      try {
        // 提取 key: value 模式
        const dataMatch = objStr.match(/data\s*:\s*([^,\n]+)/);
        const tipsMatch = objStr.match(/tips\s*:\s*([^,\n]+)/);
        const messageMatch = objStr.match(/message\s*:\s*([^,\n}]+)/);

        if (dataMatch || tipsMatch || messageMatch) {
          // 这是我们要改造的模式
          const dataValue = dataMatch ? dataMatch[1].trim() : 'null';
          const tipsValue = tipsMatch ? tipsMatch[1].trim() : '[]';

          // 判断是成功还是失败
          if (dataValue === 'null' && messageMatch) {
            // 失败模式
            const messageValue = messageMatch[1].trim();
            newLines.push(`    return fail(${messageValue}, ${tipsValue});`);
          } else {
            // 成功模式
            newLines.push(`    return ok(${dataValue}, ${tipsValue});`);
          }

          // 跳过已经处理过的行
          while (i < j) {
            i++;
          }
          changed = true;
          continue;
        }
      } catch (e) {
        // 解析失败，保留原样
      }
    }

    newLines.push(line);
  }

  // 如果没有找到 xcli-core 导入，在文件开头添加
  if (!hasImported && changed) {
    const finalLines = [];
    let inserted = false;

    for (const line of newLines) {
      if (!inserted && line.startsWith('import type')) {
        finalLines.push("import { ok, fail } from '@dyyz1993/xcli-core';");
        finalLines.push(line);
        inserted = true;
      } else {
        finalLines.push(line);
      }
    }

    if (!inserted) {
      finalLines.unshift("import { ok, fail } from '@dyyz1993/xcli-core';");
    }

    return finalLines.join('\n');
  }

  return changed ? newLines.join('\n') : null;
}

function main() {
  const plugins = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  const results = [];

  for (const plugin of plugins) {
    const indexPath = path.join(PLUGINS_DIR, plugin, 'index.ts');

    if (!fs.existsSync(indexPath)) {
      continue;
    }

    try {
      const newContent = fixPluginReturn(indexPath);
      if (newContent) {
        fs.writeFileSync(indexPath, newContent, 'utf8');
        results.push(`✅ ${plugin} - 已修复`);
      } else {
        results.push(`⏭️  ${plugin} - 无需修复`);
      }
    } catch (error) {
      results.push(`❌ ${plugin} - 失败: ${error.message}`);
    }
  }

  console.log('\n批量修复结果:\n');
  for (const result of results) {
    console.log(result);
  }

  const fixed = results.filter(r => r.startsWith('✅')).length;
  console.log(`\n总计: ${results.length} 个插件, 已修复: ${fixed} 个`);
}

main();
