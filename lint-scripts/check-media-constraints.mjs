#!/usr/bin/env node

/**
 * Media generation constraints.
 *
 * Media commands are high-risk because a submitted prompt can succeed while
 * the requested mode, authenticated download context, or traceability fields
 * are wrong. This check encodes the repeated mistakes found during the media
 * generation audit instead of waiting for them to recur in the runtime
 * mistake ledger.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
// Tests copy lint-scripts into an isolated root, then invoke this script from
// there. environment override keeps the script testable without process.chdir.
const CHECK_ROOT = process.env.MEDIA_CONSTRAINTS_ROOT || ROOT;
const PLUGINS_DIR = join(CHECK_ROOT, '.xcli/plugins');
const BASELINE_FILE = join(CHECK_ROOT, 'lint-scripts/media-constraints-baseline.json');

const MEDIA_PLUGINS = new Set((process.env.MEDIA_CONSTRAINTS_PLUGINS || 'gemini,doubao,mureka,suno,udio').split(',').filter(Boolean));
const GENERATE_COMMANDS = new Set([
  'image', 'video', 'music', 'generate-image', 'generate-video',
  'create', 'image-cutout', 'image-vary',
]);
const STATUS_COMMANDS = new Set([
  'music-status', 'video-status', 'music-result', 'video-result',
  'status', 'result',
]);
const REQUIRED_RESULT_FIELDS = ['taskId', 'status', 'mediaUrl', 'localPath'];

const args = new Set(process.argv.slice(2));
const allowUpdate = args.has('--update');
const errors = [];
const debt = [];

function pluginDirs() {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && MEDIA_PLUGINS.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function sourceFiles(pluginName) {
  const dir = join(PLUGINS_DIR, pluginName);
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(dir, entry.name));
}

function relativeFile(path) {
  return relative(CHECK_ROOT, path);
}

function lines(source) {
  return source.split('\n');
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function hasTraceabilityResult(configText) {
  if (/mediaTaskResultSchema|mediaDownloadResultSchema/.test(configText)) return true;
  return REQUIRED_RESULT_FIELDS.every((field) => configText.includes(field));
}

function hasModeVerification(configText, source) {
  const hasModeSwitch = /制作音乐|制作图片|制作视频|Image Mode|Music Mode|safeClickByText/.test(configText + source);
  if (!hasModeSwitch) return true;
  return /musicSelected|imageSelected|videoSelected|取消选择|aria-checked|aria-pressed/.test(source);
}

for (const pluginName of pluginDirs()) {
  for (const filePath of sourceFiles(pluginName)) {
    const source = readFileSync(filePath, 'utf8');
    const executable = stripComments(source);
    const file = relativeFile(filePath);

    // Protected media must not be downloaded outside the browser origin.
    const mediaDownloadPattern = /(?:execSync\(\s*`curl|globalThis\.fetch\(|fetch\(\s*\$\{JSON\.stringify\([^)]+\)\}\),|await fetch\(\s*(?:params\.url|videoSrc|url)\s*\))/;
    const protectedDownloadPattern = /fetch\(\s*\$\{JSON\.stringify\([^)]+\)\}\),\s*\{\s*credentials:\s*['"]include['"]/;
    const unprotected = executable
      .split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => mediaDownloadPattern.test(line) && !protectedDownloadPattern.test(line));
    for (const { line, index } of unprotected) {
      debt.push(`DOWNLOAD:${file}:${index + 1}: media download lacks browser credentials; use page-context fetch(..., { credentials: 'include' })`);
    }
  }

  // Weak async contracts are recorded as debt, not immediate failures, so the
  // existing heterogeneous plugins can be tightened incrementally.
  const indexPath = join(PLUGINS_DIR, pluginName, 'index.ts');
  const source = existsSync(indexPath)
    ? readFileSync(indexPath, 'utf8')
    : sourceFiles(pluginName).map((path) => readFileSync(path, 'utf8')).join('\n');
  const commandBlocks = [...source.matchAll(/site\.command\(\s*['"]([^'"]+)['"]\s*,\s*\{([\s\S]*?)(?=\n {2}site\.command\(|\n {2}\}\);\s*$)/g)];
  for (const [, commandName, configText] of commandBlocks) {
    if (!GENERATE_COMMANDS.has(commandName) && !STATUS_COMMANDS.has(commandName)) continue;
    const key = `${pluginName}.${commandName}`;
    if (!hasTraceabilityResult(configText)) {
      debt.push(`${key}: result contract must expose ${REQUIRED_RESULT_FIELDS.join('/')}`);
    }
    if (GENERATE_COMMANDS.has(commandName) && !hasModeVerification(configText, source)) {
      debt.push(`${key}: switches a generation mode but does not verify the selected mode before submit`);
    }
  }
}

let baseline = [];
if (existsSync(BASELINE_FILE)) {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
    baseline = Array.isArray(parsed.debt) ? parsed.debt : [];
  } catch {
    console.error(`Cannot parse ${BASELINE_FILE}; fix or delete it, then re-run with --update.`);
    process.exit(1);
  }
}

// DOM click() is an existing debt across media plugins: it produces
// isTrusted=false events and is the known cause of ignored mode changes.
// Lock the current set; any new occurrence fails immediately.
const domClickDebt = [];
for (const pluginName of pluginDirs()) {
  for (const filePath of sourceFiles(pluginName)) {
    const source = stripComments(readFileSync(filePath, 'utf8'));
    const domClickPattern = /(?:btn|button|el|element|accept|target|link)\s*\.\s*click\s*\(/;
    for (const [index, line] of lines(source).entries()) {
      if (domClickPattern.test(line)) {
        domClickDebt.push(`${relativeFile(filePath)}:${index + 1}: critical UI uses DOM click() (isTrusted=false); use CDP Input.dispatchMouseEvent/page.mouse.click`);
      }
    }
  }
}
const baselineSet = new Set(baseline);
const currentSet = new Set(debt);
const domBaseline = baseline.filter((item) => item.startsWith('DEBT:DOM_CLICK:'));
const domCurrent = domClickDebt.map((item) => `DEBT:DOM_CLICK:${item}`);
const domAdded = domCurrent.filter((item) => !baselineSet.has(item));
const domRemoved = domBaseline.filter((item) => !currentSet.has(item) && !domCurrent.includes(item));
const resultDebt = debt
  .filter((item) => !item.startsWith('DOWNLOAD:'))
  .map((item) => `DEBT:RESULT:${item}`);
const downloadDebt = debt.filter((item) => item.startsWith('DOWNLOAD:'));
const rawDebt = debt;
const added = [...new Set(resultDebt)].filter((item) => !baselineSet.has(item)).sort();
const addedDownloads = downloadDebt.filter((item) => !baselineSet.has(item)).sort();
const removed = baseline.filter((item) => {
  if (item.startsWith('DEBT:DOM_CLICK:')) return false;
  if (!item.startsWith('DEBT:RESULT:')) return true;
  return !currentSet.has(item.replace('DEBT:RESULT:', ''));
});

if (allowUpdate) {
  const lockedDebt = [...new Set([...resultDebt, ...downloadDebt, ...domCurrent])].sort();
  writeFileSync(BASELINE_FILE, `${JSON.stringify({ debt: lockedDebt }, null, 2)}\n`);
  console.log(`Media constraints baseline written: ${BASELINE_FILE} (${debt.length} entries)`);
}

const resultAdded = added.map((item) => `DEBT:RESULT:${item}`);
if (resultAdded.length > 0 || domAdded.length > 0 || addedDownloads.length > 0 || errors.length > 0) {
  console.error('Media generation constraints failed:');
  for (const error of errors) console.error(`  - ${error}`);
  for (const item of resultAdded) console.error(`  + new debt: ${item.replace('DEBT:RESULT:', '')}`);
  for (const item of domAdded) console.error(`  + new debt: ${item.replace('DEBT:DOM_CLICK:', '')}`);
  for (const item of addedDownloads) console.error(`  + new debt: ${item}`);
  if (removed.length + domRemoved.length > 0 && !allowUpdate) {
    console.error(`Debt shrank by ${removed.length + domRemoved.length}; re-run with --update to lock the gain.`);
  }
  process.exit(1);
}

console.log(`Media generation constraints passed (${errors.length} hard failures, ${rawDebt.length} baseline debt).`);
