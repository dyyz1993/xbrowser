import { TipCollector, CompositeStorage } from '@dyyz1993/xcli-core';
import type { CommandContext, SiteInstance, SiteConfig } from '@dyyz1993/xcli-core';

const CONFIG_DIR = require('node:path').join(require('node:os').homedir(), '.xbrowser');

/**
 * A no-op SiteInstance stub for contexts where commands don't access site.
 *
 * Used by marketplace search/info handlers that only read `params` and
 * never touch `ctx.site`. Every method returns `this` (chainable) or a
 * safe default, satisfying the SiteInstance interface without real logic.
 */
export class NoopSiteInstance implements SiteInstance {
  name = 'stub';
  url = '';
  config: SiteConfig = { name: 'stub' };

  command(): SiteInstance { return this; }
  group(): SiteInstance { return this; }
  login(): SiteInstance { return this; }
  logout(): SiteInstance { return this; }
  async isLoggedIn(): Promise<boolean> { return true; }
  async requireLogin(): Promise<void> { /* noop */ }
  getStorage() { return new CompositeStorage('stub', CONFIG_DIR, 'xbrowser'); }
  getAllCommands() { return []; }
  getCommand(): ReturnType<SiteInstance['getCommand']> { return null; }
  getOriginalHandler(): ReturnType<SiteInstance['getOriginalHandler']> { return undefined; }
  async executeLogin(): Promise<void> { /* noop */ }
  async executeLogout(): Promise<void> { /* noop */ }
  async restoreLogin(): Promise<boolean> { return false; }
}

/**
 * Create a minimal CommandContext for calling plugin handlers that don't
 * access browser/page/site fields (e.g. marketplace search/info commands).
 *
 * Replaces the previous `{} as never` escape hatch.
 */
export function createStubContext(pluginName: string): CommandContext {
  return {
    args: [],
    options: {},
    cwd: process.cwd(),
    storage: new CompositeStorage(pluginName, CONFIG_DIR, 'xbrowser'),
    output: { mode: 'text', showTips: false, color: false, emoji: false },
    error: (msg: string) => { throw new Error(msg); },
    config: {},
    site: new NoopSiteInstance(),
    cliName: 'xbrowser',
    tips: new TipCollector(),
  };
}
