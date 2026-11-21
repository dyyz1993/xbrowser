#!/usr/bin/env node
/**
 * check-changelog.mjs — CHANGELOG.md 门禁（Keep a Changelog 风格）
 *
 * 约束：
 *   1. package.json 当前版本必须有对应条目 `## [X.Y.Z] - YYYY-MM-DD`
 *   2. 所有版本头必须符合 `## [semver] - ISO 日期` 格式
 *   3. 版本头不允许重复
 *   4. 条目按版本降序（最新在最上）
 *   5. 每个条目至少一个 `### ` 小节（Added / Changed / Fixed / Removed / Security …）
 *   6. 根级 CHANGELOG.md 不得落后于 package.json（最新条目 >= 当前版本）
 *
 * 用法：node lint-scripts/check-changelog.mjs
 * 退出：0 通过 / 1 违规（GitHub Actions 下输出 ::error::）
 */
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'));
const version = pkg.version;
const changelogPath = `${ROOT}CHANGELOG.md`;

let changelog;
try {
  changelog = readFileSync(changelogPath, 'utf8');
} catch {
  console.error('❌ CHANGELOG.md 不存在（根目录）');
  process.exit(1);
}

const errors = [];
const warns = [];

const headerRe = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/;
const entries = [];
let current = null;
for (const line of changelog.split('\n')) {
  const m = line.match(headerRe);
  if (m) {
    current = { version: m[1], date: m[2], line, sections: 0 };
    entries.push(current);
    continue;
  }
  if (current && /^### /.test(line.trim())) current.sections += 1;
}

// 1. 当前版本必须有条目
const cur = entries.find((e) => e.version === version);
if (!cur) {
  errors.push(`package.json 版本 ${version} 在 CHANGELOG.md 没有条目（需要 "## [${version}] - YYYY-MM-DD"，日期取合并日）`);
}

// 2. 头格式 + 3. 重复检测（含任何 `## [` 开头但不合规范的行）
const seen = new Map();
for (const line of changelog.split('\n')) {
  if (!line.startsWith('## [')) continue;
  const m = line.match(headerRe);
  if (!m) {
    errors.push(`版本头格式不合规（应为 "## [X.Y.Z] - YYYY-MM-DD"）：${line.trim()}`);
    continue;
  }
  if (seen.has(m[1])) {
    errors.push(`重复的版本条目 [${m[1]}]（第 ${seen.get(m[1]) + 1} 行与后续重复）`);
  } else {
    seen.set(m[1], changelog.split('\n').indexOf(line));
  }
}

// 4. 降序排列
const versions = entries.map((e) => e.version);
const parts = (v) => v.split('.').map(Number);
const isOlder = (a, b) => {
  const A = parts(a);
  const B = parts(b);
  return A[0] < B[0] || (A[0] === B[0] && (A[1] < B[1] || (A[1] === B[1] && A[2] < B[2])));
};
for (let i = 1; i < versions.length; i++) {
  if (isOlder(versions[i - 1], versions[i])) {
    errors.push(`条目顺序颠倒：[${versions[i - 1]}] 比 [${versions[i]}] 旧，应排在更下面`);
    break;
  }
}

// 5. 每条至少一个 ### 小节
for (const e of entries) {
  if (e.sections === 0) errors.push(`[${e.version}] 条目没有任何 "### " 小节（Keep a Changelog：Added/Changed/Fixed/…）`);
}

// 6. 最新条目不得落后于 package.json
if (entries.length && isOlder(entries[0].version, version)) {
  errors.push(`CHANGELOG 最新条目 [${entries[0].version}] 落后于 package.json [${version}]`);
}

if (errors.length) {
  for (const e of errors) console.error(`::error::${e}`);
  console.error(`\n❌ changelog 检查失败：${errors.length} 项违规（${changelogPath}）`);
  process.exit(1);
}
for (const w of warns) console.warn(`::warning::${w}`);
console.log(`✅ changelog 检查通过（${entries.length} 条，当前 ${version}）`);
