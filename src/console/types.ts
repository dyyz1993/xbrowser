export type EnvironmentKind = 'daemon' | 'chrome_bridge' | 'login_bridge';

export interface ConsoleEnvironment {
  id: string;
  kind: EnvironmentKind;
  label: string;
  status: 'available' | 'degraded' | 'unavailable';
  detail: string;
  evidence: Record<string, unknown>;
}

export interface ConsoleSession {
  id: string;
  name: string;
  url: string | null;
  environmentId: string;
  status: 'running' | 'ready' | 'unavailable';
  previewUrl: string | null;
}

export interface ConsolePlugin {
  id: string;
  name: string;
  displayName: string;
  source: string;
  version: string;
  description: string;
  tags: string[];
  commands: string[];
  sites: string[];
  status: 'installed' | 'loaded';
}

export interface ConsoleOverview {
  generatedAt: string;
  readonly: true;
  evidence?: Record<string, unknown> | null;
  environments: ConsoleEnvironment[];
  sessions: ConsoleSession[];
  plugins: ConsolePlugin[];
  stats: {
    runningSessions: number;
    availableEnvironments: number;
    installedPlugins: number;
    loadedPlugins: number;
  };
}
