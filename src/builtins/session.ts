import {
  openSession,
  closeSession,
  listSessions,
  closeAllSessions,
} from '../session/session-client.js';

// Note: daemon forwarding is handled in cli/session-routes.ts for the main CLI path.
// This builtin is only used for help text and fallback.

/**
 * A built-in CLI command with help text and an execute function.
 */
export interface BuiltinCommand {
  name: string;
  description: string;
  aliases?: string[];
  help: {
    usage: string;
    description: string;
    options: { name: string; description: string }[];
    examples?: { cmd: string; description: string }[];
  };
  execute: (
    args: string[],
    options: Record<string, unknown>,
    ctx: BuiltinContext
  ) => Promise<void>;
}

/**
 * Minimal execution context for built-in commands.
 */
export interface BuiltinContext {
  cwd: string;
}

export function handleSessionHelp(): string {
  return [
    'Usage: xbrowser session <command> [options]',
    '',
    'Commands:',
    '  open <url> [--name <name>]  Open browser and create session',
    '  close [--name <name>]       Close session',
    '  list, ls                    List active sessions',
    '  kill [--name <name>]        Kill session forcefully',
    '',
    'Options:',
    '  --name <name>  Session name (default: "default")',
    '',
    'Examples:',
    '  xbrowser session open https://example.com',
    '  xbrowser session open https://example.com --name mypage',
    '  xbrowser session close --name mypage',
    '  xbrowser session list',
  ].join('\n');
}

export const sessionOpenBuiltin: BuiltinCommand = {
  name: 'session open',
  description: 'Open browser and create session',
  help: {
    usage: 'xbrowser session open <url> [--name <name>]',
    description: 'Open URL and create a browser session',
    options: [{ name: '--name <name>', description: 'Session name (default: "default")' }],
    examples: [
      { cmd: 'xbrowser session open https://example.com', description: 'Open example.com' },
      {
        cmd: 'xbrowser session open https://example.com --name test',
        description: 'Open with custom name',
      },
    ],
  },
  execute: async (args, options) => {
    const [url] = args;
    const name = (options['name'] as string) || 'default';

    if (!url) {
      console.log('Usage: xbrowser session open <url> [--name <name>]');
      process.exit(1);
    }

    try {
      const info = await openSession(name, url);
      console.log(`Session "${info.name}" opened: ${info.url}`);
      console.log(`ID: ${info.id}`);
    } catch (e: unknown) {
      console.error('Error:', e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  },
};

export const sessionCloseBuiltin: BuiltinCommand = {
  name: 'session close',
  description: 'Close browser session',
  help: {
    usage: 'xbrowser session close [--name <name>]',
    description: 'Close the specified browser session',
    options: [
      { name: '--name <name>', description: 'Session name (default: "default")' },
      { name: '--all', description: 'Close all sessions' },
    ],
    examples: [
      { cmd: 'xbrowser session close', description: 'Close default session' },
      { cmd: 'xbrowser session close --name test', description: 'Close named session' },
      { cmd: 'xbrowser session close --all', description: 'Close all sessions' },
    ],
  },
  execute: async (_args, options) => {
    if (options['all']) {
      await closeAllSessions();
      console.log('All sessions closed');
      return;
    }

    const name = (options['name'] as string) || 'default';
    try {
      await closeSession(name);
      console.log(`Session "${name}" closed`);
    } catch (e: unknown) {
      console.error('Error:', e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  },
};

export const sessionListBuiltin: BuiltinCommand = {
  name: 'session list',
  description: 'List active sessions',
  aliases: ['session ls'],
  help: {
    usage: 'xbrowser session list',
    description: 'List all active browser sessions',
    options: [],
    examples: [{ cmd: 'xbrowser session list', description: 'List all sessions' }],
  },
  execute: async () => {
    try {
      const sessions = await listSessions();
      if (sessions.length === 0) {
        console.log('No active sessions');
        return;
      }
      console.log('Active sessions:');
      for (const s of sessions) {
        console.log(`  ${s.name} (${s.id})`);
      }
    } catch (e: unknown) {
      console.error('Error:', e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  },
};

export const sessionKillBuiltin: BuiltinCommand = {
  name: 'session kill',
  description: 'Force kill session',
  help: {
    usage: 'xbrowser session kill [--name <name>]',
    description: 'Force kill a browser session',
    options: [{ name: '--name <name>', description: 'Session name (default: "default")' }],
    examples: [{ cmd: 'xbrowser session kill --name test', description: 'Kill session' }],
  },
  execute: async (_args, options) => {
    const name = (options['name'] as string) || 'default';
    try {
      await closeSession(name);
      console.log(`Session "${name}" killed`);
    } catch (e: unknown) {
      console.error('Error:', e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  },
};
