#!/usr/bin/env node

/**
 * check-hooks-installed.mjs — 本地门禁是否真的挂着（`npm run validate` 的第一步）
 *
 * 新 worktree、或用软链 node_modules 代替 `npm install` 时，`.husky/_`（由 `prepare: husky`
 * 生成、不进 git）不存在：git 找不到钩子文件会静默跳过 pre-commit / commit-msg / pre-push，
 * 提交一秒完成、十几道门禁一道没跑（LRN-20261123-005）。这里在 validate 开头就把它拦下来。
 *
 * 用法：node lint-scripts/check-hooks-installed.mjs
 * 退出：0 通过 / 1 未装钩子（提示怎么装）
 */

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const HOOKS_PATH = '.husky/_';

let configured = '';
try {
  configured = execFileSync('git', ['config', 'core.hooksPath'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch {
  configured = '';
}

const problems = [];
if (configured !== HOOKS_PATH) {
  problems.push(`core.hooksPath = ${JSON.stringify(configured)}（应为 ${HOOKS_PATH}）`);
}
for (const hook of ['pre-commit', 'commit-msg', 'pre-push']) {
  if (!existsSync(fileURLToPath(new URL(`../${HOOKS_PATH}/${hook}`, import.meta.url)))) {
    problems.push(`${HOOKS_PATH}/${hook} 不存在`);
  }
}

if (problems.length > 0) {
  console.error('❌ Husky hooks are not installed in this checkout — local gates would be skipped silently:');
  for (const problem of problems) console.error(`   - ${problem}`);
  console.error('   → 在本 worktree 里执行一次 `npm install`（或 `npx husky`），再用 `ls .husky/_/pre-commit` 确认。');
  process.exit(1);
}

console.log('Husky hooks installed (pre-commit / commit-msg / pre-push).');
