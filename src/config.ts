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

export function getCaptchaConfig(): CaptchaConfig {
  const config = loadConfig() as ConfigRoot;
  return {
    notifyUrl: process.env.XBROWSER_NOTIFY_URL || config.captcha?.notifyUrl,
    autoOpen: process.env.XBROWSER_AUTO_OPEN === 'true' || config.captcha?.autoOpen === true,
    timeout: parseInt(process.env.XBROWSER_CAPTCHA_TIMEOUT || '') || config.captcha?.timeout || 120,
    previewPort: parseInt(process.env.XBROWSER_PREVIEW_PORT || '') || config.preview?.port || 9223,
  };
}
