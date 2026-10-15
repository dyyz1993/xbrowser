export type { BrowserLaunchOptions, ManagedSession, SessionDiskMeta } from './state.js';
export {
  createBrowser,
  findTargetPage,
  resolveLaunchOpts,
} from './connection.js';
export {
  saveSessionDiskMeta,
  readSessionDiskMeta,
  deleteSessionDiskMeta,
} from './state.js';
export { findOrRestoreSession } from './restore.js';
export {
  getAllSessions,
  getSessionById,
  setActivePage,
} from './lifecycle.js';
