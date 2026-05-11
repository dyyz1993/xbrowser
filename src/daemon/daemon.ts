import { spawn, type ChildProcess } from 'child_process';
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { WSServer } from '../websocket-server.js';
import { HTTPServer } from '../server/http-server.js';
import { readJsonFile } from '../utils/json-file.js';

/**
 * Configuration for a running daemon process.
 */
export interface DaemonConfig {
  pid: number;
  port: number;
  wsPort?: number;
  httpPort?: number;
  startedAt: string;
}

export interface DaemonManagerOptions {
  configDir?: string;
  workerScript?: string;
}

/**
 * Manages the xbrowser daemon process lifecycle.
 *
 * Handles starting, stopping, and querying the daemon, as well as
 * managing its WebSocket server for remote browser control.
 */
export class DaemonManager {
  private configDir: string;
  private configPath: string;
  private workerScript: string;
  private process: ChildProcess | null = null;
  private wsServer: WSServer | null = null;
  private httpServer: HTTPServer | null = null;

  constructor(options?: DaemonManagerOptions) {
    this.configDir = options?.configDir || resolve(homedir(), '.xbrowser');
    this.configPath = resolve(this.configDir, 'daemon.json');
    this.workerScript = options?.workerScript || resolve(process.cwd(), 'dist/bin/cli.js');
  }

  /**
   * Start the daemon process in a detached child process.
   *
   * @param port - The browser CDP port. Defaults to 9222.
   * @param wsPort - The WebSocket server port. Defaults to 9223.
   * @param httpPort - The HTTP server port. Optional.
   * @returns The daemon configuration with PID and ports.
   * @throws If a daemon is already running.
   */
  async start(port?: number, wsPort?: number, httpPort?: number): Promise<DaemonConfig> {
    const existing = this.getConfig();
    if (existing && this.isProcessRunning(existing.pid)) {
      throw new Error(`Daemon already running (PID: ${existing.pid}, Port: ${existing.port})`);
    }

    const daemonPort = port || 9222;
    const websocketPort = wsPort || 9223;

    const args = ['daemon', 'worker', '--port', String(daemonPort), '--ws-port', String(websocketPort)];
    if (httpPort) {
      args.push('--http-port', String(httpPort));
    }

    this.process = spawn('node', [this.workerScript, ...args], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });

    this.process.unref();

    const config: DaemonConfig = {
      pid: this.process.pid!,
      port: daemonPort,
      wsPort: websocketPort,
      httpPort,
      startedAt: new Date().toISOString(),
    };

    this.saveConfig(config);
    return config;
  }

  /**
   * Stop the daemon process and its WebSocket server.
   *
   * @throws If the daemon is not running.
   */
  async stop(): Promise<void> {
    const config = this.getConfig();
    if (!config) {
      throw new Error('Daemon is not running');
    }

    await this.stopWSServer();
    await this.stopHTTPServer();

    try {
      process.kill(config.pid, 'SIGTERM');
    } catch {
      // process may already be dead
    }

    this.clearConfig();
  }

  /**
   * Check the daemon status.
   *
   * @returns The daemon config if running, or `null` if not running.
   */
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

  /**
   * Start the HTTP server for remote API access.
   *
   * @param httpPort - The port to listen on. Defaults to 9224.
   * @returns The started HTTPServer instance.
   */
  async startHTTPServer(httpPort?: number): Promise<HTTPServer> {
    if (this.httpServer) {
      return this.httpServer;
    }

    const port = httpPort || 9224;
    this.httpServer = new HTTPServer({ port });
    await this.httpServer.start();
    return this.httpServer;
  }

  /**
   * Stop the HTTP server if running.
   */
  async stopHTTPServer(): Promise<void> {
    if (!this.httpServer) return;
    await this.httpServer.stop();
    this.httpServer = null;
  }

  private getConfig(): DaemonConfig | null {
    if (!existsSync(this.configPath)) return null;
    return readJsonFile<DaemonConfig | null>(this.configPath, null);
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
