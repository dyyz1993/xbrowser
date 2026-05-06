import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EventEmitter } from 'events';

const mockPage = {
  url: vi.fn().mockReturnValue('https://example.com'),
  screenshot: vi.fn().mockResolvedValue(Buffer.from('fake')),
  viewportSize: vi.fn().mockReturnValue({ width: 800, height: 600 }),
  $: vi.fn().mockResolvedValue(null),
  textContent: vi.fn().mockResolvedValue(''),
};

vi.mock('../src/screencast.js', () => ({
  ScreencastCapturer: vi.fn().mockImplementation(() => ({
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
    isActive: vi.fn().mockReturnValue(false),
  })),
}));

vi.mock('../src/webhook.js', () => ({
  WebhookNotifier: vi.fn().mockImplementation(() => ({
    notify: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock('../src/captcha-detector.js', () => ({
  CaptchaDetector: {
    detect: vi.fn().mockResolvedValue({ detected: false, confidence: 'low' }),
    isSolved: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../src/config.js', () => ({
  getCaptchaConfig: vi.fn(() => ({
    notifyUrl: undefined,
    autoOpen: false,
    timeout: 120,
    previewPort: 9223,
  })),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { HumanInteractionManager } from '../src/human-interaction.js';
import { CaptchaDetector } from '../src/captcha-detector.js';
import type { WSServer } from '../src/websocket-server.js';
import { EventEmitter } from 'events';

function createMockWSServer(): WSServer & EventEmitter {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    setPage: vi.fn(),
    getPort: vi.fn().mockReturnValue(9223),
    broadcast: vi.fn(),
    removeListener: emitter.removeListener.bind(emitter),
    on: emitter.on.bind(emitter),
  }) as unknown as WSServer & EventEmitter;
}

describe('HumanInteractionManager', () => {
  let wsServer: ReturnType<typeof createMockWSServer>;
  let manager: HumanInteractionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    wsServer = createMockWSServer();
    manager = new HumanInteractionManager(wsServer, mockPage as unknown as import('playwright').Page);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with wsServer and page', () => {
      expect(wsServer.setPage).toHaveBeenCalledWith(mockPage);
    });
  });

  describe('waitForHuman', () => {
    it('should detect captcha and return timeout result', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: false,
        confidence: 'low',
      });

      const promise = manager.waitForHuman({ timeout: 5, autoDetect: false });
      await vi.advanceTimersByTimeAsync(6000);
      const result = await promise;

      expect(result.solved).toBe(false);
      expect(result.method).toBe('timeout');
    });

    it('should resolve when human-solved event is emitted', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: false,
        confidence: 'low',
      });

      const promise = manager.waitForHuman({ timeout: 60, autoDetect: false });

      setTimeout(() => {
        wsServer.emit('human-solved');
      }, 100);

      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(result.solved).toBe(true);
      expect(result.method).toBe('preview');
    });

    it('should auto-detect captcha resolution', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: true,
        type: 'recaptcha',
        selector: '.g-recaptcha',
        confidence: 'high',
      });

      vi.mocked(CaptchaDetector.isSolved).mockResolvedValueOnce(true);

      const promise = manager.waitForHuman({ timeout: 60, autoDetect: true, detectInterval: 500 });

      await vi.advanceTimersByTimeAsync(600);
      const result = await promise;

      expect(result.solved).toBe(true);
      expect(result.method).toBe('auto-detected');
    });

    it('should broadcast captcha-detected event', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: true,
        type: 'recaptcha',
        selector: '.g-recaptcha',
        confidence: 'high',
      });

      const promise = manager.waitForHuman({ timeout: 5, autoDetect: false });

      await vi.advanceTimersByTimeAsync(0);

      expect(wsServer.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'captcha-detected' })
      );

      await vi.advanceTimersByTimeAsync(6000);
      await promise;
    });

    it('should use default options when none provided', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: false,
        confidence: 'low',
      });

      const promise = manager.waitForHuman();
      await vi.advanceTimersByTimeAsync(121000);
      const result = await promise;

      expect(result.solved).toBe(false);
      expect(result.method).toBe('timeout');
    });

    it('should return timeout when timeout is 0 (no timeout)', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: false,
        confidence: 'low',
      });

      const promise = manager.waitForHuman({ timeout: 0, autoDetect: false });

      setTimeout(() => {
        wsServer.emit('human-solved');
      }, 50);

      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      expect(result.solved).toBe(true);
      expect(result.method).toBe('preview');
    });
  });
});
