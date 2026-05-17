export { version } from './version.js';
export { executeCommand, executeChain, isChainInput, setWSServer, type ExecutionResult, type ChainStepResult, type ChainExecutionResult } from './executor.js';
export {
  getBrowser,
  findSession,
  getAllSessions as getAllBrowserSessions,
  createSession,
  closeSessionByName,
  closeAllSessions as closeAllBrowserSessions,
  destroyBrowser,
  resetForTesting,
  type ManagedSession,
  type BrowserLaunchOptions,
} from './browser.js';
export { BrowserCommandContext, checkBrowserScope, assertPageScope, attachWaitForHuman, getWSServerFromCache, setWSServerCache } from './context.js';
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
export { readStdin, readCommandFile } from './stdin.js';
export {
  openSession,
  closeSession,
  closeAllSessions,
  listSessions,
  getSessionPage,
  findSession as findSessionInfo,
  getAllSessions as listAllBrowserSessions,
  destroyBrowser as destroySessionManager,
} from './session/session-client.js';
export type { ManagedSession as SessionInfo } from './session/session-client.js';
export { allBuiltins, getBuiltin } from './builtins/index.js';
export type { BuiltinCommand, BuiltinContext } from './builtins/index.js';
export { XBrowserPluginLoader } from './plugin/loader.js';
export type { PluginLoaderOptions, PluginStatus } from './plugin/loader.js';
export { PluginInstaller } from './plugin/installer.js';
export type { InstalledPlugin, InstallOptions } from './plugin/installer.js';
export { createTarball } from './plugin/publisher.js';
export type { PublishOptions, PublishResult, AuthConfig } from './plugin/publisher.js';
export { RecorderController } from './recorder/recorder.js';
export type { RecordedEvent, RecordingSession, RecorderStatus } from './recorder/recorder.js';
export { PlaybackEngine } from './recorder/player.js';
export type { PlaybackOptions, PlaybackResult } from './recorder/player.js';
export {
  startDaemonProcess,
  stopDaemonProcess,
  getDaemonProcessStatus,
} from './daemon/daemon.js';
export type { DaemonInfo } from './daemon/daemon.js';
export { WSServer } from './websocket-server.js';
export type { WSServerConfig, WSMessage, WSInboundMessage, ScreencastMessage, CommandMessage, StatusMessage } from './websocket-server.js';
export { CaptchaDetector } from './captcha-detector.js';
export type { CaptchaDetectionResult } from './captcha-detector.js';
export { ScreencastCapturer, type ScreencastFrame, type ScreencastOptions } from './screencast.js';
export { HumanInteractionManager } from './human-interaction.js';
export type { WaitForHumanOptions, WaitForHumanResult } from './human-interaction.js';
export { WebhookNotifier } from './webhook.js';
export type { WebhookPayload } from './webhook.js';
export { getCaptchaConfig } from './config.js';
export {
  parseCommandChain,
  splitCommand,
  parseCommandArgs,
  registerCommandDefinition,
  type ParsedPipeline,
} from './chain-parser.js';
export { normalizeSelector } from './utils/selector.js';
export { generateJSScript, generatePythonScript, generateBashScript } from './commands/convert.js';
export { extractRecording, extractAndSave, printExtractSummary } from './commands/extract.js';
export { filterRecording, parseExcludeTypes } from './commands/filter.js';
export type { Recording, RecordingEvent } from './commands/definitions.js';
export { HTTPServer } from './server/http-server.js';
export type { HTTPServerConfig, APIRequest, APIResponse, ExecRequest, ChainRequest, HTTPServerError } from './server/types.js';

// CDP Interceptor — Anti-crawler firewall at the CDP protocol level
export {
  CDPInterceptorProxy,
  createCDPInterceptor,
  createRuleEngine,
  domMutationRule,
  mouseTrajectoryRule,
  inputKeystrokeRule,
  automationSignalsRule,
  fingerprintingRule,
  eventSimulationRule,
  emulationOverrideRule,
  networkAnomalyRule,
  pageLifecycleRule,
  advise,
} from './cdp-interceptor/index.js';
export type {
  RuleEngine,
  AdvisoryResult,
  CDPRequest,
  CDPResponse,
  CDPError,
  CDPMessage,
  MessageDirection,
  CDPLogEntry,
  ViolationSeverity,
  DecisionAction,
  DecisionResult,
  RuleContext,
  CDPInterceptorRule,
  CDPInterceptorConfig,
  CDPInterceptorStats,
} from './cdp-interceptor/index.js';
