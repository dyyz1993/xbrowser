export { version } from './version.js';
export { BrowserWorker, routeWorkerCommand, getBrowser, findSession, getAllSessions } from './worker.js';
export type { WorkerContext } from './worker.js';
export { BrowserCommandContext, checkBrowserScope, assertPageScope } from './context.js';
export { BROWSER_SCOPE } from './scope.js';
export type { ScopeDefinition, ScopeLevel } from './scope.js';
export {
  getCommand,
  getAllCommands,
  getCommandNames,
  registerCommand,
} from './commands/index.js';
export type { RegisteredCommand, BrowserCommandDefinition } from './commands/index.js';
export { routeCommand as cliRoute } from './router.js';
export {
  daemonRequest,
  openSession,
  closeSession,
  closeAllSessions,
  listSessions,
  getSession,
  saveSession,
  requireSession,
} from './session/session-client.js';
export { allBuiltins, getBuiltin } from './builtins/index.js';
export type { BuiltinCommand, BuiltinContext } from './builtins/index.js';
export { XBrowserPluginLoader } from './plugin/loader.js';
export type { PluginLoaderOptions, PluginStatus } from './plugin/loader.js';
export { PluginInstaller } from './plugin/installer.js';
export type { InstalledPlugin, InstallOptions } from './plugin/installer.js';
export { RecorderController } from './recorder/recorder.js';
export type { RecordedEvent, RecordingSession, RecorderStatus } from './recorder/recorder.js';
export { PlaybackEngine } from './recorder/player.js';
export type { PlaybackOptions, PlaybackResult } from './recorder/player.js';
export { DaemonManager } from './daemon/daemon.js';
export type { DaemonConfig } from './daemon/daemon.js';
