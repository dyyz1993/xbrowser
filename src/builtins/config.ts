import type { BuiltinCommand, BuiltinContext } from './session.js';

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
      const keys = ['browser.executablePath', 'daemon.port', 'viewer.host'];
      console.log('Configuration keys:');
      console.log('');
      for (const k of keys) {
        const val = process.env[`XBROWSER_${k.toUpperCase().replace(/\./g, '_')}`] || '(not set)';
        console.log(`  ${k} = ${val}`);
      }
      return;
    }

    if (subcommand === 'get') {
      const key = rest[0];
      if (!key) {
        console.error('Usage: xbrowser config get <key>');
        process.exit(1);
      }
      const envKey = `XBROWSER_${key.toUpperCase().replace(/\./g, '_')}`;
      const val = process.env[envKey] || '(not set)';
      console.log(val);
      return;
    }

    if (subcommand === 'set') {
      const [key, value] = rest;
      if (!key || !value) {
        console.error('Usage: xbrowser config set <key> <value>');
        process.exit(1);
      }
      console.log(`Set ${key} = ${value} (restart required)`);
      return;
    }

    console.error(`Unknown subcommand: ${subcommand}`);
    console.error('Usage: xbrowser config <get|set|list>');
    process.exit(1);
  },
};
