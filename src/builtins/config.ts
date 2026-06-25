import type { BuiltinCommand, BuiltinContext } from './session.js';
import { loadConfig, getConfigValue, setConfigValue } from '../config.js';

export const configBuiltin: BuiltinCommand = {
  name: 'config',
  description: 'Manage xbrowser configuration',
  aliases: [],
  help: {
    usage: 'xbrowser config <get|set|list> [key] [value]',
    description: 'View or modify xbrowser persistent config (~/.xbrowser/config.json)',
    options: [],
    examples: [
      { cmd: 'xbrowser config list', description: 'List all config keys' },
      { cmd: 'xbrowser config get browser.executablePath', description: 'Get config value' },
      {
        cmd: 'xbrowser config set browser.executablePath /usr/bin/chromium',
        description: 'Set config value',
      },
    ],
  },
  execute: async (args, _options, _ctx: BuiltinContext) => {
    const [subcommand, ...rest] = args;

    if (!subcommand || subcommand === 'list') {
      const config = loadConfig();
      // Flatten nested config to dot-notation keys for display
      function flatten(obj: Record<string, unknown>, prefix = ''): Array<{ key: string; value: unknown }> {
        const entries: Array<{ key: string; value: unknown }> = [];
        for (const [k, v] of Object.entries(obj)) {
          const fullKey = prefix ? `${prefix}.${k}` : k;
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            entries.push(...flatten(v as Record<string, unknown>, fullKey));
          } else {
            entries.push({ key: fullKey, value: v });
          }
        }
        return entries;
      }
      const entries = flatten(config);
      if (entries.length === 0) {
        console.log('Configuration is empty');
        return;
      }
      console.log('Configuration:');
      console.log('');
      for (const { key, value } of entries) {
        console.log(`  ${key} = ${value}`);
      }
      return;
    }

    if (subcommand === 'get') {
      const key = rest[0];
      if (!key) {
        console.error('Usage: xbrowser config get <key>');
        process.exit(1);
      }
      const val = getConfigValue(key);
      console.log(val !== undefined ? String(val) : '(not set)');
      return;
    }

    if (subcommand === 'set') {
      const [key, value] = rest;
      if (!key || value === undefined) {
        console.error('Usage: xbrowser config set <key> <value>');
        process.exit(1);
      }
      // Validate key against known config schema
      const knownKeys = new Set([
        'browser.executablePath', 'browser.headless', 'browser.args',
        'captcha.notifyUrl', 'captcha.autoOpen', 'captcha.timeout', 'captcha.strategy',
        'preview.port', 'preview.quality', 'preview.fps',
      ]);
      if (!knownKeys.has(key) && !key.startsWith('browser.') && !key.startsWith('captcha.') && !key.startsWith('preview.')) {
        console.warn(`⚠️ Unknown config key: "${key}". Known keys: browser.*, captcha.*, preview.*`);
      }
      setConfigValue(key, value);
      console.log(`Set ${key} = ${value}`);
      return;
    }

    console.error(`Unknown subcommand: ${subcommand}`);
    console.error('Usage: xbrowser config <get|set|list>');
    process.exit(1);
  },
};
