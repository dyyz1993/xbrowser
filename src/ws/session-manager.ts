import { EventEmitter } from 'events';
import type { Page } from '../browser-shim.js';
import { ScreencastCapturer } from '../screencast.js';
import { ElementMonitor } from './element-monitor.js';
import type { StreamCoordinator } from './stream-coordinator.js';

// ---------------------------------------------------------------------------
// Types (re-exported from websocket-server.ts for internal use)
// ---------------------------------------------------------------------------

interface WSLike {
  send: (data: unknown, cb?: (err?: Error) => void) => void;
  close: (code?: number, reason?: string) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  readyState: number;
}

export interface WSClient {
  id: string;
  sessionId?: string;
  requestedSessionId?: string;
  ws: WSLike;
}

export { type WSLike };

/**
 * Per-session screencast state for lazy start/stop.
 */
export interface SessionScreencast {
  capturer: ScreencastCapturer;
  page: Page;
  clientCount: number;
  staticSnapshotTimer?: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

/**
 * Manages sessions, clients, and their binding relationships.
 *
 * Owns the `clients`, `sessionClients`, and `screencasts` maps that were
 * previously inside WSServer.  Emits events so WSServer can react to
 * lifecycle changes (start/stop screencast, send status messages, etc.).
 */
export class SessionManager extends EventEmitter {
  private readonly clients = new Map<string, WSClient>();
  private readonly sessionClients = new Map<string, Set<string>>();
  private readonly screencasts = new Map<string, SessionScreencast>();
  private readonly monitors = new Map<string, ElementMonitor>();

  // Injected from WSServer after construction
  private streamCoordinator!: StreamCoordinator;

  // -----------------------------------------------------------------------
  // Wiring
  // -----------------------------------------------------------------------

  setStreamCoordinator(coordinator: StreamCoordinator): void {
    this.streamCoordinator = coordinator;
  }

  // -----------------------------------------------------------------------
  // Client management
  // -----------------------------------------------------------------------

  addClient(client: WSClient): void {
    this.clients.set(client.id, client);
    this.emit('client-connected', client.id);
  }

  getClient(clientId: string): WSClient | undefined {
    return this.clients.get(clientId);
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  getAllClientIds(): IterableIterator<string> {
    return this.clients.keys();
  }

  getAllClients(): IterableIterator<WSClient> {
    return this.clients.values();
  }

  clearAllClients(): void {
    this.clients.clear();
    this.sessionClients.clear();
  }

  getClientCount(): number {
    return this.clients.size;
  }

  // -----------------------------------------------------------------------
  // Session registration
  // -----------------------------------------------------------------------

  registerSession(
    sessionId: string,
    page: Page,
    options?: { interval?: number; quality?: number; type?: 'jpeg' | 'png'; width?: number; height?: number },
  ): void {
    if (this.screencasts.has(sessionId)) return;

    this.screencasts.set(sessionId, {
      capturer: new ScreencastCapturer({
        interval: options?.interval ?? 100,
        quality: options?.quality ?? 40,
        type: options?.type ?? 'jpeg',
        width: options?.width ?? 1024,
        height: options?.height ?? 576,
      }),
      page,
      clientCount: 0,
    });

    const monitor = new ElementMonitor(
      page,
      (msg) => this.emit('broadcast', sessionId, msg),
      (msg) => this.emit('broadcast', sessionId, msg),
      () => this.getSessionClientCount(sessionId),
    );
    this.monitors.set(sessionId, monitor);
    monitor.start();

    // Auto-bind any waiting clients
    for (const [clientId, client] of this.clients) {
      if (client.requestedSessionId === sessionId && !client.sessionId) {
        this.emit('auto-bind', clientId, sessionId);
      }
    }
  }

  unregisterSession(sessionId: string): void {
    const sc = this.screencasts.get(sessionId);
    if (!sc) return;

    if (sc.capturer.isActive()) {
      sc.capturer.stopCapture().catch(() => {});
    }
    if (sc.staticSnapshotTimer) {
      clearTimeout(sc.staticSnapshotTimer);
    }

    const monitor = this.monitors.get(sessionId);
    if (monitor) {
      monitor.stop();
      this.monitors.delete(sessionId);
    }

    this.screencasts.delete(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.screencasts.has(sessionId);
  }

  getSessionIds(): string[] {
    return Array.from(this.screencasts.keys());
  }

  getSession(sessionId: string): SessionScreencast | undefined {
    return this.screencasts.get(sessionId);
  }

  getPageForSession(sessionId: string): Page | undefined {
    return this.screencasts.get(sessionId)?.page;
  }

  getPageForClient(clientId: string): Page | null {
    const client = this.clients.get(clientId);
    if (!client?.sessionId) return null;
    return this.screencasts.get(client.sessionId)?.page ?? null;
  }

  // -----------------------------------------------------------------------
  // Client-Session binding
  // -----------------------------------------------------------------------

  bindClientToSession(clientId: string, sessionId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Unbind from previous session
    if (client.sessionId) {
      this.unbindClientInternal(clientId, client.sessionId);
    }

    client.sessionId = sessionId;
    let set = this.sessionClients.get(sessionId);
    if (!set) {
      set = new Set();
      this.sessionClients.set(sessionId, set);
    }
    set.add(clientId);

    this.emit('client-bound', clientId, sessionId);
  }

  /**
   * Quick bind during connection (no unbind from previous). Returns `true`
   * if the session exists.
   */
  quickBind(clientId: string, sessionId: string): boolean {
    if (!this.screencasts.has(sessionId)) return false;

    const client = this.clients.get(clientId);
    if (!client) return false;

    client.sessionId = sessionId;
    let set = this.sessionClients.get(sessionId);
    if (!set) {
      set = new Set();
      this.sessionClients.set(sessionId, set);
    }
    set.add(clientId);
    return true;
  }

  unbindClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client?.sessionId) return;
    this.unbindClientInternal(clientId, client.sessionId);
  }

  private unbindClientInternal(clientId: string, sessionId: string): void {
    const set = this.sessionClients.get(sessionId);
    if (set) {
      set.delete(clientId);
      if (set.size === 0) {
        this.sessionClients.delete(sessionId);
      }
    }
    this.emit('client-unbound', clientId, sessionId);
  }

  getClientSessionId(clientId: string): string | undefined {
    return this.clients.get(clientId)?.sessionId;
  }

  getSessionClientCount(sessionId: string): number {
    const set = this.sessionClients.get(sessionId);
    return set ? set.size : 0;
  }

  getSessionClients(sessionId: string): Set<string> | undefined {
    return this.sessionClients.get(sessionId);
  }

  // -----------------------------------------------------------------------
  // Screencast lazy start/stop
  // -----------------------------------------------------------------------

  incrementClientCount(sessionId: string): number {
    const sc = this.screencasts.get(sessionId);
    if (!sc) return 0;
    sc.clientCount++;
    return sc.clientCount;
  }

  decrementClientCount(sessionId: string): number {
    const sc = this.screencasts.get(sessionId);
    if (!sc) return 0;
    sc.clientCount = Math.max(0, sc.clientCount - 1);
    return sc.clientCount;
  }

  getSessionClientCount2(sessionId: string): number {
    return this.screencasts.get(sessionId)?.clientCount ?? 0;
  }

  isCapturerActive(sessionId: string): boolean {
    return this.screencasts.get(sessionId)?.capturer.isActive() ?? false;
  }

  async startCapturer(sessionId: string): Promise<void> {
    const sc = this.screencasts.get(sessionId);
    if (!sc) return;
    const onFrame = this.streamCoordinator.createFrameCallback(sessionId, () => {
      this.resetStaticSnapshotTimer(sessionId);
    });
    await sc.capturer.startCapture(sc.page, sessionId, onFrame);

    // CDP screencast only sends frames on page repaint. If the page is static
    // (no animation, no hover), a newly connected viewer sees a blank screen.
    // Force-capture one frame immediately so the viewer has something to show.
    this.streamCoordinator.takeStaticSnapshot(sessionId, sc.page, sc.clientCount).catch(() => {});
  }

  async stopCapturer(sessionId: string): Promise<void> {
    const sc = this.screencasts.get(sessionId);
    if (!sc) return;
    await sc.capturer.stopCapture();
  }

  async pauseCapturer(sessionId: string): Promise<void> {
    const sc = this.screencasts.get(sessionId);
    if (sc?.capturer.isActive()) {
      await sc.capturer.stopCapture();
    }
  }

  async resumeCapturer(sessionId: string): Promise<void> {
    const sc = this.screencasts.get(sessionId);
    if (sc && !sc.capturer.isActive() && sc.clientCount > 0) {
      const onFrame = this.streamCoordinator.createFrameCallback(sessionId, () => {
        this.resetStaticSnapshotTimer(sessionId);
      });
      await sc.capturer.startCapture(sc.page, sessionId, onFrame);
    }
  }

  // -----------------------------------------------------------------------
  // Static snapshot timer
  // -----------------------------------------------------------------------

  private readonly STATIC_SNAPSHOT_DELAY_MS = 3000;

  resetStaticSnapshotTimer(sessionId: string): void {
    const sc = this.screencasts.get(sessionId);
    if (!sc) return;
    if (sc.staticSnapshotTimer) clearTimeout(sc.staticSnapshotTimer);
    sc.staticSnapshotTimer = setTimeout(() => {
      sc.staticSnapshotTimer = undefined;
      this.streamCoordinator.takeStaticSnapshot(sessionId, sc.page, sc.clientCount).catch(() => {});
    }, this.STATIC_SNAPSHOT_DELAY_MS);
  }

  // -----------------------------------------------------------------------
  // ElementMonitor delegation
  // -----------------------------------------------------------------------

  clearMonitorFocusKey(sessionId: string): void {
    this.monitors.get(sessionId)?.clearLastFocusKey();
  }

  async blurMonitorElement(sessionId: string): Promise<void> {
    const monitor = this.monitors.get(sessionId);
    if (monitor) await monitor.blurActiveElement();
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  async stopAllScreencasts(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [sessionId, sc] of this.screencasts) {
      if (sc.capturer.isActive()) {
        promises.push(sc.capturer.stopCapture().catch(() => {}));
        this.emit('screencast-stopped', sessionId);
      }
    }
    await Promise.all(promises);
  }

  closeAllClients(): void {
    for (const client of this.clients.values()) {
      try { client.ws.close(); } catch { /* ignore */ }
    }
    this.clients.clear();
    this.sessionClients.clear();
  }
}
