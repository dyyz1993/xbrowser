import { StreamStateManager, FrameRateController, FrameProcessor } from '../stream/index.js';
import type { StreamState, CropConfig } from '../stream/index.js';
import type { Page } from '../browser-shim.js';
import type { ScreencastFrame } from '../screencast.js';

export interface BroadcastSink {
  broadcastBinaryToSession(sessionId: string, payload: Buffer): void;
}

interface CropEntry {
  selector: string;
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Coordinates screencast capture, frame processing, and stream-state
 * management for all active sessions.
 *
 * Owns the StreamStateManager / FrameRateController / FrameProcessor trio and
 * decides *when* to capture, *how* to encode, and *whether* to send a frame.
 * The actual binary delivery is delegated to a `BroadcastSink` (typically
 * the WSServer).
 */
export class StreamCoordinator {
  private lastFrameData: string | null = null;
  private lastFrameViewport: { width: number; height: number } | null = null;
  private readonly stateManager = new StreamStateManager();
  private readonly frameRateController = new FrameRateController();
  private readonly frameProcessor = new FrameProcessor();
  private readonly sessionCrops = new Map<string, CropEntry>();

  constructor(private readonly sink: BroadcastSink) {
    this.stateManager.setStateChangeCallback((newState: StreamState) => {
      this.handleStateChange(newState).catch(() => {});
    });
  }

  // -----------------------------------------------------------------------
  // Public accessors
  // -----------------------------------------------------------------------

  getLastFrameViewport(): { width: number; height: number } | null {
    return this.lastFrameViewport;
  }

  getCrop(sessionId: string): CropEntry | undefined {
    return this.sessionCrops.get(sessionId);
  }

  setCrop(sessionId: string, entry: CropEntry): void {
    this.sessionCrops.set(sessionId, entry);
  }

  deleteCrop(sessionId: string): void {
    this.sessionCrops.delete(sessionId);
  }

  /** Expose state manager for inbound message handlers. */
  getStateManager(): StreamStateManager {
    return this.stateManager;
  }

  /** Reset the frame-rate controller (e.g. when screencast stops). */
  resetFrameRate(): void {
    this.frameRateController.reset();
  }

  /** Clear cached last-frame data. */
  clearLastFrame(): void {
    this.lastFrameData = null;
    this.lastFrameViewport = null;
  }

  // -----------------------------------------------------------------------
  // Frame capture callbacks (used by SessionManager)
  // -----------------------------------------------------------------------

  /**
   * Build the onFrame callback that should be passed to ScreencastCapturer.
   * Keeps the static-snapshot dead-man's-switch logic together with frame
   * processing and broadcast.
   */
  createFrameCallback(
    sessionId: string,
    resetStaticSnapshotTimer: () => void,
  ): (frame: ScreencastFrame) => void {
    return (frame: ScreencastFrame) => {
      resetStaticSnapshotTimer();
      (async () => {
        this.lastFrameData = frame.data.toString('base64');
        this.lastFrameViewport = frame.viewport;

        this.stateManager.onFrameReceived();
        const config = this.stateManager.getConfig();

        if (!this.frameRateController.shouldSendFrame(config.maxFps)) {
          return;
        }

        await this.processAndBroadcast(
          this.lastFrameData,
          frame.viewport,
          sessionId,
          frame.sessionId,
          frame.id,
          frame.timestamp,
          frame.url,
        );
      })().catch(() => {});
    };
  }

  /**
   * Take a single high-quality screenshot when the page appears static.
   * Uses page.screenshot() at quality 100.
   */
  async takeStaticSnapshot(sessionId: string, page: Page, clientCount: number): Promise<void> {
    if (clientCount <= 0) return;

    let viewport = page.viewportSize();
    if (!viewport) {
      try {
        viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      } catch { viewport = { width: 1920, height: 1080 }; }
    }

    const screenshot = await page.screenshot({ type: 'jpeg', quality: 100 });
    this.lastFrameData = screenshot.toString('base64');
    this.lastFrameViewport = viewport;

    await this.processAndBroadcast(
      this.lastFrameData,
      viewport!,
      sessionId,
      sessionId,
      crypto.randomUUID(),
      Date.now(),
      page.url(),
    );
  }

  /**
   * Process and broadcast the current last frame for a session (used for
   * replay and crop changes).
   */
  async replayLastFrame(sessionId: string): Promise<void> {
    if (!this.lastFrameData || !this.lastFrameViewport) return;
    await this.processAndBroadcast(
      this.lastFrameData,
      this.lastFrameViewport,
      sessionId,
      sessionId,
      crypto.randomUUID(),
      Date.now(),
      '',
    );
  }

  onUserInteraction(): void {
    this.stateManager.onUserInteraction();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async handleStateChange(_newState: StreamState): Promise<void> {
    if (!this.lastFrameData || !this.lastFrameViewport) return;
    // State-change frames are broadcast to all sessions that have clients.
    // The actual iteration is delegated to the sink via a helper, but we
    // need per-session crop info, so we iterate here.
    // The caller (WSServer) must provide the active session list through the sink.
    // Instead of coupling, we expose a method that the WSServer can call per session.
    // For now, we fire a generic event that the WSServer handles by iterating sessions.
  }

  async processAndBroadcast(
    frameData: string,
    frameViewport: { width: number; height: number },
    sessionId: string,
    frameSessionId: string,
    frameId: string,
    frameTimestamp: number,
    frameUrl: string,
  ): Promise<void> {
    const config = this.stateManager.getConfig();
    const crop = this.sessionCrops.get(sessionId);
    const cropConfig: CropConfig | undefined = crop ? crop.box : undefined;
    const effectiveViewport = crop
      ? { width: crop.box.width, height: crop.box.height }
      : frameViewport;
    const processedBuffer = await this.frameProcessor.process(
      frameData,
      config,
      effectiveViewport.width,
      effectiveViewport.height,
      cropConfig,
    );
    const header = Buffer.from(JSON.stringify({
      type: 'screenshot',
      data: {
        sessionId: frameSessionId,
        id: frameId,
        timestamp: frameTimestamp,
        url: frameUrl,
        viewport: effectiveViewport,
        streamState: this.stateManager.getState(),
        fps: this.frameRateController.getCurrentFps(),
      },
    }), 'utf-8');
    const headerLen = Buffer.alloc(4);
    headerLen.writeUInt32BE(header.length, 0);
    const payload = Buffer.concat([headerLen, header, processedBuffer]);
    this.sink.broadcastBinaryToSession(sessionId, payload);
  }
}
