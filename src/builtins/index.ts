import type { BuiltinCommand } from './session.js';
import {
  sessionOpenBuiltin,
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
import { createBuiltin } from './create.js';

export { type BuiltinCommand, type BuiltinContext, handleSessionHelp } from './session.js';
export { handlePluginHelp } from './plugin.js';
export { createBuiltin, listTemplates } from './create.js';

export const allBuiltins: BuiltinCommand[] = [
  sessionOpenBuiltin,
  sessionCloseBuiltin,
  sessionListBuiltin,
  sessionKillBuiltin,
  configBuiltin,
  pluginInstallBuiltin,
  pluginUninstallBuiltin,
  pluginListBuiltin,
  pluginReloadBuiltin,
  createBuiltin,
];

export function getBuiltin(name: string): BuiltinCommand | undefined {
  return allBuiltins.find(
    (b) => b.name === name || b.aliases?.includes(name)
  );
}
