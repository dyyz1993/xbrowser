export { ElementMonitor, type FocusInfo } from './element-monitor.js';
export { StreamCoordinator, type BroadcastSink } from './stream-coordinator.js';
export { SessionManager, type WSClient, type WSLike, type SessionScreencast } from './session-manager.js';
export { MessageDispatcher, type MessageContext, type IMessageHandler } from './message-handler.js';
export {
  WorkspaceController,
  assertSafeNavigationUrl,
  checkWorkspaceTrust,
  type WorkspaceTabInfo,
  type WorkspaceStateMessage,
  type WorkspaceErrorMessage,
  type WorkspaceInboundMessage,
  type WorkspaceSessionHandle,
  type WorkspaceSessionResolver,
  type WorkspaceHandoffProbe,
  type WorkspacePeer,
  type WorkspaceContext,
} from './workspace-controller.js';
