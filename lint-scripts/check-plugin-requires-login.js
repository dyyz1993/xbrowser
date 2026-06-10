#!/usr/bin/env node

import { readdirSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const PLUGIN_DIRS = [
  resolve('.xcli/plugins'),
  resolve('../.xcli/plugins'),
  resolve(homedir(), '.xcli/plugins'),
  resolve(homedir(), '.xbrowser/plugins'),
];

const NO_LOGIN_PLUGINS = new Set([
  // Search engines
  'baidu', 'bing', 'google',
  // Stock photo sites (public APIs)
  '58pic', '699pic', '9gag', 'artstation', 'behance',
  'deviantart', 'dribbble', 'duitang',
  'flickr', 'freepik', 'gettyimages', 'huaban', 'imgur',
  'jd', 'p500px', 'pexels', 'pixabay',
  'quanjing', 'reddit', 'shutterstock',
  'unsplash',
  // Utility / tools (no auth needed)
  'assert', 'cmf-seats', 'diff', 'image', 'testsuite',
  'ai-search', 'web-automation', 'seo',
  // Public APIs / data
  'steam', 'tumblr', 'github', 'stats',
]);

const errors = [];
const warnings = [];
const seen = new Set();
let checked = 0;

function readIndexSource(pluginPath) {
  for (const file of ['index.ts', 'index.js']) {
    const p = resolve(pluginPath, file);
    if (existsSync(p)) {
      try { return readFileSync(p, 'utf-8'); }
      catch (e) { console.warn(`[requires-login] 无法读取 ${p}:`, e); return null; }
    }
  }
  return null;
}

function checkPlugin(dirName, pluginPath) {
  if (!existsSync(resolve(pluginPath, 'index.ts')) && !existsSync(resolve(pluginPath, 'index.js'))) return;

  const src = readIndexSource(pluginPath);
  if (!src) return;

  checked++;

  // Extract requiresLogin value from createSite() call
  const siteStart = src.indexOf('createSite({');
  if (siteStart === -1) return;
  let depth = 1;
  let i = siteStart + 'createSite({'.length;
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  const siteConfig = src.slice(siteStart + 'createSite({'.length, i - 1);
  const declMatch = siteConfig.match(/requiresLogin:\s*(true|false)/);
  const declared = declMatch ? declMatch[1] === 'true' : null;

  const expected = !NO_LOGIN_PLUGINS.has(dirName);

  if (declared === null && expected) {
    warnings.push(`${dirName}: missing "requiresLogin" in createSite() — expected true (needs login)`);
  } else if (declared === null && !expected) {
    // No login needed, omission is fine
  } else if (declared !== expected) {
    const got = declared ? 'true' : 'false';
    const want = expected ? 'true' : 'false';
    warnings.push(`${dirName}: requiresLogin=${got} — expected ${want}`);
  }
}

for (const dir of PLUGIN_DIRS) {
  if (!existsSync(dir)) continue;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginPath = resolve(dir, entry.name);
    if (seen.has(pluginPath)) continue;
    seen.add(pluginPath);
    checkPlugin(entry.name, pluginPath);
  }
}

if (errors.length > 0 || warnings.length > 0) {
  console.log('🔍 Checking plugin requiresLogin consistency...');
  for (const w of warnings) console.log(`  ⚠️  ${w}`);
  for (const e of errors) console.log(`  ❌ ${e}`);
}

if (checked === 0) {
  console.log('✅ No plugins found (skipped)');
} else if (errors.length === 0 && warnings.length === 0) {
  console.log(`✅ Plugin requiresLogin check passed (${checked} plugins, 0 warnings)`);
} else {
  console.log(`\n⚠️  ${warnings.length} warning(s), ${errors.length} error(s) in requiresLogin declarations`);
  console.log('   → See lint-scripts/RULES.md for requiresLogin guidelines');
  if (errors.length > 0) process.exit(1);
}
