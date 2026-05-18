#!/usr/bin/env node

/**
 * 检查命令注册是否声明了 result schema
 *
 * 所有 registerCommand() 调用必须包含 result 字段，
 * 确保返回值有运行时验证。
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(import.meta.dirname, '..');
const COMMANDS_DIR = join(ROOT, 'src', 'commands');

function findTsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isFile() && entry.endsWith('.ts')) results.push(full);
  }
  return results;
}

let violations = 0;

const files = findTsFiles(COMMANDS_DIR);

for (const file of files) {
  const content = readFileSync(file, 'utf-8');
  const relPath = relative(ROOT, file);

  const matches = content.matchAll(/registerCommand\s*\(\s*\{/g);
  for (const match of matches) {
    const start = match.index;
    const afterMatch = content.substring(start);
    const nameMatch = afterMatch.match(/name\s*:\s*['"]([^'"]+)['"]/);
    const cmdName = nameMatch ? nameMatch[1] : '<unknown>';

    const braceStart = content.indexOf('{', start);
    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < content.length; i++) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) continue;

    const block = content.substring(start, end + 1);
    const usesSpread = block.includes('...');
    if (!block.includes('result') && !usesSpread) {
      console.warn(`⚠️ ${relPath} (${cmdName}): Missing "result" schema. Add a result Zod schema for runtime validation.`);
      violations++;
    }
  }
}

if (violations > 0) {
  console.warn(`\n⚠️ Found ${violations} command(s) without result schema.`);
  console.warn('   → See lint-scripts/RULES.md for guidelines');
  console.warn('   → This is a WARNING. Will become an error once all commands have result schemas.');
} else {
  console.log('✅ All commands have result schema declared');
}
