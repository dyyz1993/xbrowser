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

const UTILITY_PLUGINS = new Set([
  'diff', 'assert', 'image', 'testsuite', 'ai-search',
  'geo-analysis', 'backlink-auto', 'web-automation',
]);

const NAME_PATTERN = /^(xbrowser-plugin-|@xbrowser\/)/;

const errors = [];
const warnings = [];
const seen = new Set();
let checked = 0;

function readIndexSource(pluginPath) {
  for (const file of ['index.ts', 'index.js']) {
    const p = resolve(pluginPath, file);
    if (existsSync(p)) {
      try { return readFileSync(p, 'utf-8'); }
      catch { return null; }
    }
  }
  return null;
}

function hasImport(src, mod) {
  if (!src) return false;
  const re = new RegExp(`(?:import\\s|from\\s)['"]${mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
  return re.test(src);
}

function checkPlugin(dirName, pluginPath) {
  const pkgPath = resolve(pluginPath, 'package.json');

  if (!existsSync(pkgPath)) {
    errors.push(`${dirName}: missing package.json (${pluginPath})`);
    return;
  }

  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')); }
  catch (e) { errors.push(`${dirName}: package.json parse error - ${e.message}`); return; }

  const isUtility = UTILITY_PLUGINS.has(dirName);
  const src = readIndexSource(pluginPath);

  if (!isUtility && !NAME_PATTERN.test(pkg.name || '')) {
    errors.push(`${dirName}: name "${pkg.name}" must match "xbrowser-plugin-{slug}" or "@xbrowser/{slug}"`);
  }

  if (!pkg.type || pkg.type !== 'module') {
    warnings.push(`${dirName}: missing "type": "module"`);
  }

  if (hasImport(src, 'zod')) {
    const deps = pkg.dependencies || {};
    if (!deps['zod']) {
      warnings.push(`${dirName}: imports zod but missing "dependencies.zod"`);
    }
  }

  if (hasImport(src, '@dyyz1993/xcli-core')) {
    const peer = pkg.peerDependencies || {};
    if (!peer['@dyyz1993/xcli-core']) {
      warnings.push(`${dirName}: imports @dyyz1993/xcli-core but missing "peerDependencies.@dyyz1993/xcli-core"`);
    }
  }

  if (!pkg.xbrowser && !(pkg.keywords || []).includes('xbrowser-plugin')) {
    warnings.push(`${dirName}: missing xbrowser field or "xbrowser-plugin" keyword`);
  }

  if (pkg.xbrowser) {
    const missing = [];
    const fields = {
      commands: 'commands (array)',
      slug: 'slug (string)',
      name: 'name (string)',
      description: 'description (string)',
      version: 'version (string)',
      author: 'author (string)',
      tags: 'tags (array)',
      sites: 'sites (array)',
    };

    for (const [key, label] of Object.entries(fields)) {
      if (!pkg.xbrowser[key]) missing.push(label);
    }

    if (!isUtility && !pkg.xbrowser.site) {
      missing.push('site (URL)');
    }

    if (missing.length > 0) {
      warnings.push(`${dirName}: xbrowser missing: ${missing.join(', ')}`);
    }

    if (pkg.xbrowser.slug && pkg.xbrowser.slug !== dirName) {
      warnings.push(`${dirName}: xbrowser.slug "${pkg.xbrowser.slug}" != directory "${dirName}"`);
    }

    if (pkg.xbrowser.version && pkg.version && pkg.xbrowser.version !== pkg.version) {
      warnings.push(`${dirName}: xbrowser.version "${pkg.xbrowser.version}" != package version "${pkg.version}"`);
    }

    if (!pkg.xbrowser.description && !pkg.description) {
      warnings.push(`${dirName}: missing description`);
    }
  }

  const kw = pkg.keywords || [];
  if (!kw.includes('xbrowser')) {
    warnings.push(`${dirName}: keywords missing "xbrowser"`);
  }
  if (!kw.includes('xbrowser-plugin')) {
    warnings.push(`${dirName}: keywords missing "xbrowser-plugin"`);
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

    if (!existsSync(resolve(pluginPath, 'index.ts')) && !existsSync(resolve(pluginPath, 'index.js'))) continue;

    checked++;
    checkPlugin(entry.name, pluginPath);
  }
}

const activeDirs = PLUGIN_DIRS.filter(d => existsSync(d)).length;
console.log(`🔍 Checking plugin metadata... (${checked} plugins in ${activeDirs} dirs)`);

if (warnings.length > 0) {
  console.log('');
  for (const w of warnings) console.log(`  ⚠️  ${w}`);
}

if (errors.length > 0) {
  console.log('');
  for (const e of errors) console.log(`  ❌ ${e}`);
  console.log('');
  console.log(`❌ Found ${errors.length} error(s) in plugin metadata.`);
  console.log('   → Fix package.json: name, xbrowser field, keywords, etc.');
  console.log('   → See lint-scripts/RULES.md for guidelines');
  process.exit(1);
}

if (checked === 0) {
  console.log('✅ No plugins found (skipped)');
} else {
  console.log(`✅ Plugin metadata check passed (${checked} plugins, ${warnings.length} warnings)`);
}
