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
