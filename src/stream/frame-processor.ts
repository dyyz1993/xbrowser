import sharp from 'sharp';

export type StreamState = 'user_interacting' | 'screen_moving' | 'static';

export interface StreamStateConfig {
  format: 'jpeg' | 'webp';
  quality: number;
  maxFps: number;
  scale: number;
}

export const STATE_CONFIGS: Record<StreamState, StreamStateConfig> = {
  // Full-screen: aggressive compression for speed
  // user_interacting: low quality + downscale — prioritize FPS over clarity
  user_interacting: { format: 'jpeg', quality: 40, maxFps: 30, scale: 0.6 },
  // screen_moving: page is animating but user is NOT operating.
  // Keep quality close to interacting to avoid visible flicker on state change.
  screen_moving: { format: 'jpeg', quality: 45, maxFps: 2, scale: 0.7 },
  // static: highest quality — user is reading, bandwidth is not a concern
  static: { format: 'jpeg', quality: 95, maxFps: 1, scale: 1 },
};

/**
 * Adjust compression config based on the actual frame dimensions.
 * Small frames (e.g. cropped popup, dialog) don't need aggressive compression
 * because their KB size is already small — compressing harder only hurts clarity.
 *
 * Threshold: if cropped area < 30% of full viewport, treat as "small frame"
 * and boost quality/scale so the user can read the content clearly.
 */
export function adjustConfigForSize(
  config: StreamStateConfig,
  frameWidth: number,
  frameHeight: number,
  fullViewportWidth: number,
  fullViewportHeight: number,
): StreamStateConfig {
  const framePixels = frameWidth * frameHeight;
  const fullPixels = fullViewportWidth * fullViewportHeight;
  const ratio = fullPixels > 0 ? framePixels / fullPixels : 1;

  // Small frame (popup/dialog/crop): use gentler compression
  if (ratio < 0.3) {
    return {
      ...config,
      quality: Math.min(config.quality + 40, 90),  // boost quality
      scale: Math.max(config.scale, 0.9),           // don't downscale
    };
  }

  // Medium frame (half screen): moderate boost
  if (ratio < 0.6) {
    return {
      ...config,
      quality: Math.min(config.quality + 20, 80),
      scale: Math.max(config.scale, 0.7),
    };
  }

  // Full screen: use config as-is (aggressive compression when moving)
  return config;
}

export type StateChangeCallback = (newState: StreamState, previousState: StreamState) => void;

export class StreamStateManager {
  private currentState: StreamState = 'static';
  private isUserInteracting: boolean = false;
  private userInteractionTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFrameTime: number = 0;
  private frameInterval: number = Infinity;
  private onStateChange: StateChangeCallback | null = null;
  private staticTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly USER_INTERACTION_TIMEOUT_MS = 2000;   // 1s → 2s: linger in interacting longer
  private readonly SCREEN_MOVING_THRESHOLD_MS = 1000;
  private readonly STATIC_TIMEOUT_MS = 3000;              // 1.5s → 3s: don't rush to static

  setStateChangeCallback(callback: StateChangeCallback | null): void {
    this.onStateChange = callback;
  }

  private setState(newState: StreamState): void {
    if (newState !== this.currentState) {
      const previousState = this.currentState;
      this.currentState = newState;
      this.onStateChange?.(newState, previousState);
    }
  }

  private resetStaticTimer(): void {
    if (this.staticTimer) {
      clearTimeout(this.staticTimer);
    }
    this.staticTimer = setTimeout(() => {
      if (!this.isUserInteracting) {
        this.setState('static');
      }
    }, this.STATIC_TIMEOUT_MS);
  }

  onUserInteraction(): void {
    this.setState('user_interacting');
    this.isUserInteracting = true;
    this.resetUserInteractionTimeout();
    this.resetStaticTimer();
  }

  private resetUserInteractionTimeout(): void {
    if (this.userInteractionTimer) {
      clearTimeout(this.userInteractionTimer);
    }
    this.userInteractionTimer = setTimeout(() => {
      this.isUserInteracting = false;
      const newState =
        this.frameInterval < this.SCREEN_MOVING_THRESHOLD_MS ? 'screen_moving' : 'static';
      this.setState(newState);
    }, this.USER_INTERACTION_TIMEOUT_MS);
  }

  onFrameReceived(): void {
    const now = Date.now();
    this.frameInterval = now - this.lastFrameTime;
    this.lastFrameTime = now;

    if (!this.isUserInteracting) {
      const newState =
        this.frameInterval < this.SCREEN_MOVING_THRESHOLD_MS ? 'screen_moving' : 'static';
      this.setState(newState);
    }

    this.resetStaticTimer();
  }

  getConfig(): StreamStateConfig {
    return STATE_CONFIGS[this.currentState];
  }

  getState(): StreamState {
    return this.currentState;
  }

  getFrameInterval(): number {
    return this.frameInterval;
  }

  getIsUserInteracting(): boolean {
    return this.isUserInteracting;
  }
}

export class FrameRateController {
  private lastSentTime: number = 0;
  private fpsFrameCount: number = 0;
  private fpsLastTime: number = Date.now();
  private currentFps: number = 0;

  private readonly FPS_CALCULATION_INTERVAL_MS = 1000;

  shouldSendFrame(maxFps: number): boolean {
    const now = Date.now();
    const minInterval = 1000 / maxFps;

    if (now - this.lastSentTime >= minInterval) {
      this.lastSentTime = now;
      this.fpsFrameCount++;
      this.calculateFps();
      return true;
    }
    return false;
  }

  private calculateFps(): void {
    const now = Date.now();
    const elapsed = now - this.fpsLastTime;

    if (elapsed >= this.FPS_CALCULATION_INTERVAL_MS) {
      this.currentFps = Math.round((this.fpsFrameCount * 1000) / elapsed);
      this.fpsFrameCount = 0;
      this.fpsLastTime = now;
    }
  }

  getCurrentFps(): number {
    return this.currentFps;
  }

  reset(): void {
    this.lastSentTime = 0;
    this.fpsFrameCount = 0;
    this.fpsLastTime = Date.now();
    this.currentFps = 0;
  }
}

export interface CropConfig {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class FrameProcessor {
  private readonly screencastFormat: 'jpeg' | 'png' = 'jpeg';
  private readonly screencastQuality: number = 80;

  async process(
    data: string,
    config: StreamStateConfig,
    viewportWidth?: number,
    viewportHeight?: number,
    cropConfig?: CropConfig,
  ): Promise<Buffer> {
    const buffer = Buffer.from(data, 'base64');

    const needsResize = config.scale < 1 && !!viewportWidth && !!viewportHeight;
    const needsCrop = !!cropConfig;
    const needsReencode =
      config.format !== this.screencastFormat || config.quality !== this.screencastQuality;

    if (!needsResize && !needsCrop && !needsReencode) {
      return buffer;
    }

    let processed: sharp.Sharp = sharp(buffer);

    if (cropConfig) {
      // The crop coordinates are in remote viewport space (e.g. 1280x800),
      // but the frame data may be scaled by CDP screencast (e.g. 1024x576).
      // We need to scale crop coordinates to match the actual frame pixels.
      const meta = await processed.metadata();
      const actualW = meta.width ?? viewportWidth ?? 1;
      const actualH = meta.height ?? viewportHeight ?? 1;
      // viewportWidth/Height here is the remote viewport (pre-screencast-scale)
      const refW = viewportWidth ?? actualW;
      const refH = viewportHeight ?? actualH;
      const scaleX = actualW / refW;
      const scaleY = actualH / refH;

      const cropLeft = Math.round(cropConfig.x * scaleX);
      const cropTop = Math.round(cropConfig.y * scaleY);
      const cropW = Math.min(Math.round(cropConfig.width * scaleX), actualW - cropLeft);
      const cropH = Math.min(Math.round(cropConfig.height * scaleY), actualH - cropTop);

      if (cropW > 0 && cropH > 0 && cropLeft >= 0 && cropTop >= 0) {
        processed = processed.extract({
          left: cropLeft,
          top: cropTop,
          width: cropW,
          height: cropH,
        });
      }
    }

    if (needsResize) {
      const newWidth = Math.round((viewportWidth ?? 0) * config.scale);
      const newHeight = Math.round((viewportHeight ?? 0) * config.scale);
      processed = processed.resize(newWidth, newHeight);
    }

    if (config.format === 'jpeg') {
      processed = processed.jpeg({ quality: config.quality });
    } else {
      processed = processed.webp({ quality: config.quality });
    }

    return processed.toBuffer();
  }
}

export async function cropFrameForElement(
  frameData: Buffer,
  box: { x: number; y: number; width: number; height: number },
  meta?: {
    deviceWidth?: number;
    deviceHeight?: number;
  },
): Promise<Buffer> {
  let left = Math.round(box.x);
  let top = Math.round(box.y);
  let w = Math.round(box.width);
  let h = Math.round(box.height);

  if (meta?.deviceWidth && meta?.deviceHeight) {
    const imgInfo = await sharp(frameData).metadata();
    const actualW = imgInfo.width ?? meta.deviceWidth;
    const actualH = imgInfo.height ?? meta.deviceHeight;
    const scaleX = actualW / meta.deviceWidth;
    const scaleY = actualH / meta.deviceHeight;

    if (scaleX !== 1 || scaleY !== 1) {
      left = Math.round(box.x * scaleX);
      top = Math.round(box.y * scaleY);
      w = Math.round(box.width * scaleX);
      h = Math.round(box.height * scaleY);
    }

    left = Math.max(0, Math.min(left, actualW - 1));
    top = Math.max(0, Math.min(top, actualH - 1));
    w = Math.min(w, actualW - left);
    h = Math.min(h, actualH - top);
  }

  if (w <= 0 || h <= 0) {
    return frameData;
  }

  return sharp(frameData)
    .extract({ left, top, width: w, height: h })
    .resize(box.width, box.height)
    .jpeg({ quality: 80 })
    .toBuffer();
}
