import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readJsonFile } from './utils/json-file.js';

function getHome(): string {
  return process.env.HOME || tmpdir();
}

function getConfigDir(): string {
  return join(getHome(), '.xbrowser');
}

function getConfigFile(): string {
  return join(getConfigDir(), 'config.json');
}

/**
 * Load the user configuration from `~/.xbrowser/config.json`.
 *
 * @returns The parsed configuration object, or an empty object if the file does not exist.
 */
export function loadConfig(): Record<string, unknown> {
  const file = getConfigFile();
  if (!existsSync(file)) return {};
  return readJsonFile(file, {});
}

/**
 * Save the user configuration to `~/.xbrowser/config.json`.
 *
 * @param config - The configuration object to persist.
 */
export function saveConfig(config: Record<string, unknown>): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getConfigFile(), JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Get a single configuration value by key.
 *
 * @param key - The configuration key.
 * @returns The value, or `undefined` if not set.
 */
export function getConfigValue(key: string): unknown {
  const config = loadConfig();
  return config[key];
}

/**
 * Set a single configuration value and persist it.
 *
 * @param key - The configuration key.
 * @param value - The value to set.
 */
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

/**
 * Get the CAPTCHA handling configuration, merging environment variables and config file.
 *
 * @returns CAPTCHA configuration with notify URL, auto-open flag, timeout, and preview port.
 */
export function getCaptchaConfig(): CaptchaConfig {
  const config = loadConfig() as ConfigRoot;
  return {
    notifyUrl: process.env.XBROWSER_NOTIFY_URL || config.captcha?.notifyUrl,
    autoOpen: process.env.XBROWSER_AUTO_OPEN === 'true' || config.captcha?.autoOpen === true,
    timeout: parseInt(process.env.XBROWSER_CAPTCHA_TIMEOUT || '') || config.captcha?.timeout || 120,
    previewPort: parseInt(process.env.XBROWSER_PREVIEW_PORT || '') || config.preview?.port || 9223,
  };
}
