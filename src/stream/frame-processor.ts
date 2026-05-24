import sharp from 'sharp';

export type StreamState = 'user_interacting' | 'screen_moving' | 'static';

export interface StreamStateConfig {
  format: 'jpeg' | 'webp';
  quality: number;
  maxFps: number;
  scale: number;
}

export const STATE_CONFIGS: Record<StreamState, StreamStateConfig> = {
  user_interacting: { format: 'jpeg', quality: 80, maxFps: 60, scale: 0.6 },
  screen_moving: { format: 'jpeg', quality: 75, maxFps: 8, scale: 0.8 },
  static: { format: 'jpeg', quality: 80, maxFps: 2, scale: 1 },
};

export type StateChangeCallback = (newState: StreamState, previousState: StreamState) => void;

export class StreamStateManager {
  private currentState: StreamState = 'static';
  private isUserInteracting: boolean = false;
  private userInteractionTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFrameTime: number = 0;
  private frameInterval: number = Infinity;
  private onStateChange: StateChangeCallback | null = null;
  private staticTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly USER_INTERACTION_TIMEOUT_MS = 1000;
  private readonly SCREEN_MOVING_THRESHOLD_MS = 1000;
  private readonly STATIC_TIMEOUT_MS = 1500;

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
      processed = processed.extract({
        left: Math.round(cropConfig.x),
        top: Math.round(cropConfig.y),
        width: Math.round(cropConfig.width),
        height: Math.round(cropConfig.height),
      });
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
