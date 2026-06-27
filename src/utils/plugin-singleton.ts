import { XBrowserPluginLoader } from '../plugin/loader.js';

let pluginLoader: XBrowserPluginLoader | null = null;
let pluginsScanned = false;

/**
 * Temporarily silence the noisy `has no "result" schema` warning that xcli-core
 * emits during `site.command()` registration. xcli-core calls `console.warn`
 * directly (not the `pluginWarn` sink), so the existing `silentPluginWarnings`
 * flag can't suppress it. With ~50 plugins missing a result schema, this would
 * flood every command's output.
 *
 * Only the specific schema warning is filtered — all other console.warn calls
 * (including real load failures from `pluginWarn`) pass through unchanged.
 * The original console.warn is always restored in `finally`, even on error.
 *
 * Set `XBROWSER_DEBUG=1` to see these warnings during plugin development.
 * Skipped under vitest (VITEST_WORKER_ID) so it never interferes with tests.
 */
function silenceSchemaWarnings<T>(fn: () => Promise<T>): Promise<T> {
  if (process.env.XBROWSER_DEBUG || process.env.VITEST_WORKER_ID) return fn();
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (msg.includes('has no "result" schema')) return; // swallow schema noise
    originalWarn(...args);
  };
  return fn().finally(() => { console.warn = originalWarn; });
}

export async function getPluginLoader(): Promise<XBrowserPluginLoader> {
  if (!pluginLoader) {
    pluginLoader = new XBrowserPluginLoader();
  }
  if (!pluginsScanned) {
    await silenceSchemaWarnings(() => pluginLoader!.scanAndLoad());
    pluginsScanned = true;
  }
  return pluginLoader;
}

/**
 * Reset the cached plugin loader so the next getPluginLoader() call
 * re-scans the plugin directories. Used after install/uninstall to
 * ensure the daemon picks up newly added or removed plugins.
 */
export function resetPluginLoader(): void {
  pluginLoader = null;
  pluginsScanned = false;
}
