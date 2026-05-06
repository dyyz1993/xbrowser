import type { XBrowserPluginMetadata } from './types.js';

export interface InstalledPlugin {
  id: string;
  name: string;
  path: string;
  source: 'local' | 'npm' | 'git' | 'url' | 'builtin' | 'marketplace';
  installedAt: string;
  metadata?: XBrowserPluginMetadata;
  warnings?: string[];
}

export interface InstallOptions {
  name?: string;
  force?: boolean;
}
