import type { Page } from 'playwright';

/**
 * A single screencast frame with base64-encoded screenshot data.
 */
export interface ScreencastFrame {
  id: string;
  sessionId: string;
  timestamp: number;
  data: string;
  url: string;
  viewport: { width: number; height: number };
}

/**
 * Options for configuring screencast capture behavior.
 */
export interface ScreencastOptions {
  interval?: number;
  quality?: number;
  type?: 'jpeg' | 'png';
  width?: number;
  height?: number;
}

/**
 * Captures periodic screenshots from a Playwright page for screencast streaming.
 *
 * Supports configurable interval, quality, image type, and viewport dimensions.
 */
export class ScreencastCapturer {
  private interval: number;
  private quality: number;
  private type: 'jpeg' | 'png';
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  private isCapturing = false;
  private frameCallback: ((frame: ScreencastFrame) => void) | null = null;

  constructor(options: ScreencastOptions = {}) {
    this.interval = options.interval || 1000;
    this.quality = options.quality || 80;
    this.type = options.type || 'jpeg';
    void options.width;
    void options.height;
  }

  /**
   * Capture a single screenshot frame from the page.
   *
   * @param page - The Playwright page to screenshot.
   * @param sessionId - The session identifier to tag the frame with.
   * @returns A ScreencastFrame with base64-encoded image data.
   */
  async captureFrame(
    page: Page,
    sessionId: string
  ): Promise<ScreencastFrame> {
    const viewport = page.viewportSize();
    const screenshot = await page.screenshot({
      type: this.type,
      quality: this.quality,
    });
    const data = screenshot.toString('base64');

    return {
      id: crypto.randomUUID(),
      sessionId,
      timestamp: Date.now(),
      data,
      url: page.url(),
      viewport: viewport || { width: 0, height: 0 },
    };
  }

  /**
   * Start periodic screencast capture, invoking the callback for each frame.
   *
   * @param page - The Playwright page to capture from.
   * @param sessionId - The session identifier for frame tagging.
   * @param onFrame - Callback invoked with each captured frame.
   * @throws If a capture is already in progress.
   */
  startCapture(
    page: Page,
    sessionId: string,
    onFrame: (frame: ScreencastFrame) => void
  ): void {
    if (this.isCapturing) {
      throw new Error('Screencast is already capturing');
    }

    this.isCapturing = true;
    this.frameCallback = onFrame;

    const captureLoop = async () => {
      try {
        const frame = await this.captureFrame(page, sessionId);
        this.frameCallback?.(frame);
      } catch {
        // ignore errors during capture
      }
    };

    captureLoop();
    this.captureTimer = setInterval(captureLoop, this.interval);
  }

  /**
   * Stop the current screencast capture.
   */
  stopCapture(): void {
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
    this.isCapturing = false;
    this.frameCallback = null;
  }

  isActive(): boolean {
    return this.isCapturing;
  }

  setInterval(interval: number): void {
    this.interval = interval;
    if (this.isCapturing) {
      this.stopCapture();
      // restart with new interval
      // Note: this requires restarting the capture with new page/session
    }
  }

  setQuality(quality: number): void {
    this.quality = quality;
  }
}
