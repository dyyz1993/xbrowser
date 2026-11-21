import { StreamStateManager, FrameRateController, FrameProcessor, adjustConfigForSize } from '../stream/index.js';
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
 * Per-session last-frame cache. Multiple sessions can stream concurrently,
 * so the cached frame, its viewport, and the crop applied at replay time must
 * all be keyed by sessionId — a global "last frame" would let one session's
 * viewer receive another session's pixels via `replayLastFrame`.
 */
interface SessionFrameCacheEntry {
  /** Raw (pre-crop) source frame, base64 — written on every captured frame. */
  uncroppedData: string | null;
  uncroppedViewport: { width: number; height: number } | null;
  /** Last frame handed to processAndBroadcast for this session. */
  data: string | null;
  viewport: { width: number; height: number } | null;
  /** Monotonic update sequence — identifies the most recently touched entry
   * for the legacy no-sessionId `getLastFrameViewport()` fallback. */
  seq: number;
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
  private readonly stateManager = new StreamStateManager();
  private readonly frameRateController = new FrameRateController();
  private readonly frameProcessor = new FrameProcessor();
  private readonly sessionCrops = new Map<string, CropEntry>();
  private readonly sessionFrames = new Map<string, SessionFrameCacheEntry>();
  private frameCacheSeq = 0;

  constructor(private readonly sink: BroadcastSink) {
    this.stateManager.setStateChangeCallback((newState: StreamState) => {
      this.handleStateChange(newState).catch(() => {});
    });
  }

  // -----------------------------------------------------------------------
  // Public accessors
  // -----------------------------------------------------------------------

  /**
   * Cached viewport for a session's last frame. When `sessionId` is omitted
   * (legacy callers), falls back to the most recently updated session's
   * viewport so old call sites keep behaving like the former global cache.
   */
  getLastFrameViewport(sessionId?: string): { width: number; height: number } | null {
    const entry = sessionId !== undefined
      ? this.sessionFrames.get(sessionId)
      : this.latestFrameCache();
    if (!entry) return null;
    return entry.uncroppedViewport ?? entry.viewport ?? null;
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

  /**
   * Clear cached last-frame data. With `sessionId`, only that session's cache
   * is dropped (other concurrent sessions keep theirs). Without it (legacy
   * callers), every session's cache is cleared — same as the old global clear.
   */
  clearLastFrame(sessionId?: string): void {
    if (sessionId === undefined) {
      this.sessionFrames.clear();
      return;
    }
    this.sessionFrames.delete(sessionId);
  }

  /**
   * Full teardown of per-session stream state (last-frame cache + crop).
   * Must be called when a session unregisters so a later session reusing the
   * same id can never replay the previous occupant's stale frame.
   */
  releaseSession(sessionId: string): void {
    this.sessionFrames.delete(sessionId);
    this.sessionCrops.delete(sessionId);
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
        const data = frame.data.toString('base64');
        const cache = this.getOrCreateFrameCache(sessionId);
        cache.uncroppedData = data;
        cache.uncroppedViewport = frame.viewport;
        this.touchFrameCache(cache);

        this.stateManager.onFrameReceived();
        const config = this.stateManager.getConfig();

        if (!this.frameRateController.shouldSendFrame(config.maxFps)) {
          return;
        }

        await this.processAndBroadcast(
          data,
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

    const logicalViewport = page.viewportSize();
    let viewport = logicalViewport;
    if (!viewport) {
      try {
        viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      } catch { viewport = { width: 1920, height: 1080 }; }
    }

    const screenshot = await page.screenshot({ type: 'jpeg', quality: 100 });
    const data = screenshot.toString('base64');
    const cache = this.getOrCreateFrameCache(sessionId);
    cache.uncroppedData = data;
    cache.uncroppedViewport = viewport;
    this.touchFrameCache(cache);

    await this.processAndBroadcast(
      data,
      viewport!,
      sessionId,
      sessionId,
      crypto.randomUUID(),
      Date.now(),
      page.url(),
    );
  }

  /**
   * Process and broadcast the cached last frame for a session (used for
   * replay and crop changes). Strictly per-session: a session with no cached
   * frame of its own replays nothing — it must never fall back to another
   * session's frame.
   */
  async replayLastFrame(sessionId: string): Promise<void> {
    const entry = this.sessionFrames.get(sessionId);
    if (!entry) return;
    // Always replay the uncropped source. Keeping this cache separate from
    // processed frames makes that invariant explicit and prevents a future
    // capture optimization from accidentally replaying a crop as a crop.
    const data = entry.uncroppedData ?? entry.data;
    const viewport = entry.uncroppedViewport ?? entry.viewport;
    if (!data || !viewport) return;
    await this.processAndBroadcast(
      data,
      viewport,
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
    if (this.sessionFrames.size === 0) return;
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
    // Crop rectangles are relative to the full logical viewport. They do not
    // need to end at its bottom-right corner (a QR near the top-left is the
    // common case), but they must still fit inside the current viewport.
    const cropFitsViewport = crop
      ? crop.box.x >= 0
        && crop.box.y >= 0
        && crop.box.x + crop.box.width <= frameViewport.width + 1
        && crop.box.y + crop.box.height <= frameViewport.height + 1
      : true;
    const cropConfig: CropConfig | undefined = crop && cropFitsViewport ? crop.box : undefined;
    // A cropped stream frame may itself be delivered at the crop's logical
    // size (for example a CDP crop or a future capture optimization). It must
    // not be cropped a second time using viewport-relative coordinates.
    const frameIsAlreadyCrop = crop && !cropConfig
      && Math.abs(frameViewport.width - crop.box.width) <= 1
      && Math.abs(frameViewport.height - crop.box.height) <= 1;
    const processCrop: CropConfig | undefined = frameIsAlreadyCrop ? undefined : cropConfig;
    const effectiveViewport = cropConfig
      ? { width: cropConfig.width, height: cropConfig.height }
      : frameViewport;

    // Adjust compression based on actual frame size vs full viewport.
    // Small frames (popups, dialogs, cropped views) get gentler compression
    // so the user can read them clearly.
    const adjustedConfig = adjustConfigForSize(
      config,
      effectiveViewport.width,
      effectiveViewport.height,
      frameViewport.width,
      frameViewport.height,
    );
    const processedBuffer = await this.frameProcessor.process(
      frameData,
      adjustedConfig,
      // The full viewport maps crop coordinates to source-frame pixels.
      // FrameProcessor sizes the final crop from cropConfig, never from this
      // full-page viewport.
      frameViewport.width,
      frameViewport.height,
      processCrop,
    );
    const header = Buffer.from(JSON.stringify({
      type: 'screenshot',
      data: {
        sessionId: frameSessionId,
        id: frameId,
        timestamp: frameTimestamp,
        url: frameUrl,
        viewport: cropConfig ? effectiveViewport : frameViewport,
        streamState: this.stateManager.getState(),
        fps: this.frameRateController.getCurrentFps(),
      },
    }), 'utf-8');
    const headerLen = Buffer.alloc(4);
    headerLen.writeUInt32BE(header.length, 0);
    const payload = Buffer.concat([headerLen, header, processedBuffer]);
    const cache = this.getOrCreateFrameCache(sessionId);
    cache.data = frameData;
    cache.viewport = frameViewport;
    this.touchFrameCache(cache);
    this.sink.broadcastBinaryToSession(sessionId, payload);
  }

  // -----------------------------------------------------------------------
  // Per-session frame-cache helpers
  // -----------------------------------------------------------------------

  private getOrCreateFrameCache(sessionId: string): SessionFrameCacheEntry {
    let entry = this.sessionFrames.get(sessionId);
    if (!entry) {
      entry = { uncroppedData: null, uncroppedViewport: null, data: null, viewport: null, seq: 0 };
      this.sessionFrames.set(sessionId, entry);
    }
    return entry;
  }

  private touchFrameCache(entry: SessionFrameCacheEntry): void {
    entry.seq = ++this.frameCacheSeq;
  }

  /** Most recently updated entry — only used by the legacy no-arg fallback. */
  private latestFrameCache(): SessionFrameCacheEntry | undefined {
    let latest: SessionFrameCacheEntry | undefined;
    for (const entry of this.sessionFrames.values()) {
      if (!latest || entry.seq > latest.seq) latest = entry;
    }
    return latest;
  }
}
