import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { readJsonFile } from './utils/json-file.js';

const CONFIG_FILE = join(homedir() || tmpdir(), '.xbrowser', 'config.json');

export function loadConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_FILE)) return {};
  return readJsonFile(CONFIG_FILE, {});
}

export function saveConfig(config: Record<string, unknown>): void {
  const dir = join(homedir() || tmpdir(), '.xbrowser');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getConfigValue(key: string): unknown {
  return loadConfig()[key];
}

export function setConfigValue(key: string, value: unknown): void {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
}

interface CaptchaConfig {
  notifyUrl: string | undefined;
  autoOpen: boolean;
  timeout: number;
  previewPort: number;
}

interface ConfigRoot {
  captcha?: {
    notifyUrl?: string;
    autoOpen?: boolean;
    timeout?: number;
  };
  preview?: {
    port?: number;
  };
}

export const DEFAULT_MARKETPLACE_URL = 'https://xbrowser-marketplace.dyyz1993.workers.dev';
export const NPM_REGISTRY_URL = 'https://registry.npmjs.org';

export function getCaptchaConfig(): CaptchaConfig {
  const config = loadConfig() as ConfigRoot;
  return {
    notifyUrl: process.env.XBROWSER_NOTIFY_URL || config.captcha?.notifyUrl,
    autoOpen: process.env.XBROWSER_AUTO_OPEN === 'true' || config.captcha?.autoOpen === true,
    timeout: parseInt(process.env.XBROWSER_CAPTCHA_TIMEOUT || '') || config.captcha?.timeout || 120,
    previewPort: parseInt(process.env.XBROWSER_PREVIEW_PORT || '') || config.preview?.port || 9223,
  };
}
