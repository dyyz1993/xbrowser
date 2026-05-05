import { parseArgs } from '@dyyz1993/xcli-core';
import { version } from './version.js';
import { executeCommand, executeChain, isChainInput } from './executor.js';
import {
  openSession,
  closeSession,
  listSessions,
  getAllSessions,
} from './session/session-client.js';
import {
  allBuiltins,
  handleSessionHelp,
  handlePluginHelp,
} from './builtins/index.js';
import { XBrowserPluginLoader } from './plugin/loader.js';
import { PluginInstaller } from './plugin/installer.js';
import { RecorderController } from './recorder/recorder.js';
import { PlaybackEngine } from './recorder/player.js';
import { DaemonManager } from './daemon/daemon.js';
import { generateJSScript, generatePythonScript, generateBashScript } from './commands/convert.js';
import { extractAndSave, printExtractSummary } from './commands/extract.js';
import { filterRecording, parseExcludeTypes } from './commands/filter.js';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

let pluginLoader: XBrowserPluginLoader | null = null;
let activeRecorder: RecorderController | null = null;

function getPluginLoader(): XBrowserPluginLoader {
  if (!pluginLoader) pluginLoader = new XBrowserPluginLoader();
  return pluginLoader;
}

function showMainHelp(): void {
  console.log(`
xbrowser v${version} - Browser Automation CLI

Usage:
  xbrowser <command> [options]
  xbrowser "goto https://example.com && title && click '#btn'"

Commands:
  session open <url> [--name <n>]   Open browser session
  session close [--name <n>]        Close session
  session list                      List sessions
  session kill [--name <n>]         Kill session
  goto <url>                        Navigate to URL
  click <selector>                  Click element
  fill <selector> <value>           Fill input
  screenshot [--full-page]          Take screenshot
  eval <expression>                 Evaluate JS
  wait <selector> [--timeout <ms>]  Wait for element
  scroll <direction> [--distance N] Scroll page
  title                             Get page title
  url                               Get current URL
  html [--selector <sel>]           Get HTML content
  text [--selector <sel>]           Get text content
  convert <rec.yaml> <out.{js,py,sh}> Convert recording to script
  extract <rec.yaml>                Extract LLM-ready summary
  filter <in.yaml> <out.yaml>       Filter recording events
  config <get|set|list>             Manage config
  plugin install <source>           Install plugin
  plugin uninstall <name>           Uninstall plugin
  plugin list                       List plugins
  plugin reload <name>              Reload plugin
  create <name> --template <type>   Create plugin
  daemon start [--port <port>]      Start daemon
  daemon stop                       Stop daemon
  daemon status                     Check status
  record start --url <url>          Start recording
  record stop                       Stop recording
  record status                     Recording status
  replay <file>                     Replay recording
  help                              Show this help
  --version, -v                     Show version

Chain Execution:
  xbrowser "goto https://example.com && title && click '#btn'"
  xbrowser "goto https://example.com ; screenshot"

Global Flags:
  --json                            Output as JSON
  --yaml                            Output as YAML
  --session <name>                  Use specific session
  --cdp <endpoint>                  Connect via CDP (url, port, or 'auto')
  --help, -h                        Show help
`);
}

function outputResult(result: unknown, mode: string): void {
  if (mode === 'json' || mode === 'yaml') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>;
    if (r.success === false) {
      console.error('Error:', r.message || 'Unknown error');
      process.exit(1);
    }
    const data = r.data as Record<string, unknown> | null;
    if (data && typeof data === 'object') {
      if (data.ok === false) {
        console.error('Error:', data.error || 'Unknown error');
        process.exit(1);
      }
      console.log('OK');
      for (const [k, v] of Object.entries(data)) {
        if (k !== 'ok' && k !== 'data')
          console.log(
            `  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`
          );
      }
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } else {
    console.log(result);
  }
}

function outputError(message: string): void {
  console.error(message);
  process.exit(1);
}

export async function routeCommand(argv: string[]): Promise<void> {
  if (argv.length === 1 && isChainInput(argv[0])) {
    const chainResult = await executeChain(argv[0]);
    for (const step of chainResult.steps) {
      if (step.success) {
        console.log(`[OK] ${step.raw}`);
        if (step.data && typeof step.data === 'object') {
          const d = step.data as Record<string, unknown>;
          for (const [k, v] of Object.entries(d)) {
            if (k !== 'ok') console.log(`     ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
          }
        }
      } else {
        console.error(`[FAIL] ${step.raw}: ${step.message}`);
      }
    }
    if (chainResult.stoppedReason) {
      console.error(`Stopped: ${chainResult.stoppedReason}`);
    }
    if (!chainResult.success) process.exit(1);
    return;
  }

  const parsed = parseArgs(argv);
  const { positional, options } = parsed;
  const mode = options.json
    ? 'json'
    : options.yaml
      ? 'yaml'
      : 'text';
  const sessionName = (options.session as string) || 'default';
  const cdpEndpoint = options.cdp as string | undefined;

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

  try {
    switch (command) {
      case 'session':
        await handleSession(cmdArgs, options, mode, cdpEndpoint);
        break;
      case 'plugin':
        await handlePlugin(cmdArgs, options, mode);
        break;
      case 'create':
        handleCreate(cmdArgs, options);
        break;
      case 'daemon':
        handleDaemon(cmdArgs, options, mode);
        break;
      case 'record':
        await handleRecord(cmdArgs, options, mode);
        break;
      case 'replay':
        await handleReplay(cmdArgs, options, mode);
        break;
      case 'config':
        handleConfig(cmdArgs, options);
        break;
      case 'convert':
        handleConvert(cmdArgs, mode);
        break;
      case 'extract':
        handleExtract(cmdArgs, mode);
        break;
      case 'filter':
        handleFilter(cmdArgs, mode);
        break;
      case 'help':
        showMainHelp();
        break;
      default: {
        const fullInput = argv.join(' ');
        if (isChainInput(fullInput)) {
          const chainResult = await executeChain(fullInput, { cdpEndpoint, sessionName });
          for (const step of chainResult.steps) {
            if (step.success) {
              console.log(`[OK] ${step.raw}`);
            } else {
              console.error(`[FAIL] ${step.raw}: ${step.message}`);
            }
          }
          if (!chainResult.success) process.exit(1);
        } else {
          await handleBrowserCommand(command, cmdArgs, options, sessionName, mode);
        }
      }
    }
  } catch (e: unknown) {
    outputError(e instanceof Error ? e.message : String(e));
  }
}

async function handleSession(
  args: string[],
  options: Record<string, unknown>,
  mode: string,
  cdpEndpoint?: string
): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case 'open': {
      const url = args[1];
      const name = (options.name as string) || 'default';
      if (!url)
        outputError('Usage: xbrowser session open <url> [--name <name>] [--cdp <endpoint>]');
      const info = await openSession(name, url, { cdpEndpoint });
      outputResult({ ok: true, ...info }, mode);
      break;
    }
    case 'close': {
      const name = (options.name as string) || 'default';
      await closeSession(name);
      outputResult({ ok: true, name }, mode);
      break;
    }
    case 'list':
    case 'ls': {
      const sessions = await listSessions();
      outputResult({ sessions }, mode);
      break;
    }
    case 'kill': {
      const name = (options.name as string) || 'default';
      await closeSession(name);
      outputResult({ ok: true, name, killed: true }, mode);
      break;
    }
    default:
      console.log(handleSessionHelp());
  }
}

async function handlePlugin(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const sub = args[0];
  const subArgs = args.slice(1);
  const installer = new PluginInstaller();

  switch (sub) {
    case 'install': {
      const source = subArgs[0];
      if (!source)
        outputError(
          'Usage: xbrowser plugin install <source> [--name <name>] [--force]'
        );
      const result = await installer.install(source, {
        name: options.name as string | undefined,
        force: !!options.force,
      });
      outputResult(
        { ok: true, name: result.name, source: result.source, path: result.path },
        mode
      );
      break;
    }
    case 'uninstall': {
      const name = subArgs[0];
      if (!name) outputError('Usage: xbrowser plugin uninstall <name>');
      await installer.uninstall(name);
      outputResult({ ok: true, name }, mode);
      break;
    }
    case 'list': {
      const plugins = await installer.list();
      outputResult({ plugins }, mode);
      break;
    }
    case 'reload': {
      const name = subArgs[0];
      if (!name) outputError('Usage: xbrowser plugin reload <name>');
      await getPluginLoader().reloadPlugin(name);
      outputResult({ ok: true, name }, mode);
      break;
    }
    default:
      console.log(handlePluginHelp());
  }
}

function handleCreate(
  args: string[],
  options: Record<string, unknown>
): void {
  const name = args[0];
  if (!name) outputError('Usage: xbrowser create <name> --template <type>');
  const builtin = allBuiltins.find((b) => b.name === 'create');
  if (builtin) builtin.execute(args, options, { cwd: process.cwd() });
}

function handleDaemon(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): void {
  const sub = args[0];
  const daemon = new DaemonManager();
  switch (sub) {
    case 'start': {
      const port = options.port ? Number(options.port) : undefined;
      daemon
        .start(port)
        .then((config) =>
          outputResult({ ok: true, pid: config.pid, port: config.port }, mode)
        )
        .catch((e: unknown) =>
          outputError(e instanceof Error ? e.message : String(e))
        );
      break;
    }
    case 'stop': {
      daemon
        .stop()
        .then(() => outputResult({ ok: true }, mode))
        .catch((e: unknown) =>
          outputError(e instanceof Error ? e.message : String(e))
        );
      break;
    }
    case 'status': {
      const status = daemon.status();
      outputResult(
        status ? { running: true, ...status } : { running: false },
        mode
      );
      break;
    }
    default:
      console.log('Usage: xbrowser daemon <start|stop|status> [--port <port>]');
  }
}

async function handleRecord(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case 'start': {
      const url = options.url as string;
      if (!url) outputError('Usage: xbrowser record start --url <url>');
      const browserSessions = getAllSessions();
      const session = browserSessions[0];
      if (!session)
        outputError(
          'No active session. Run "xbrowser session open <url>" first.'
        );
      activeRecorder = new RecorderController(session.page);
      await activeRecorder.start({ url, name: options.name as string });
      outputResult({ ok: true, url }, mode);
      break;
    }
    case 'stop': {
      if (!activeRecorder) outputError('No recording in progress');
      const result = await activeRecorder!.stop(options.output as string);
      activeRecorder = null;
      outputResult(
        {
          ok: true,
          path: result.path,
          events: result.session.events.length,
          duration: result.session.duration,
        },
        mode
      );
      break;
    }
    case 'status': {
      if (!activeRecorder) {
        outputResult({ recording: false }, mode);
      } else {
        const status = activeRecorder.getStatus();
        outputResult(
          {
            recording: status?.isRecording,
            events: status?.eventCount,
            duration: status?.duration,
          },
          mode
        );
      }
      break;
    }
    default:
      console.log('Usage: xbrowser record <start|stop|status> [--url <url>]');
  }
}

async function handleReplay(
  args: string[],
  options: Record<string, unknown>,
  mode: string
): Promise<void> {
  const filePath = args[0];
  if (!filePath) outputError('Usage: xbrowser replay <file>');
  const browserSessions = getAllSessions();
  const session = browserSessions[0];
  if (!session)
    outputError(
      'No active session. Run "xbrowser session open <url>" first.'
    );
  const engine = PlaybackEngine.fromFile(session.page, filePath);
  const result = await engine.play({
    slowMo: options['slow-mo'] ? Number(options['slow-mo']) : 1,
  });
  outputResult(result, mode);
}

function handleConfig(
  args: string[],
  options: Record<string, unknown>
): void {
  const builtin = allBuiltins.find((b) => b.name === 'config');
  if (builtin) builtin.execute(args, options, { cwd: process.cwd() });
}

function handleConvert(args: string[], _mode: string): void {
  const filePath = args[0];
  const outputPath = args[1];

  if (!filePath || !outputPath) {
    console.error('Usage: xbrowser convert <recording.yaml> <output.{js,py,sh}>');
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const recording = yaml.parse(content);

  const ext = path.extname(outputPath).toLowerCase();
  let script: string;

  if (ext === '.py') {
    script = generatePythonScript(recording);
  } else if (ext === '.sh') {
    script = generateBashScript(recording);
  } else {
    script = generateJSScript(recording);
  }

  fs.writeFileSync(outputPath, script);
  fs.chmodSync(outputPath, 0o755);

  const eventCount = (recording.events || []).length;
  console.log(`Converted ${filePath} -> ${outputPath}`);
  console.log(`  Events: ${eventCount}, Start URL: ${recording.startUrl}`);
  console.log(`  Run: ${ext === '.py' ? 'python' : ext === '.sh' ? './' : 'node'} ${outputPath}`);
}

function handleExtract(args: string[], _mode: string): void {
  const filePath = args[0];

  if (!filePath) {
    console.error('Usage: xbrowser extract <recording.yaml>');
    process.exit(1);
  }

  const { summary, outputPath } = extractAndSave(filePath);
  printExtractSummary(summary);
  console.log(`\nSaved LLM summary: ${outputPath}`);
}

function handleFilter(args: string[], _mode: string): void {
  const filePath = args[0];
  const outputPath = args[1];

  if (!filePath || !outputPath) {
    console.error('Usage: xbrowser filter <input.yaml> <output.yaml> [--exclude-types=type1,type2]');
    process.exit(1);
  }

  const excludeTypes = parseExcludeTypes(args.slice(2));
  const result = filterRecording(filePath, outputPath, excludeTypes);

  console.log(`Filtered ${filePath} -> ${outputPath}`);
  console.log(`  Original: ${result.originalCount}, After: ${result.filteredCount}, Removed: ${result.removed} (${result.percentage}%)`);
}

async function handleBrowserCommand(
  command: string,
  args: string[],
  options: Record<string, unknown>,
  sessionName: string,
  mode: string
): Promise<void> {
  let cmdName: string;
  let params: Record<string, unknown>;

  switch (command) {
    case 'goto':
      if (!args[0]) outputError('Usage: xbrowser goto <url>');
      cmdName = 'goto';
      params = {
        url: args[0],
        waitUntil: options.waitUntil as string | undefined,
      };
      break;
    case 'click':
      if (!args[0]) outputError('Usage: xbrowser click <selector>');
      cmdName = 'click';
      params = { selector: args[0] };
      break;
    case 'fill':
      if (!args[0] || !args[1])
        outputError('Usage: xbrowser fill <selector> <value>');
      cmdName = 'fill';
      params = { selector: args[0], value: args[1] };
      break;
    case 'screenshot':
      cmdName = 'screenshot';
      params = {
        fullPage: !!(options['full-page'] || options.fullPage),
        type: options.type as string | undefined,
        selector: options.selector as string | undefined,
      };
      break;
    case 'eval':
      if (!args[0]) outputError('Usage: xbrowser eval <expression>');
      cmdName = 'eval';
      params = { expression: args.join(' ') };
      break;
    case 'wait':
      if (!args[0])
        outputError('Usage: xbrowser wait <selector> [--timeout <ms>]');
      cmdName = 'waitForSelector';
      params = {
        selector: args[0],
        state: options.state as string | undefined,
        timeout: options.timeout ? Number(options.timeout) : undefined,
      };
      break;
    case 'scroll': {
      const direction = args[0] || 'down';
      if (!['up', 'down', 'left', 'right'].includes(direction))
        outputError('Direction must be: up, down, left, right');
      cmdName = 'scroll';
      params = {
        direction,
        distance: options.distance ? Number(options.distance) : undefined,
        selector: options.selector as string | undefined,
      };
      break;
    }
    case 'title':
      cmdName = 'title';
      params = {};
      break;
    case 'url':
      cmdName = 'url';
      params = {};
      break;
    case 'html':
      cmdName = 'html';
      params = { selector: options.selector as string | undefined };
      break;
    case 'text':
      cmdName = 'text';
      params = { selector: options.selector as string | undefined };
      break;
    case 'back':
      cmdName = 'back';
      params = {};
      break;
    case 'forward':
      cmdName = 'forward';
      params = {};
      break;
    case 'refresh':
      cmdName = 'refresh';
      params = {};
      break;
    default:
      cmdName = command;
      params = { ...options };
      break;
  }

  const result = await executeCommand(cmdName, params, sessionName);
  if (mode === 'json' || mode === 'yaml') {
    outputResult(result, mode);
  } else if (!result.success) {
    outputError(result.message || 'Command failed');
  } else {
    outputResult(result.data, mode);
  }
}
