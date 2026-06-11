import type { BuiltinCommand } from './session.js';
import {
  sessionCloseBuiltin,
  sessionListBuiltin,
  sessionKillBuiltin,
} from './session.js';
import { configBuiltin } from './config.js';
import {
  pluginInstallBuiltin,
  pluginUninstallBuiltin,
  pluginListBuiltin,
  pluginReloadBuiltin,
} from './plugin.js';
import { pluginSearchBuiltin } from './plugin-search.js';
import { createBuiltin } from './create.js';
import { previewBuiltin } from './preview.js';

export { type BuiltinCommand, type BuiltinContext, handleSessionHelp } from './session.js';
export { handlePluginHelp } from './plugin.js';
export { handleSearchHelp } from './plugin-search.js';
export { createBuiltin, listTemplates } from './create.js';

/**
 * All built-in CLI commands (session, config, plugin, create, preview).
 */
export const allBuiltins: BuiltinCommand[] = [
  sessionCloseBuiltin,
  sessionListBuiltin,
  sessionKillBuiltin,
  configBuiltin,
  pluginSearchBuiltin,
  pluginInstallBuiltin,
  pluginUninstallBuiltin,
  pluginListBuiltin,
  pluginReloadBuiltin,
  createBuiltin,
  previewBuiltin,
];

/**
 * Find a built-in command by name or alias.
 *
 * @param name - The command name or alias to look up.
 * @returns The matching built-in command, or `undefined` if not found.
 */
export function getBuiltin(name: string): BuiltinCommand | undefined {
  return allBuiltins.find(
    (b) => b.name === name || b.aliases?.includes(name)
  );
}
