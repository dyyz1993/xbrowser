import { spawn, type ChildProcess } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { WSServer } from '../websocket-server.js';

export interface DaemonConfig {
  pid: number;
  port: number;
  wsPort?: number;
  startedAt: string;
}

export interface DaemonManagerOptions {
  configDir?: string;
  workerScript?: string;
}

export class DaemonManager {
  private configDir: string;
  private configPath: string;
  private workerScript: string;
  private process: ChildProcess | null = null;
  private wsServer: WSServer | null = null;

  constructor(options?: DaemonManagerOptions) {
    this.configDir = options?.configDir || resolve(homedir(), '.xbrowser');
    this.configPath = resolve(this.configDir, 'daemon.json');
    this.workerScript = options?.workerScript || resolve(process.cwd(), 'dist/bin/cli.js');
  }

  async start(port?: number, wsPort?: number): Promise<DaemonConfig> {
    const existing = this.getConfig();
    if (existing && this.isProcessRunning(existing.pid)) {
      throw new Error(`Daemon already running (PID: ${existing.pid}, Port: ${existing.port})`);
    }

    const daemonPort = port || 9222;
    const websocketPort = wsPort || 9223;

    this.process = spawn('node', [this.workerScript, 'daemon', 'worker', '--port', String(daemonPort), '--ws-port', String(websocketPort)], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });

    this.process.unref();

    const config: DaemonConfig = {
      pid: this.process.pid!,
      port: daemonPort,
      wsPort: websocketPort,
      startedAt: new Date().toISOString(),
    };

    this.saveConfig(config);
    return config;
  }

  async stop(): Promise<void> {
    const config = this.getConfig();
    if (!config) {
      throw new Error('Daemon is not running');
    }

    await this.stopWSServer();

    try {
      process.kill(config.pid, 'SIGTERM');
    } catch {
      // process may already be dead
    }

    this.clearConfig();
  }

  status(): DaemonConfig | null {
    const config = this.getConfig();
    if (!config) return null;

    if (!this.isProcessRunning(config.pid)) {
      this.clearConfig();
      return null;
    }

    return config;
  }

  getWSServer(): WSServer | null {
    return this.wsServer;
  }

  async startWSServer(wsPort?: number): Promise<WSServer> {
    if (this.wsServer && this.wsServer.getRunning()) {
      return this.wsServer;
    }

    const port = wsPort || 9223;
    this.wsServer = new WSServer({ port });
    await this.wsServer.start();
    return this.wsServer;
  }

  async stopWSServer(): Promise<void> {
    if (!this.wsServer) return;
    await this.wsServer.stop();
    this.wsServer = null;
  }

  private getConfig(): DaemonConfig | null {
    if (!existsSync(this.configPath)) return null;
    try {
      return JSON.parse(readFileSync(this.configPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  private saveConfig(config: DaemonConfig): void {
    const dir = resolve(this.configPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  private clearConfig(): void {
    if (existsSync(this.configPath)) {
      unlinkSync(this.configPath);
    }
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
