import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';

if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID },
    writable: true,
  });
}

describe('ScreencastCapturer', () => {
  let ScreencastCapturer: typeof import('../src/screencast.js').ScreencastCapturer;

  const mockPage = {
    screenshot: vi.fn(),
    url: vi.fn(),
    viewportSize: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/screencast.js');
    ScreencastCapturer = mod.ScreencastCapturer;
  });

  it('should use default options when none provided', () => {
    const capturer = new ScreencastCapturer();
    expect(capturer.isActive()).toBe(false);
  });

  it('should accept custom options', () => {
    const capturer = new ScreencastCapturer({ interval: 500, quality: 50, type: 'png' });
    expect(capturer.isActive()).toBe(false);
  });

  it('should capture a single frame', async () => {
    mockPage.screenshot.mockResolvedValue(Buffer.from('fake-image'));
    mockPage.url.mockReturnValue('https://example.com');
    mockPage.viewportSize.mockReturnValue({ width: 1280, height: 720 });

    const capturer = new ScreencastCapturer({ quality: 90 });
    const frame = await capturer.captureFrame(mockPage as any, 'session-1');

    expect(frame.sessionId).toBe('session-1');
    expect(frame.url).toBe('https://example.com');
    expect(frame.viewport).toEqual({ width: 1280, height: 720 });
    expect(frame.data).toBe(Buffer.from('fake-image').toString('base64'));
    expect(frame.id).toBeTruthy();
    expect(frame.timestamp).toBeGreaterThan(0);
  });

  it('should handle null viewport in captureFrame', async () => {
    mockPage.screenshot.mockResolvedValue(Buffer.from('img'));
    mockPage.url.mockReturnValue('https://example.com');
    mockPage.viewportSize.mockReturnValue(null);

    const capturer = new ScreencastCapturer();
    const frame = await capturer.captureFrame(mockPage as any, 's1');
    expect(frame.viewport).toEqual({ width: 0, height: 0 });
  });

  it('should start capture and invoke callback', async () => {
    vi.useFakeTimers();
    mockPage.screenshot.mockResolvedValue(Buffer.from('img'));
    mockPage.url.mockReturnValue('https://example.com');
    mockPage.viewportSize.mockReturnValue({ width: 800, height: 600 });

    const capturer = new ScreencastCapturer({ interval: 100 });
    const onFrame = vi.fn();
    capturer.startCapture(mockPage as any, 's1', onFrame);

    expect(capturer.isActive()).toBe(true);
    await vi.advanceTimersByTimeAsync(150);
    capturer.stopCapture();
    expect(onFrame).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('should throw when starting capture while already capturing', () => {
    mockPage.screenshot.mockResolvedValue(Buffer.from('img'));
    mockPage.url.mockReturnValue('https://example.com');
    mockPage.viewportSize.mockReturnValue({ width: 800, height: 600 });

    const capturer = new ScreencastCapturer();
    capturer.startCapture(mockPage as any, 's1', vi.fn());
    expect(() => capturer.startCapture(mockPage as any, 's1', vi.fn())).toThrow('already capturing');
    capturer.stopCapture();
  });

  it('should stop capture and clear state', async () => {
    vi.useFakeTimers();
    mockPage.screenshot.mockResolvedValue(Buffer.from('img'));
    mockPage.url.mockReturnValue('https://example.com');
    mockPage.viewportSize.mockReturnValue({ width: 800, height: 600 });

    const capturer = new ScreencastCapturer({ interval: 100 });
    capturer.startCapture(mockPage as any, 's1', vi.fn());
    await vi.advanceTimersByTimeAsync(50);
    capturer.stopCapture();

    expect(capturer.isActive()).toBe(false);
    vi.useRealTimers();
  });

  it('should update interval', () => {
    const capturer = new ScreencastCapturer({ interval: 1000 });
    capturer.setInterval(500);
    expect(capturer.isActive()).toBe(false);
  });

  it('should stop and restart when setting interval during capture', async () => {
    vi.useFakeTimers();
    mockPage.screenshot.mockResolvedValue(Buffer.from('img'));
    mockPage.url.mockReturnValue('https://example.com');
    mockPage.viewportSize.mockReturnValue({ width: 800, height: 600 });

    const capturer = new ScreencastCapturer({ interval: 1000 });
    capturer.startCapture(mockPage as any, 's1', vi.fn());
    expect(capturer.isActive()).toBe(true);
    capturer.setInterval(500);
    expect(capturer.isActive()).toBe(false);
    vi.useRealTimers();
  });

  it('should update quality', () => {
    const capturer = new ScreencastCapturer({ quality: 80 });
    capturer.setQuality(50);
    expect(capturer.isActive()).toBe(false);
  });
});
