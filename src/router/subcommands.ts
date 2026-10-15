import { allBuiltins } from '../builtins/index.js';
import { showMainHelp } from '../cli/help.js';
import { outputError } from '../cli/output.js';
import {
  handleConvert,
  handleCreate,
  handleDaemon,
  handleExtract,
  handleFilter,
  handleNetCommand,
  handlePlugin,
  handleRecord,
  handleReplay,
  handleRun,
  handleSession,
  handleTest,
  handleViewer,
} from '../cli/index.js';
import { handleRemote, handleServe, startMcpServer } from './services.js';

export interface SubcommandRequest {
  command: string;
  cmdArgs: string[];
  options: Record<string, unknown>;
  mode: string;
  cdpEndpoint?: string;
  sessionName: string;
}

export async function dispatchSubcommand(request: SubcommandRequest): Promise<boolean> {
  const { command, cmdArgs, options, mode, cdpEndpoint, sessionName } = request;
  switch (command) {
    case 'session':
      await handleSession(cmdArgs, options, mode, cdpEndpoint);
      return true;
    case 'plugin':
      await handlePlugin(cmdArgs, options, mode);
      return true;
    case 'create':
      handleCreate(cmdArgs, options);
      return true;
    case 'kill':
      await handleSession(['kill-all'], options, mode);
      return true;
    case 'daemon':
      handleDaemon(cmdArgs, options, mode);
      return true;
    case 'record':
      await handleRecord(cmdArgs, options, mode);
      return true;
    case 'replay':
      await handleReplay(cmdArgs, options, mode);
      return true;
    case 'config': {
      const builtin = allBuiltins.find((item) => item.name === 'config');
      if (builtin) builtin.execute(cmdArgs, options, { cwd: process.cwd() });
      return true;
    }
    case 'convert':
      await handleConvert(cmdArgs, mode);
      return true;
    case 'extract':
      await handleExtract(cmdArgs, mode);
      return true;
    case 'filter':
      await handleFilter(cmdArgs, mode, options);
      return true;
    case 'run':
      if (!cmdArgs[0]) outputError('Usage: xbrowser run <file>');
      await handleRun(cmdArgs[0], { cdpEndpoint, sessionName });
      return true;
    case 'serve':
      await handleServe(cmdArgs, options, mode);
      return true;
    case 'mcp':
      await startMcpServer();
      return true;
    case 'remote':
      await handleRemote(cmdArgs, options, mode);
      return true;
    case 'preview':
      await executeBuiltin('preview', cmdArgs, options);
      return true;
    case 'knowledge':
    case 'know':
      await executeBuiltin('knowledge', cmdArgs, options);
      return true;
    case 'viewer':
      await handleViewer(cmdArgs, options, mode, cdpEndpoint);
      return true;
    case 'help':
      showMainHelp();
      return true;
    case 'test':
      await handleTest(cmdArgs, options, mode, cdpEndpoint);
      return true;
    case 'net':
      await handleNetCommand(cmdArgs, options, mode, sessionName);
      return true;
    default:
      return false;
  }
}

async function executeBuiltin(
  name: string,
  cmdArgs: string[],
  options: Record<string, unknown>
): Promise<void> {
  const builtin = allBuiltins.find((item) => item.name === name);
  if (builtin) await builtin.execute(cmdArgs, options, { cwd: process.cwd() });
}
