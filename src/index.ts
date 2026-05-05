import { Core } from '@dyyz1993/xcli-core';
import { loadBrowserPlugin } from './commands/browser.js';

export function createApp() {
  const app = new Core({
    name: 'xbrowser',
    version: '0.1.0',
    description: 'A browser automation CLI built with @dyyz1993/xcli-core',
    configDirName: '.xbrowser',
    envPrefix: 'XBROWSER',
    pluginDirs: [],
  });

  loadBrowserPlugin(app);

  return app;
}

export { version } from './version.js';
