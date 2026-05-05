import type { Page } from 'playwright';

export interface ScreencastFrame {
  id: string;
  sessionId: string;
  timestamp: number;
  data: string;
  url: string;
  viewport: { width: number; height: number };
}

export interface ScreencastOptions {
  interval?: number;
  quality?: number;
  type?: 'jpeg' | 'png';
  width?: number;
  height?: number;
}

export class ScreencastCapturer {
  private interval: number;
  private quality: number;
  private type: 'jpeg' | 'png';
  private width?: number;
  private height?: number;
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  private isCapturing = false;
  private frameCallback: ((frame: ScreencastFrame) => void) | null = null;

  constructor(options: ScreencastOptions = {}) {
    this.interval = options.interval || 1000;
    this.quality = options.quality || 80;
    this.type = options.type || 'jpeg';
    this.width = options.width;
    this.height = options.height;
  }

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
