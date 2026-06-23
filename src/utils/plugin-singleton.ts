import { XBrowserPluginLoader } from '../plugin/loader.js';

let pluginLoader: XBrowserPluginLoader | null = null;
let pluginsScanned = false;

export async function getPluginLoader(): Promise<XBrowserPluginLoader> {
  if (!pluginLoader) {
    pluginLoader = new XBrowserPluginLoader();
  }
  if (!pluginsScanned) {
    await pluginLoader.scanAndLoad();
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
