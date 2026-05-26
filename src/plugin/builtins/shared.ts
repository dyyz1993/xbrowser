import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { readJsonFile } from '../../utils/json-file.js';
import { getRegistryUrl } from '../../config.js';

export interface AuthConfig {
  token: string;
  registry: string;
}

function getAuthDir(): string {
  return resolve(homedir(), '.xbrowser');
}

function getAuthFile(): string {
  return resolve(getAuthDir(), 'auth.json');
}

export function loadAuth(): AuthConfig | null {
  const authFile = getAuthFile();
  if (!existsSync(authFile)) return null;
  return readJsonFile<AuthConfig | null>(authFile, null);
}

export function saveAuth(config: AuthConfig): void {
  const dir = getAuthDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getAuthFile(), JSON.stringify(config, null, 2), 'utf-8');
}

export { getRegistryUrl };
