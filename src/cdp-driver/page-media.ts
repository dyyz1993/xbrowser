import type { CDPConnection } from './connection.js';
import type { XBScreenshotOptions, XBPdfOptions } from './types.js';

export interface MediaServiceOptions {
  conn: CDPConnection;
  sessionId: string;
  evaluate: <T>(script: string) => Promise<T>;
  viewportSize: { width: number; height: number } | null;
  onViewportSize(size: { width: number; height: number }): void;
}

export class MediaService {
  constructor(private readonly options: MediaServiceOptions) {}

  async screenshot(opts: XBScreenshotOptions = {}): Promise<Buffer> {
    const params: Record<string, unknown> = {
      format: opts.type ?? 'png',
    };

    if (opts.quality !== undefined && (opts.type === 'jpeg' || (!opts.type && opts.quality))) {
      params.quality = opts.quality;
    }

    if (opts.fullPage) {
      params.captureBeyondViewport = true;
    }

    if (opts.clip) {
      const clip = {
        x: Math.round(opts.clip.x),
        y: Math.round(opts.clip.y),
        width: Math.round(Math.max(1, opts.clip.width)),
        height: Math.round(Math.max(1, opts.clip.height)),
        scale: opts.clip.scale ?? 1,
      };
      params.clip = clip;
    }

    if (opts.omitBackground) {
      params.omitBackground = true;
    }

    const result = await this.options.conn.send<{ data: string }>(
      'Page.captureScreenshot',
      params,
      this.options.sessionId,
    );

    return Buffer.from(result.data, 'base64');
  }

  async pdf(opts: XBPdfOptions = {}): Promise<Buffer> {
    const params: Record<string, unknown> = {};
    if (opts.landscape !== undefined) params.landscape = opts.landscape;
    if (opts.printBackground !== undefined) params.printBackground = opts.printBackground;
    if (opts.scale !== undefined) params.scale = opts.scale;
    if (opts.format) params.paperFormat = opts.format;
    if (opts.preferCSSPageSize !== undefined) params.preferCSSPageSize = opts.preferCSSPageSize;
    if (opts.margin) {
      if (opts.margin.top) params.marginTop = parseFloat(opts.margin.top);
      if (opts.margin.bottom) params.marginBottom = parseFloat(opts.margin.bottom);
      if (opts.margin.left) params.marginLeft = parseFloat(opts.margin.left);
      if (opts.margin.right) params.marginRight = parseFloat(opts.margin.right);
    }
    const result = await this.options.conn.send<{ data: string }>('Page.printToPDF', params, this.options.sessionId);
    return Buffer.from(result.data, 'base64');
  }

  viewportSize(): { width: number; height: number } | null {
    // Tracked via Emulation.setDeviceMetricsOverride
    return this.options.viewportSize ?? null;
  }

  async setViewportSize(size: { width: number; height: number }): Promise<void> {
    await this.options.conn.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: size.width,
        height: size.height,
        deviceScaleFactor: 1,
        mobile: false,
      },
      this.options.sessionId,
    );
    this.options.onViewportSize(size);
  }

  /**
   * env-E2: 缩放变异——deviceScaleFactor 切换（CSS 像素坐标空间不变，
   * 物理像素翻倍）。保留当前 CSS 视口尺寸，只换 DSF。
   */
  async setDeviceScaleFactor(dsf: number): Promise<void> {
    const size = this.options.viewportSize ?? (await this.options.evaluate<{ width: number; height: number }>(
      '({ width: window.innerWidth, height: window.innerHeight })',
    ));
    await this.options.conn.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: size.width,
        height: size.height,
        deviceScaleFactor: dsf,
        mobile: false,
      },
      this.options.sessionId,
    );
    this.options.onViewportSize(size);
  }

  // ── Scripts ─────────────────────────────────────────────────
}
