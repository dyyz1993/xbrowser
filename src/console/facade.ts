import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  daemonPing,
  forwardCommandLog,
  forwardNetworkList,
  forwardSessionList,
} from '../client/daemon-client.js';
import { getDaemonProcessStatus } from '../daemon/daemon.js';
import { PluginInstaller } from '../plugin/installer.js';
import { getPluginLoader } from '../utils/plugin-singleton.js';
import type {
  ConsoleEnvironment,
  ConsoleOverview,
  ConsolePlugin,
  ConsoleSession,
} from './types.js';

const DAEMON_PREVIEW_URL = 'http://127.0.0.1:9224';
const CHROME_BRIDGE_STATUS_URL = 'http://127.0.0.1:9347/status';
const LOGIN_BRIDGE_STATUS_URL = 'http://127.0.0.1:9355/cookies';
const CHROME_BRIDGE_META_PATH = join(homedir(), '.xbrowser', 'chrome-bridge-ext.json');

async function fetchJson(url: string, timeoutMs = 1200): Promise<unknown | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function buildEnvironments(): Promise<ConsoleEnvironment[]> {
  const daemonStatus = getDaemonProcessStatus();
  const daemonPingResult = await daemonPing().catch(() => null);
  const environments: ConsoleEnvironment[] = [{
    id: 'daemon',
    kind: 'daemon',
    label: 'Local daemon',
    status: daemonStatus.running && daemonPingResult?.ok ? 'available' : 'unavailable',
    detail: daemonStatus.running
      ? `PID ${daemonStatus.pid}, port ${daemonStatus.port}`
      : 'daemon is not running',
    evidence: { ...daemonStatus, ping: daemonPingResult },
  }];

  const bridgeStatus = asRecord(await fetchJson(CHROME_BRIDGE_STATUS_URL));
  const bridgeRunning = bridgeStatus.running === true;
  const bridgeClients = Array.isArray(bridgeStatus.clients) ? bridgeStatus.clients.length : 0;
  let bridgeExtId: string | null = null;
  try {
    bridgeExtId = asRecord(JSON.parse(readFileSync(CHROME_BRIDGE_META_PATH, 'utf8'))).extId as string || null;
  } catch { /* metadata is optional */ }
  environments.push({
    id: 'chrome-bridge',
    kind: 'chrome_bridge',
    label: 'Daily Chrome (extension bridge)',
    status: bridgeRunning ? (bridgeClients > 0 ? 'available' : 'degraded') : 'unavailable',
    detail: bridgeRunning ? `${bridgeClients} extension connection(s)` : 'bridge server unavailable',
    evidence: { ...bridgeStatus, extId: bridgeExtId },
  });

  const loginStatus = await fetchJson(LOGIN_BRIDGE_STATUS_URL, 800);
  const loginCookies = Array.isArray(asRecord(loginStatus).cookies)
    ? (asRecord(loginStatus).cookies as unknown[]).length
    : 0;
  environments.push({
    id: 'login-bridge',
    kind: 'login_bridge',
    label: 'Login state archive',
    status: loginStatus === null ? 'unavailable' : (loginCookies > 0 ? 'available' : 'degraded'),
    detail: loginStatus === null ? 'bridge unavailable' : `${loginCookies} archived cookie(s)`,
    evidence: { cookieCount: loginCookies },
  });

  return environments;
}

function toConsoleSessions(raw: Array<{ id: string; name: string; url: string | null }>): ConsoleSession[] {
  return raw.map(session => ({
    id: session.id,
    name: session.name,
    url: session.url,
    environmentId: 'daemon',
    status: session.url ? 'running' : 'ready',
    previewUrl: `${DAEMON_PREVIEW_URL}/preview/${encodeURIComponent(session.name)}`,
  }));
}

async function buildPlugins(): Promise<ConsolePlugin[]> {
  const [installed, loaderResult] = await Promise.all([
    new PluginInstaller().list().catch(() => []),
    getPluginLoader().then(loader => loader.getCore().loader.getSites()).catch(() => []),
  ]);

  const loadedNames = new Set<string>();
  const loadedCommands = new Map<string, string[]>();
  for (const site of loaderResult) {
    const config = asRecord((site as { config?: unknown }).config);
    const name = String(config.name ?? '');
    if (!name) continue;
    loadedNames.add(name);
    const commands = (site as { getAllCommands?: () => Array<{ name?: string }> }).getAllCommands?.() ?? [];
    loadedCommands.set(name, commands.map(command => String(command.name ?? '')).filter(Boolean));
  }

  const plugins = installed.map(installedPlugin => {
    const metadata = installedPlugin.metadata;
    const shortName = String(metadata?.name ?? installedPlugin.name);
    return {
      id: installedPlugin.id,
      name: installedPlugin.name,
      displayName: String(metadata?.name ?? installedPlugin.name),
      source: installedPlugin.source,
      version: String(metadata?.version ?? 'unknown'),
      description: String(metadata?.description ?? ''),
      tags: metadata?.tags ?? [],
      commands: loadedCommands.get(shortName) ?? metadata?.commands ?? [],
      sites: metadata?.sites ?? [],
      status: loadedNames.has(shortName) ? 'loaded' as const : 'installed' as const,
    };
  });

  return plugins.sort((left, right) => left.displayName.localeCompare(right.displayName));
}

async function buildRecentEvidence(sessionName: string): Promise<Record<string, unknown>> {
  const [commandLog, network] = await Promise.all([
    forwardCommandLog(sessionName, 5).catch(() => null),
    forwardNetworkList(sessionName, { limit: 5 }).catch(() => null),
  ]);
  return { session: sessionName, commandLog, network };
}

export async function buildConsoleOverview(options?: {
  recentSession?: string;
  includeEvidence?: boolean;
}): Promise<ConsoleOverview> {
  const [environments, rawSessions, plugins] = await Promise.all([
    buildEnvironments(),
    forwardSessionList().catch(() => []),
    buildPlugins(),
  ]);
  const sessions = toConsoleSessions(rawSessions);
  const evidenceSession = options?.recentSession ?? sessions[0]?.name;
  const evidence = options?.includeEvidence !== false && evidenceSession
    ? await buildRecentEvidence(evidenceSession)
    : null;

  return {
    generatedAt: new Date().toISOString(),
    readonly: true,
    environments,
    sessions,
    plugins,
    stats: {
      runningSessions: sessions.filter(session => session.status === 'running').length,
      availableEnvironments: environments.filter(environment => environment.status === 'available').length,
      installedPlugins: plugins.length,
      loadedPlugins: plugins.filter(plugin => plugin.status === 'loaded').length,
    },
    ...(evidence ? { evidence } : {}),
  };
}
