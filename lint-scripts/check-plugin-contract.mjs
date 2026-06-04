#!/usr/bin/env node

import { Core } from '@dyyz1993/xcli-core';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PLUGINS_DIR = resolve(ROOT, '.xcli/plugins');

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
  const entries = pluginEntries();
  const failures = [];
  const issues = [];
  let loadedPlugins = 0;
  let siteCount = 0;
  let commandCount = 0;
  let commandsWithParams = 0;
  let commandsWithExtractedFields = 0;
  let emptyParamCommands = 0;

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

  if (failures.length > 0 || issues.length > 0) {
    console.log(`\n\x1b[33mFound ${failures.length + issues.length} plugin contract issue(s).\x1b[0m`);
    process.exit(1);
  }

  console.log('\x1b[32mAll plugin command parameters are form-extractable.\x1b[0m');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
