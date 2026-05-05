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
  handleRun,
} from './cli/index.js';
import { outputError } from './cli/output.js';
import { showMainHelp } from './cli/help.js';
import { printChainResult, printChainResultBrief } from './cli/chain-output.js';

function handleConfig(
  args: string[],
  options: Record<string, unknown>
): void {
  const builtin = allBuiltins.find((b) => b.name === 'config');
  if (builtin) builtin.execute(args, options, { cwd: process.cwd() });
}

function parseEvalFlags(argv: string[]): string[] {
  const commands: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-e' || argv[i] === '--eval') {
      const cmd = argv[i + 1];
      if (!cmd) {
        console.error('Error: -e/--eval requires a command argument');
        process.exit(1);
      }
      commands.push(cmd);
      i++;
    }
  }
  return commands;
}

async function handleStdinMode(stdinCommands: string[]): Promise<void> {
  const chain = stdinCommands.join(' && ');
  const chainResult = await executeChain(chain, { fileMode: true });
  printChainResult(chainResult);
  if (!chainResult.success) process.exit(1);
}

async function handleEvalMode(argv: string[]): Promise<void> {
  const evalCommands = parseEvalFlags(argv);
  if (evalCommands.length === 0) return;
  const chain = evalCommands.join(' && ');
  const chainResult = await executeChain(chain);
  printChainResultBrief(chainResult);
  if (!chainResult.success) process.exit(1);
}

async function handleChainInput(input: string): Promise<void> {
  const chainResult = await executeChain(input);
  printChainResult(chainResult);
  if (!chainResult.success) process.exit(1);
}

export async function routeCommand(
  argv: string[],
  stdinCommands?: string[]
): Promise<void> {
  if (stdinCommands && stdinCommands.length > 0) {
    await handleStdinMode(stdinCommands);
    return;
  }

  if (parseEvalFlags(argv).length > 0) {
    await handleEvalMode(argv);
    return;
  }

  if (argv.length === 1 && isChainInput(argv[0])) {
    await handleChainInput(argv[0]);
    return;
  }

  const parsed = parseArgs(argv);
  const { positional, options } = parsed;
  const mode = options.json ? 'json' : options.yaml ? 'yaml' : 'text';
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
      case 'run':
        if (!cmdArgs[0]) {
          outputError('Usage: xbrowser run <file>');
        }
        await handleRun(cmdArgs[0], { cdpEndpoint, sessionName });
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
