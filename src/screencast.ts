import type { Page, CDPSession } from './browser-shim.js';

/**
 * A single screencast frame with binary image data.
 */
export interface ScreencastFrame {
  id: string;
  sessionId: string;
  timestamp: number;
  data: Buffer;
  url: string;
  viewport: { width: number; height: number };
}

/**
 * Options for configuring screencast capture behavior.
 */
export interface ScreencastOptions {
  /** Target frame interval in ms (used as hint; CDP Cast delivers frames as fast as the page updates). Default: 100 (~10fps target) */
  interval?: number;
  /** JPEG quality 0-100. Default: 80 */
  quality?: number;
  /** Image format. Default: 'jpeg' */
  type?: 'jpeg' | 'png';
  /** Max capture width. Default: 1920 */
  width?: number;
  /** Max capture height. Default: 1080 */
  height?: number;
}

/**
 * Captures screenshots from a Playwright page using CDP `Page.startScreencast`.
 *
 * CDP Cast delivers frames as the page repaints — no polling needed.
 * This gives 10-30+ fps depending on page activity, vs ~2 fps with the old
 * `page.screenshot()` polling approach.
 *
 * Falls back to `page.screenshot()` polling if CDP session creation fails
 * (e.g., non-Chromium browser or restricted CDP access).
 */
export class ScreencastCapturer {
  private interval: number;
  private quality: number;
  private type: 'jpeg' | 'png';
  private maxWidth: number;
  private maxHeight: number;
  private isCapturing = false;
  private frameCallback: ((frame: ScreencastFrame) => void) | null = null;

  // CDP Cast state
  private cdpSession: CDPSession | null = null;
  private sessionId = '';

  // Fallback polling state
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ScreencastOptions = {}) {
    this.interval = options.interval || 100;
    this.quality = options.quality || 60;
    this.type = options.type || 'jpeg';
    this.maxWidth = options.width || 1920;
    this.maxHeight = options.height || 1080;
  }

  /**
   * Start screencast capture using CDP Page.startScreencast.
   *
   * If CDP session creation fails (non-Chromium, restricted access),
   * automatically falls back to `page.screenshot()` polling.
   */
  async startCapture(
    page: Page,
    sessionId: string,
    onFrame: (frame: ScreencastFrame) => void,
  ): Promise<void> {
    if (this.isCapturing) {
      throw new Error('Screencast is already capturing');
    }

    this.isCapturing = true;
    this.frameCallback = onFrame;
    this.sessionId = sessionId;

    try {
      const cdp = await page.context().newCDPSession(page);
      this.cdpSession = cdp;

      cdp.on('Page.screencastFrame', async (params: {
        data: string;
        metadata: { deviceWidth?: number; deviceHeight?: number; pageX?: number; pageY?: number; timestamp?: number };
        sessionId: number;
      }) => {
        if (!this.frameCallback) return;

        try {
          // Acknowledge the frame so Chrome sends the next one
          await cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId });
        } catch {
          // Frame ack may fail if we stopped — ignore
        }

        const viewport = {
          width: params.metadata?.deviceWidth || this.maxWidth,
          height: params.metadata?.deviceHeight || this.maxHeight,
        };

        this.frameCallback({
          id: crypto.randomUUID(),
          sessionId: this.sessionId,
          timestamp: Date.now(),
          data: Buffer.from(params.data, 'base64'),
          url: page.url(),
          viewport,
        });
      });

      await cdp.send('Page.startScreencast', {
        format: this.type === 'png' ? 'png' : 'jpeg',
        quality: this.type === 'jpeg' ? this.quality : undefined,
        maxWidth: this.maxWidth,
        maxHeight: this.maxHeight,
      });
    } catch {
      this.cdpSession = null;
      this.startFallbackPolling(page, sessionId);
    }
  }

  /**
   * Fallback: periodic page.screenshot() polling when CDP Cast is unavailable.
   */
  private startFallbackPolling(page: Page, sessionId: string): void {
    const captureLoop = async () => {
      if (!this.frameCallback) return;
      try {
        const frame = await this.captureFrame(page, sessionId);
        this.frameCallback(frame);
      } catch {
        // ignore errors during capture
      }
    };

    captureLoop();
    this.fallbackTimer = setInterval(captureLoop, this.interval);
  }

  /**
   * Capture a single screenshot frame from the page (fallback mode).
   */
  private async captureFrame(page: Page, sessionId: string): Promise<ScreencastFrame> {
    let viewport = page.viewportSize();
    if (!viewport) {
      try {
        viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      } catch {
        viewport = { width: 1920, height: 1080 };
      }
    }
    const screenshot = await page.screenshot({
      type: this.type,
      quality: this.type === 'jpeg' ? this.quality : undefined,
    });

    return {
      id: crypto.randomUUID(),
      sessionId,
      timestamp: Date.now(),
      data: screenshot,
      url: page.url(),
      viewport: viewport || { width: 0, height: 0 },
    };
  }

  /**
   * Stop the current screencast capture.
   */
  async stopCapture(): Promise<void> {
    if (this.cdpSession) {
      try {
        this.cdpSession.off('Page.screencastFrame', () => {});
        await this.cdpSession.send('Page.stopScreencast');
      } catch {
        // ignore — session may already be detached
      }
      try {
        await this.cdpSession.detach();
      } catch {
        // ignore
      }
      this.cdpSession = null;
    }

    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }

    this.isCapturing = false;
    this.frameCallback = null;
  }

  isActive(): boolean {
    return this.isCapturing;
  }

  setInterval(interval: number): void {
    this.interval = interval;
    // Note: CDP Cast doesn't use interval — it delivers frames on page repaint.
    // This only affects fallback polling mode.
  }

  setQuality(quality: number): void {
    this.quality = quality;
    // Note: quality change takes effect on next startCapture call for CDP Cast.
  }
}
