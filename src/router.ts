import { parseArgs } from '@dyyz1993/xcli-core';
import { version } from './version.js';
import { executeChain, isChainInput } from './executor.js';
import { allBuiltins } from './builtins/index.js';
import {
  handleBrowserCommand,
  handleSession,
  handlePlugin,
  handleCreate,
  handleDaemon,
  handleRecord,
  handleReplay,
  handleConvert,
  handleExtract,
  handleFilter,
} from './cli/index.js';
import { outputError } from './cli/output.js';

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
  click <selector>                  Click element (-s <sel>)
  fill <selector> <value>           Fill input (-s <sel> -v <val>)
  type <selector> <text>            Type text (-s <sel> -v <text>)
  press <selector> <key>            Press key (-s <sel> -v <key>)
  select <selector> <value>         Select option (-s <sel> -v <val>)
  hover <selector>                  Hover element (-s <sel>)
  dblclick <selector>               Double click (-s <sel>)
  check <selector>                  Check checkbox (-s <sel>)
  uncheck <selector>                Uncheck checkbox (-s <sel>)
  screenshot [--full-page]          Take screenshot
  eval <expression>                 Evaluate JS
  wait <selector> [--timeout <ms>]  Wait for element (-s <sel>)
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

Selector Syntax:
  xbrowser click '#btn'              Quoted (handles # in shell)
  xbrowser click -s #btn             Flag form (-s = --selector)
  xbrowser click btn                 Auto-prefix # (treated as #btn)
  xbrowser click .class              Class selector
  xbrowser click [data-id=x]         Attribute selector
  xbrowser fill -s #input -v hello   Fill with flags (-v = --value)

Global Flags:
  --json                            Output as JSON
  --yaml                            Output as YAML
  --session <name>                  Use specific session
  --cdp <endpoint>                  Connect via CDP (url, port, or 'auto')
  --help, -h                        Show help
`);
}

function handleConfig(
  args: string[],
  options: Record<string, unknown>
): void {
  const builtin = allBuiltins.find((b) => b.name === 'config');
  if (builtin) builtin.execute(args, options, { cwd: process.cwd() });
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
