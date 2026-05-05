import { parseArgs } from '@dyyz1993/xcli-core';
import { version } from './version.js';
import {
  allBuiltins,
  handleSessionHelp,
  handlePluginHelp,
} from './builtins/index.js';
import {
  openSession,
  closeSession,
  listSessions,
  gotoSession,
  clickSession,
  fillSession,
  screenshotSession,
  evalSession,
  waitForSelectorSession,
  scrollSession,
} from './session/session-client.js';
import { XBrowserPluginLoader } from './plugin/loader.js';
import { PluginInstaller } from './plugin/installer.js';
import { RecorderController } from './recorder/recorder.js';
import { PlaybackEngine } from './recorder/player.js';
import { DaemonManager } from './daemon/daemon.js';
import { getAllSessions } from './worker.js';

let pluginLoader: XBrowserPluginLoader | null = null;
let activeRecorder: RecorderController | null = null;

function getPluginLoader(): XBrowserPluginLoader {
  if (!pluginLoader) {
    pluginLoader = new XBrowserPluginLoader();
  }
  return pluginLoader;
}

function showMainHelp(): void {
  console.log(`
xbrowser v${version} - Browser Automation CLI

Usage:
  xbrowser <command> [options]

Commands:
  session open <url> [--name <n>]   Open browser session
  session close [--name <n>]        Close session
  session list                      List sessions
  session kill [--name <n>]         Kill session
  goto <url>                        Navigate (shortcut)
  click <selector>                  Click element (shortcut)
  fill <selector> <value>           Fill input (shortcut)
  screenshot [--full-page]          Take screenshot
  eval <expression>                 Evaluate JS expression
  wait <selector> [--timeout <ms>]  Wait for element
  scroll <direction> [--distance N] Scroll page (up/down/left/right)
  config <get|set|list>             Manage config
  plugin install <source>           Install plugin
  plugin uninstall <name>           Uninstall plugin
  plugin list                       List plugins
  plugin reload <name>              Reload plugin
  create <name> --template <type>   Create plugin from template
  daemon start [--port <port>]      Start daemon
  daemon stop                       Stop daemon
  daemon status                     Check daemon status
  record start --url <url>          Start recording
  record stop                       Stop recording and save
  record status                     Recording status
  replay <file>                     Replay recording
  help                              Show this help
  --version, -v                     Show version

Global Flags:
  --json                            Output as JSON
  --yaml                            Output as YAML
  --session <name>                  Use specific session
  --help, -h                        Show help

Examples:
  xbrowser session open https://example.com
  xbrowser goto https://example.com
  xbrowser click '#submit-btn'
  xbrowser fill '#email' 'user@example.com'
  xbrowser screenshot --full-page
  xbrowser eval 'document.title'
  xbrowser wait '#content' --timeout 5000
  xbrowser scroll down --distance 300
  xbrowser plugin install ./my-plugin
  xbrowser create my-plugin --template static
  xbrowser record start --url https://example.com
  xbrowser record stop
  xbrowser replay recordings/my-recording.yaml
`);
}

function outputResult(result: unknown, mode: string): void {
  if (mode === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else if (mode === 'yaml') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (typeof result === 'object' && result !== null) {
      const r = result as Record<string, unknown>;
      if (r.ok) {
        console.log('OK');
        for (const [k, v] of Object.entries(r)) {
          if (k !== 'ok') console.log(`  ${k}: ${v}`);
        }
      } else {
        console.error('Error:', r.error || 'Unknown error');
        process.exit(1);
      }
    } else {
      console.log(result);
    }
  }
}

function outputError(message: string, _mode: string): void {
  console.error(message);
  process.exit(1);
}

export async function routeCommand(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const { positional, options } = parsed;

  const mode = options.json ? 'json' : options.yaml ? 'yaml' : 'text';

  if (options.help || options.h) {
    showMainHelp();
    process.exit(0);
  }

  if (options.version || options.v) {
    console.log(`xbrowser v${version}`);
    process.exit(0);
  }

  if (positional.length === 0) {
    showMainHelp();
    process.exit(0);
  }

  const command = positional[0];
  const cmdArgs = positional.slice(1);

  switch (command) {
    case 'session': {
      const sub = cmdArgs[0];
      const subArgs = cmdArgs.slice(1);

      switch (sub) {
        case 'open': {
          const url = subArgs[0];
          const name = (options['name'] as string) || 'default';
          if (!url) {
            console.error('Usage: xbrowser session open <url> [--name <name>]');
            process.exit(1);
          }
          try {
            const info = await openSession(name, url);
            outputResult({ ok: true, id: info.id, name: info.name, url: info.url }, mode);
          } catch (e: unknown) {
            outputError(e instanceof Error ? e.message : String(e), mode);
          }
          break;
        }
        case 'close': {
          const name = (options['name'] as string) || 'default';
          try {
            await closeSession(name);
            outputResult({ ok: true, name }, mode);
          } catch (e: unknown) {
            outputError(e instanceof Error ? e.message : String(e), mode);
          }
          break;
        }
        case 'list':
        case 'ls': {
          try {
            const sessions = await listSessions();
            outputResult({ sessions }, mode);
          } catch (e: unknown) {
            outputError(e instanceof Error ? e.message : String(e), mode);
          }
          break;
        }
        case 'kill': {
          const name = (options['name'] as string) || 'default';
          try {
            await closeSession(name);
            outputResult({ ok: true, name, killed: true }, mode);
          } catch (e: unknown) {
            outputError(e instanceof Error ? e.message : String(e), mode);
          }
          break;
        }
        default:
          console.log(handleSessionHelp());
      }
      break;
    }

    case 'plugin': {
      const sub = cmdArgs[0];
      const subArgs = cmdArgs.slice(1);

      switch (sub) {
        case 'install': {
          const source = subArgs[0];
          if (!source) {
            console.error('Usage: xbrowser plugin install <source> [--name <name>] [--force]');
            process.exit(1);
          }
          try {
            const installer = new PluginInstaller();
            const result = await installer.install(source, {
              name: options['name'] as string | undefined,
              force: !!options['force'],
            });
            outputResult({ ok: true, name: result.name, source: result.source, path: result.path }, mode);
          } catch (e: unknown) {
            outputError(e instanceof Error ? e.message : String(e), mode);
          }
          break;
        }
        case 'uninstall': {
          const name = subArgs[0];
          if (!name) {
            console.error('Usage: xbrowser plugin uninstall <name>');
            process.exit(1);
          }
          try {
            const installer = new PluginInstaller();
            await installer.uninstall(name);
            outputResult({ ok: true, name }, mode);
          } catch (e: unknown) {
            outputError(e instanceof Error ? e.message : String(e), mode);
          }
          break;
        }
        case 'list': {
          try {
            const installer = new PluginInstaller();
            const plugins = await installer.list();
            outputResult({ plugins }, mode);
          } catch (e: unknown) {
            outputError(e instanceof Error ? e.message : String(e), mode);
          }
          break;
        }
        case 'reload': {
          const name = subArgs[0];
          if (!name) {
            console.error('Usage: xbrowser plugin reload <name>');
            process.exit(1);
          }
          try {
            const loader = getPluginLoader();
            await loader.reloadPlugin(name);
            outputResult({ ok: true, name }, mode);
          } catch (e: unknown) {
            outputError(e instanceof Error ? e.message : String(e), mode);
          }
          break;
        }
        default:
          console.log(handlePluginHelp());
      }
      break;
    }

    case 'create': {
      const name = cmdArgs[0];
      if (!name) {
        console.error('Usage: xbrowser create <name> --template <type>');
        process.exit(1);
      }
      const builtin = allBuiltins.find((b) => b.name === 'create');
      if (builtin) {
        await builtin.execute(cmdArgs, options, { cwd: process.cwd() });
      }
      break;
    }

    case 'daemon': {
      const sub = cmdArgs[0];
      const daemon = new DaemonManager();

      switch (sub) {
        case 'start': {
          try {
            const port = options['port'] ? Number(options['port']) : undefined;
            const config = await daemon.start(port);
            outputResult({ ok: true, pid: config.pid, port: config.port }, mode);
          } catch (e: unknown) {
            outputError(e instanceof Error ? e.message : String(e), mode);
          }
          break;
        }
        case 'stop': {
          try {
            await daemon.stop();
            outputResult({ ok: true }, mode);
          } catch (e: unknown) {
            outputError(e instanceof Error ? e.message : String(e), mode);
          }
          break;
        }
        case 'status': {
          const status = daemon.status();
          if (status) {
            outputResult({ running: true, pid: status.pid, port: status.port, startedAt: status.startedAt }, mode);
          } else {
            outputResult({ running: false }, mode);
          }
          break;
        }
        default:
          console.log('Usage: xbrowser daemon <start|stop|status> [--port <port>]');
      }
      break;
    }

    case 'record': {
      const sub = cmdArgs[0];

      switch (sub) {
        case 'start': {
          const url = options['url'] as string;
          if (!url) {
            console.error('Usage: xbrowser record start --url <url>');
            process.exit(1);
          }
          try {
            const sessions = getAllSessions();
            const session = sessions[0];
            if (!session) {
              console.error('No active session. Run "xbrowser session open <url>" first.');
              process.exit(1);
            }
            activeRecorder = new RecorderController(session.page);
            await activeRecorder.start({ url, name: options['name'] as string });
            outputResult({ ok: true, url }, mode);
          } catch (e: unknown) {
            outputError(e instanceof Error ? e.message : String(e), mode);
          }
          break;
        }
        case 'stop': {
          if (!activeRecorder) {
            console.error('No recording in progress');
            process.exit(1);
          }
          try {
            const result = await activeRecorder.stop(options['output'] as string);
            activeRecorder = null;
            outputResult({
              ok: true,
              path: result.path,
              events: result.session.events.length,
              duration: result.session.duration,
            }, mode);
          } catch (e: unknown) {
            outputError(e instanceof Error ? e.message : String(e), mode);
          }
          break;
        }
        case 'status': {
          if (!activeRecorder) {
            outputResult({ recording: false }, mode);
          } else {
            const status = activeRecorder.getStatus();
            outputResult({ recording: status?.isRecording, events: status?.eventCount, duration: status?.duration }, mode);
          }
          break;
        }
        default:
          console.log('Usage: xbrowser record <start|stop|status> [--url <url>]');
      }
      break;
    }

    case 'replay': {
      const filePath = cmdArgs[0];
      if (!filePath) {
        console.error('Usage: xbrowser replay <file>');
        process.exit(1);
      }
      try {
        const sessions = getAllSessions();
        const session = sessions[0];
        if (!session) {
          console.error('No active session. Run "xbrowser session open <url>" first.');
          process.exit(1);
        }
        const engine = PlaybackEngine.fromFile(session.page, filePath);
        const result = await engine.play({
          slowMo: options['slow-mo'] ? Number(options['slow-mo']) : 1,
        });
        outputResult(result, mode);
      } catch (e: unknown) {
        outputError(e instanceof Error ? e.message : String(e), mode);
      }
      break;
    }

    case 'goto': {
      const url = cmdArgs[0];
      if (!url) {
        console.error('Usage: xbrowser goto <url>');
        process.exit(1);
      }
      try {
        const sessionName = (options['session'] as string) || 'default';
        const result = await gotoSession(sessionName, url);
        outputResult(result, mode);
      } catch (e: unknown) {
        outputError(e instanceof Error ? e.message : String(e), mode);
      }
      break;
    }

    case 'click': {
      const selector = cmdArgs[0];
      if (!selector) {
        console.error('Usage: xbrowser click <selector>');
        process.exit(1);
      }
      try {
        const sessionName = (options['session'] as string) || 'default';
        const result = await clickSession(sessionName, selector);
        outputResult(result, mode);
      } catch (e: unknown) {
        outputError(e instanceof Error ? e.message : String(e), mode);
      }
      break;
    }

    case 'fill': {
      const selector = cmdArgs[0];
      const value = cmdArgs[1];
      if (!selector || !value) {
        console.error('Usage: xbrowser fill <selector> <value>');
        process.exit(1);
      }
      try {
        const sessionName = (options['session'] as string) || 'default';
        const result = await fillSession(sessionName, selector, value);
        outputResult(result, mode);
      } catch (e: unknown) {
        outputError(e instanceof Error ? e.message : String(e), mode);
      }
      break;
    }

    case 'screenshot': {
      try {
        const sessionName = (options['session'] as string) || 'default';
        const screenshotOptions: { fullPage?: boolean; type?: 'png' | 'jpeg' } = {};
        if (options['full-page'] || options['fullPage']) {
          screenshotOptions.fullPage = true;
        }
        if (options['type']) {
          screenshotOptions.type = options['type'] as 'png' | 'jpeg';
        }
        const result = await screenshotSession(sessionName, screenshotOptions);
        if (mode === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Screenshot taken (${result.format}, ${result.size} bytes)`);
        }
      } catch (e: unknown) {
        outputError(e instanceof Error ? e.message : String(e), mode);
      }
      break;
    }

    case 'eval': {
      const expression = cmdArgs.join(' ');
      if (!expression) {
        console.error('Usage: xbrowser eval <expression>');
        process.exit(1);
      }
      try {
        const sessionName = (options['session'] as string) || 'default';
        const result = await evalSession(sessionName, expression);
        outputResult(result, mode);
      } catch (e: unknown) {
        outputError(e instanceof Error ? e.message : String(e), mode);
      }
      break;
    }

    case 'wait': {
      const selector = cmdArgs[0];
      if (!selector) {
        console.error('Usage: xbrowser wait <selector> [--timeout <ms>]');
        process.exit(1);
      }
      try {
        const sessionName = (options['session'] as string) || 'default';
        const waitOptions: { state?: string; timeout?: number } = {};
        if (options['timeout']) {
          waitOptions.timeout = Number(options['timeout']);
        }
        if (options['state']) {
          waitOptions.state = options['state'] as string;
        }
        const result = await waitForSelectorSession(sessionName, selector, waitOptions);
        outputResult(result, mode);
      } catch (e: unknown) {
        outputError(e instanceof Error ? e.message : String(e), mode);
      }
      break;
    }

    case 'scroll': {
      const direction = cmdArgs[0] || 'down';
      if (!['up', 'down', 'left', 'right'].includes(direction)) {
        console.error('Direction must be: up, down, left, right');
        process.exit(1);
      }
      try {
        const sessionName = (options['session'] as string) || 'default';
        const scrollOptions: { distance?: number; selector?: string } = {};
        if (options['distance']) {
          scrollOptions.distance = Number(options['distance']);
        }
        if (options['selector']) {
          scrollOptions.selector = options['selector'] as string;
        }
        const result = await scrollSession(sessionName, direction, scrollOptions);
        outputResult(result, mode);
      } catch (e: unknown) {
        outputError(e instanceof Error ? e.message : String(e), mode);
      }
      break;
    }

    case 'config': {
      const configBuiltin = allBuiltins.find((b: { name: string }) => b.name === 'config');
      if (configBuiltin) {
        await configBuiltin.execute(cmdArgs, options, { cwd: process.cwd() });
      }
      break;
    }

    case 'help': {
      showMainHelp();
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      console.error('Run "xbrowser help" for usage information.');
      process.exit(1);
    }
  }
}
