import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function getHome(): string {
  return process.env.HOME || tmpdir();
}

function getConfigDir(): string {
  return join(getHome(), '.xbrowser');
}

function getConfigFile(): string {
  return join(getConfigDir(), 'config.json');
}

export function loadConfig(): Record<string, unknown> {
  const file = getConfigFile();
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf-8'));
}

export function saveConfig(config: Record<string, unknown>): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getConfigFile(), JSON.stringify(config, null, 2), 'utf-8');
}

export function getConfigValue(key: string): unknown {
  const config = loadConfig();
  return config[key];
}

export function setConfigValue(key: string, value: unknown): void {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
}
