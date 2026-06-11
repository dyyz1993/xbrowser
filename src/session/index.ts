export {
  openSession,
  closeSession,
  closeAllSessions,
  listSessions,
  findSession,
  getAllSessions,
  getSessionPage,
  destroyBrowser,
} from './session-client.js';
export type { ManagedSession } from './session-client.js';

export { BrowserSessionManager } from './browser-session-manager.js';
export type { BrowserSessionInfo } from './browser-session-manager.js';
