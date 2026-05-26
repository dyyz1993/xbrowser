import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { readJsonFile } from './utils/json-file.js';

function getConfigFile(): string {
  return join(homedir() || tmpdir(), '.xbrowser', 'config.json');
}

export function loadConfig(): Record<string, unknown> {
  const configFile = getConfigFile();
  if (!existsSync(configFile)) return {};
  return readJsonFile(configFile, {});
}

export function saveConfig(config: Record<string, unknown>): void {
  const dir = join(homedir() || tmpdir(), '.xbrowser');
  const configFile = getConfigFile();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
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

export const DEFAULT_MARKETPLACE_URL = 'https://marketplace.xbrowser.dev';
export const DEFAULT_REGISTRY_URL = 'https://xbrowser.dev';
export const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
export const NPM_SCOPE = '@xbrowser/';

export function getMarketplaceUrl(): string {
  return (
    process.env.XBROWSER_MARKETPLACE_URL ||
    (getConfigValue('marketplaceUrl') as string) ||
    DEFAULT_MARKETPLACE_URL
  );
}

export function getRegistryUrl(
  options: Record<string, unknown> = {},
  fallbackRegistry?: string,
): string {
  return (
    (options['registry'] as string) ||
    process.env.XBROWSER_REGISTRY ||
    fallbackRegistry ||
    DEFAULT_REGISTRY_URL
  );
}

export function resolveNpmPackageName(name: string): string {
  if (name.startsWith('@')) return name;
  return `${NPM_SCOPE}${name}`;
}

/**
 * Name aliases for plugins whose directory names are not valid npm package names.
 * Key = local dir name, Value = npm package suffix (after @xbrowser/).
 */
const NPM_NAME_ALIASES: Record<string, string> = {
  '1688': 'alibaba-1688',
};

export function generateNpmCandidates(name: string): string[] {
  if (name.startsWith('@')) return [name];
  const resolved = NPM_NAME_ALIASES[name] ?? name;
  return [
    `${NPM_SCOPE}xbrowser-plugin-${resolved}`,
    `${NPM_SCOPE}${resolved}`,
    `xbrowser-plugin-${resolved}`,
  ];
}

export async function resolveNpmPackageWithFallback(name: string): Promise<string> {
  const candidates = generateNpmCandidates(name);
  for (const candidate of candidates) {
    try {
      const encoded = encodeURIComponent(candidate);
      const res = await fetch(`${NPM_REGISTRY_URL}/${encoded}`);
      if (res.ok) return candidate;
    } catch {
      continue;
    }
  }
  return resolveNpmPackageName(name);
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
