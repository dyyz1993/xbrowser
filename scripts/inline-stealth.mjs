#!/usr/bin/env node
/**
 * scripts/inline-stealth.mjs — 把 stealth-common.cjs 重新内联进 background.js
 *
 * 背景（S164）：importScripts 加载 .cjs 在真实 SW 顶层崩，必须内联。
 * 本脚本是内联块的唯一合法更新通道——改 stealth-common.cjs 后跑一次：
 *   node scripts/inline-stealth.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ext = path.join(dir, '..', '.xcli', 'plugins', 'login-bridge', 'extension');
const commonPath = path.join(ext, 'stealth-common.cjs');
const bgPath = path.join(ext, 'background.js');

const sc = fs.readFileSync(commonPath, 'utf8');
let bg = fs.readFileSync(bgPath, 'utf8');

const BEGIN = '// BEGIN inlined stealth-common.cjs';
const END = '// END inlined stealth-common.cjs';
const TAIL = 'const stealthTabs = new Set();';

// 优先找标准标记对；历史版本（S164 bisect 遗留）用 BISECT-2-END 兜底重建
let beginIdx = bg.indexOf(BEGIN);
let endIdx = bg.indexOf(END);

if (beginIdx === -1 || endIdx === -1) {
  const tailIdx = bg.indexOf(TAIL);
  const legacyEnd = bg.indexOf('// S164-BISECT-2-END');
  if (tailIdx === -1 || legacyEnd === -1 || legacyEnd > tailIdx) {
    console.error('inline block not found in background.js — aborting');
    process.exit(1);
  }
  // 历史内联块从文件顶部 stealth 注释起、BISECT-2-END 止——用 TAIL 前整段重建：
  // 保留 TAIL 之前的 stealthTabs 行，把其上的旧块（含内联源）整体换为标准标记块
  const head = bg.slice(0, bg.indexOf('// S164: stealth-common 内联'));
  bg = head + `${BEGIN}\n${sc}\n${END}\n\n` + TAIL + '\n// S164-BISECT-2-END\n' + bg.slice(tailIdx + TAIL.length + 1);
  fs.writeFileSync(bgPath, bg);
  console.log('legacy inline block rebuilt with standard markers');
  process.exit(0);
}

const replacement = `${BEGIN}\n${sc}\n${END}`;
bg = bg.slice(0, beginIdx) + replacement + bg.slice(endIdx + END.length);
fs.writeFileSync(bgPath, bg);
console.log('inlined stealth-common.cjs →', bgPath, `(${sc.length} bytes)`);
