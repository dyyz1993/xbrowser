#!/usr/bin/env node

/**
 * Plugin contract audit.
 *
 * 1. parameters schema must be a Zod object (form-extractable) — hard fail.
 * 2. result schema debt baseline — the set of `<plugin>.<command>` entries
 *    without a result schema may only shrink. New commands missing a result
 *    schema fail immediately; removals are reported and tightened via
 *    --update. Baseline file: lint-scripts/plugin-contract-result-baseline.json
 *
 * Flags: --update (write current missing set as new baseline),
 *        --no-baseline (skip the result gate, audit only).
 */

import { Core } from '@dyyz1993/xcli-core';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PLUGINS_DIR = resolve(ROOT, '.xcli/plugins');
const RESULT_BASELINE_FILE = resolve(ROOT, 'lint-scripts/plugin-contract-result-baseline.json');

function getShape(schema) {
  const shapeOrFn = schema?.shape ?? schema?._def?.shape;
  if (!shapeOrFn) return undefined;
  return typeof shapeOrFn === 'function' ? shapeOrFn() : shapeOrFn;
}

function parameterKeys(schema) {
  const shape = getShape(schema);
  return shape ? Object.keys(shape) : [];
}

function schemaKind(schema) {
  return schema?._def?.typeName || (schema ? typeof schema : 'missing');
}

function pluginEntries() {
  if (!existsSync(PLUGINS_DIR)) return [];
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const dir = resolve(PLUGINS_DIR, entry.name);
      const ts = resolve(dir, 'index.ts');
      const js = resolve(dir, 'index.js');
      const indexPath = existsSync(ts) ? ts : existsSync(js) ? js : undefined;
      return { name: entry.name, indexPath };
    })
    .filter(entry => entry.indexPath)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function loadSinglePlugin(entry) {
  const core = new Core({
    name: 'xbrowser-plugin-contract-audit',
    version: '0.0.0',
    description: 'Plugin contract audit',
    configDirName: '.xbrowser',
    envPrefix: 'XBROWSER',
    pluginDirs: [],
  });

  try {
    await core.loader.loadPlugin(entry.indexPath, entry.name);
    return core.loader.getSites();
  } finally {
    await core.loader.unload().catch(() => {});
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const checkResultBaseline = !args.has('--no-baseline');
  const allowUpdate = args.has('--update');

  const entries = pluginEntries();
  const failures = [];
  const issues = [];
  const missingResult = [];
  let loadedPlugins = 0;
  let siteCount = 0;
  let commandCount = 0;
  let commandsWithParams = 0;
  let commandsWithExtractedFields = 0;
  let emptyParamCommands = 0;
  let commandsWithResult = 0;

  for (const entry of entries) {
    let sites;
    try {
      sites = await loadSinglePlugin(entry);
      loadedPlugins++;
    } catch (error) {
      failures.push({
        plugin: entry.name,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    siteCount += sites.length;
    for (const site of sites) {
      for (const summary of site.getAllCommands()) {
        commandCount++;
        const command = site.getCommand(summary.name) || summary;
        const schema = command.parameters;
        const keys = parameterKeys(schema);
        const kind = schemaKind(schema);

        if (command.result) {
          commandsWithResult++;
        } else {
          missingResult.push(`${entry.name}.${summary.name}`);
        }

        if (!schema) {
          issues.push({
            type: 'MISSING_PARAMETERS_SCHEMA',
            plugin: entry.name,
            site: site.name,
            command: summary.name,
            message: 'Declare parameters: z.object({}) for no-argument commands.',
          });
          continue;
        }

        if (!getShape(schema)) {
          issues.push({
            type: 'UNSUPPORTED_PARAMETERS_SCHEMA',
            plugin: entry.name,
            site: site.name,
            command: summary.name,
            schemaKind: kind,
            message: 'Plugin command parameters must be a Zod object so forms can be extracted.',
          });
          continue;
        }

        if (keys.length === 0) {
          emptyParamCommands++;
          continue;
        }

        commandsWithParams++;
        commandsWithExtractedFields++;
      }
    }
  }

  for (const failure of failures) {
    console.log(`\x1b[31m❌ ${failure.plugin}: failed to load\x1b[0m`);
    console.log(`   → ${failure.message.split('\n')[0]}`);
  }

  for (const issue of issues) {
    console.log(`\x1b[31m❌ ${issue.plugin}.${issue.command}: ${issue.type}\x1b[0m`);
    console.log(`   → ${issue.message}`);
  }

  console.log('');
  console.log(`Plugin contract audit: ${loadedPlugins}/${entries.length} plugins loaded`);
  console.log(`Commands: ${commandCount} total, ${commandsWithParams} with params, ${commandsWithExtractedFields} extractable, ${emptyParamCommands} empty`);
  console.log(`Result schema: ${commandsWithResult}/${commandCount} declared, ${missingResult.length} missing`);

  let exitFail = failures.length > 0 || issues.length > 0;

  // ── result schema baseline gate ──
  if (checkResultBaseline) {
    const current = [...new Set(missingResult)].sort();
    let baselineEntries = [];
    if (existsSync(RESULT_BASELINE_FILE)) {
      try {
        const parsed = JSON.parse(readFileSync(RESULT_BASELINE_FILE, 'utf-8'));
        baselineEntries = Array.isArray(parsed.missingResult) ? parsed.missingResult : [];
      } catch {
        console.error(`\x1b[31m❌ Cannot parse ${RESULT_BASELINE_FILE} — fix or delete it, then re-run with --update.\x1b[0m`);
        process.exit(1);
      }
    }
    const baselineSet = new Set(baselineEntries);
    const currentSet = new Set(current);
    const added = current.filter(k => !baselineSet.has(k));
    const removed = baselineEntries.filter(k => !currentSet.has(k));

    if (added.length > 0) {
      exitFail = true;
      console.log(`\n\x1b[31m❌ Result schema debt GREW by ${added.length}:\x1b[0m`);
      for (const key of added) console.log(`   + ${key} — declare a result schema (describe the real shape; z.unknown() is not accepted)`);
    }
    if (removed.length > 0) {
      console.log(`\n\x1b[33mResult schema debt shrank by ${removed.length} (${baselineEntries.length} → ${current.length})${allowUpdate ? ' — baseline updated.' : ' — re-run with --update to lock the gain.'}\x1b[0m`);
    }
    if (allowUpdate) {
      writeFileSync(RESULT_BASELINE_FILE, JSON.stringify({ missingResult: current }, null, 2) + '\n');
      console.log(`Baseline written: ${RESULT_BASELINE_FILE} (${current.length} entries)`);
    }
  }

  if (exitFail) {
    console.log(`\n\x1b[33mFound ${failures.length + issues.length} plugin contract issue(s).\x1b[0m`);
    process.exit(1);
  }

  console.log('\x1b[32mAll plugin command parameters are form-extractable.\x1b[0m');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
