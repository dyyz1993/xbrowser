import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const mockPage = {
  url: vi.fn().mockReturnValue('https://example.com'),
  screenshot: vi.fn().mockResolvedValue(Buffer.from('fake')),
  viewportSize: vi.fn().mockReturnValue({ width: 800, height: 600 }),
  $: vi.fn().mockResolvedValue(null),
  textContent: vi.fn().mockResolvedValue(''),
};

// Track webhook notifier instances to assert payload previewUrl.
const webhookInstances: Array<{ notify: ReturnType<typeof vi.fn> }> = [];

vi.mock('../src/webhook.js', () => ({
  WebhookNotifier: vi.fn().mockImplementation(() => {
    const inst = { notify: vi.fn().mockResolvedValue(true) };
    webhookInstances.push(inst);
    return inst;
  }),
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

import { HumanInteractionManager, isHumanWaitActive } from '../src/human-interaction.js';
import { CaptchaDetector } from '../src/captcha-detector.js';
import type { WSServer } from '../src/websocket-server.js';
import { EventEmitter } from 'events';

function createMockWSServer(): WSServer & EventEmitter {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    setPage: vi.fn(),
    getPort: vi.fn().mockReturnValue(9223),
    broadcast: vi.fn(),
    broadcastToSession: vi.fn(),
    removeListener: emitter.removeListener.bind(emitter),
    on: emitter.on.bind(emitter),
  }) as unknown as WSServer & EventEmitter;
}

describe('HumanInteractionManager', () => {
  let wsServer: ReturnType<typeof createMockWSServer>;
  let manager: HumanInteractionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    webhookInstances.length = 0;
    vi.useFakeTimers();
    wsServer = createMockWSServer();
    manager = new HumanInteractionManager(wsServer, mockPage as unknown as import('../src/browser-shim.js').Page);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should register the default session when no session name is given', () => {
      expect(wsServer.registerSession).toHaveBeenCalledWith('default', mockPage);
      expect(manager.session).toBe('default');
    });

    it('should register a named session when provided', () => {
      const named = new HumanInteractionManager(wsServer, mockPage as never, 'my-sess');
      expect(wsServer.registerSession).toHaveBeenCalledWith('my-sess', mockPage);
      expect(named.session).toBe('my-sess');
    });

    it('should fall back to the default session for empty/blank names', () => {
      const blank = new HumanInteractionManager(wsServer, mockPage as never, '   ');
      expect(wsServer.registerSession).toHaveBeenCalledWith('default', mockPage);
      expect(blank.session).toBe('default');
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

    it('should resolve when human-solved is emitted for this session', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: false,
        confidence: 'low',
      });

      const promise = manager.waitForHuman({ timeout: 60, autoDetect: false });

      setTimeout(() => {
        wsServer.emit('human-solved', { sessionId: 'default', clientId: 'c1' });
      }, 100);

      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(result.solved).toBe(true);
      expect(result.method).toBe('preview');
    });

    it('should ignore human-solved emitted for a different session', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: false,
        confidence: 'low',
      });

      const promise = manager.waitForHuman({ timeout: 5, autoDetect: false });

      // Listener must be registered before the cross-session signal fires,
      // otherwise the test would pass for the wrong reason.
      await vi.advanceTimersByTimeAsync(0);
      wsServer.emit('human-solved', { sessionId: 'other-sess', clientId: 'c1' });

      // Cross-session signal must NOT resolve — timeout path wins.
      await vi.advanceTimersByTimeAsync(6000);
      const result = await promise;

      expect(result.solved).toBe(false);
      expect(result.method).toBe('timeout');
    });

    it('should ignore human-solved from an unbound client (null sessionId)', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: false,
        confidence: 'low',
      });

      const promise = manager.waitForHuman({ timeout: 5, autoDetect: false });

      await vi.advanceTimersByTimeAsync(0);
      wsServer.emit('human-solved', { sessionId: null, clientId: 'c1' });

      await vi.advanceTimersByTimeAsync(6000);
      const result = await promise;

      expect(result.solved).toBe(false);
      expect(result.method).toBe('timeout');
    });

    it('should ignore a legacy argument-less human-solved emission', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: false,
        confidence: 'low',
      });

      const promise = manager.waitForHuman({ timeout: 5, autoDetect: false });

      await vi.advanceTimersByTimeAsync(0);
      // Old emitters called emit('human-solved') with no payload — under
      // session isolation this cannot be attributed to a session and is ignored.
      wsServer.emit('human-solved');

      await vi.advanceTimersByTimeAsync(6000);
      const result = await promise;

      expect(result.solved).toBe(false);
      expect(result.method).toBe('timeout');
    });

    it('should auto-detect captcha resolution and scope the resolved broadcast', async () => {
      const named = new HumanInteractionManager(wsServer, mockPage as never, 'my-sess');
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: true,
        type: 'recaptcha',
        selector: '.g-recaptcha',
        confidence: 'high',
      });

      vi.mocked(CaptchaDetector.isSolved).mockResolvedValueOnce(true);

      const promise = named.waitForHuman({ timeout: 60, autoDetect: true, detectInterval: 500 });

      await vi.advanceTimersByTimeAsync(600);
      const result = await promise;

      expect(result.solved).toBe(true);
      expect(result.method).toBe('auto-detected');
      expect(wsServer.broadcastToSession).toHaveBeenCalledWith('my-sess', {
        type: 'resolved',
        sessionId: 'my-sess',
      });
    });

    it('should broadcast captcha-detected only to the waiting session', async () => {
      const named = new HumanInteractionManager(wsServer, mockPage as never, 'my-sess');
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: true,
        type: 'recaptcha',
        selector: '.g-recaptcha',
        confidence: 'high',
      });

      const promise = named.waitForHuman({ timeout: 5, autoDetect: false });

      await vi.advanceTimersByTimeAsync(0);

      expect(wsServer.broadcastToSession).toHaveBeenCalledWith(
        'my-sess',
        expect.objectContaining({ type: 'captcha-detected', sessionId: 'my-sess' })
      );
      // Global broadcast must not be used for session-scoped notifications.
      expect(wsServer.broadcast).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(6000);
      await promise;
    });

    it('should broadcast resolved only to the waiting session on preview solve', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: false,
        confidence: 'low',
      });

      const promise = manager.waitForHuman({ timeout: 60, autoDetect: false });

      // Let setup complete so the human-solved listener is registered.
      await vi.advanceTimersByTimeAsync(0);
      wsServer.emit('human-solved', { sessionId: 'default', clientId: 'c1' });
      const result = await promise;

      expect(result.solved).toBe(true);
      expect(wsServer.broadcastToSession).toHaveBeenCalledWith('default', {
        type: 'resolved',
        sessionId: 'default',
      });
      expect(wsServer.broadcast).not.toHaveBeenCalled();
    });

    it('exposes readiness only while the session can accept a resume signal', async () => {
      const named = new HumanInteractionManager(wsServer, mockPage as never, 'my-sess');
      const promise = named.waitForHuman({ timeout: 5, autoDetect: false });
      expect(isHumanWaitActive(wsServer, 'my-sess')).toBe(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(isHumanWaitActive(wsServer, 'my-sess')).toBe(true);
      expect(isHumanWaitActive(wsServer, 'default')).toBe(false);

      wsServer.emit('human-solved', { sessionId: 'my-sess', clientId: 'c1' });
      await expect(promise).resolves.toMatchObject({ solved: true });
      expect(isHumanWaitActive(wsServer, 'my-sess')).toBe(false);
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
        wsServer.emit('human-solved', { sessionId: 'default', clientId: 'c1' });
      }, 50);

      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      expect(result.solved).toBe(true);
      expect(result.method).toBe('preview');
    });

    it('should include the session in the preview URL (webhook + banner)', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const named = new HumanInteractionManager(wsServer, mockPage as never, 'my-sess');
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: false,
        confidence: 'low',
      });

      const promise = named.waitForHuman({ timeout: 5, autoDetect: false });
      await vi.advanceTimersByTimeAsync(0);

      const webhook = webhookInstances[webhookInstances.length - 1];
      expect(webhook.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'captcha-detected',
          previewUrl: 'http://localhost:9223/preview/my-sess',
        })
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('/preview/my-sess'));

      logSpy.mockRestore();
      await vi.advanceTimersByTimeAsync(6000);
      await promise;
    });
  });

  describe('concurrent wait isolation', () => {
    it('should reject a second concurrent wait on the same session', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValue({
        detected: false,
        confidence: 'low',
      });

      const first = manager.waitForHuman({ timeout: 30, autoDetect: false });
      await vi.advanceTimersByTimeAsync(0);

      await expect(manager.waitForHuman({ timeout: 30, autoDetect: false }))
        .rejects.toThrow(/already in progress.*"default"/);

      wsServer.emit('human-solved', { sessionId: 'default', clientId: 'c1' });
      expect((await first).solved).toBe(true);
    });

    it('should allow a new wait on the same session after the previous completes', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValue({
        detected: false,
        confidence: 'low',
      });

      const first = manager.waitForHuman({ timeout: 1, autoDetect: false });
      await vi.advanceTimersByTimeAsync(2000);
      expect((await first).solved).toBe(false);

      // Slot must have been released by the timeout path.
      const second = manager.waitForHuman({ timeout: 1, autoDetect: false });
      await vi.advanceTimersByTimeAsync(2000);
      expect((await second).solved).toBe(false);
    });

    it('should allow concurrent waits on different sessions of the same server', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValue({
        detected: false,
        confidence: 'low',
      });

      const sessA = new HumanInteractionManager(wsServer, mockPage as never, 'a');
      const sessB = new HumanInteractionManager(wsServer, mockPage as never, 'b');

      const waitA = sessA.waitForHuman({ timeout: 30, autoDetect: false });
      const waitB = sessB.waitForHuman({ timeout: 30, autoDetect: false });
      await vi.advanceTimersByTimeAsync(0);

      // Only B's viewer solves; A must keep waiting.
      wsServer.emit('human-solved', { sessionId: 'b', clientId: 'c1' });
      expect((await waitB).solved).toBe(true);

      wsServer.emit('human-solved', { sessionId: 'a', clientId: 'c2' });
      expect((await waitA).solved).toBe(true);
    });
  });

  describe('handoff cleanup', () => {
    it('should remove the human-solved listener on preview solve', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: false,
        confidence: 'low',
      });

      const promise = manager.waitForHuman({ timeout: 60, autoDetect: false });
      await vi.advanceTimersByTimeAsync(0);
      expect(wsServer.listenerCount('human-solved')).toBe(1);

      wsServer.emit('human-solved', { sessionId: 'default', clientId: 'c1' });
      await promise;

      expect(wsServer.listenerCount('human-solved')).toBe(0);
    });

    it('should notify the viewer and remove the human-solved listener on timeout', async () => {
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({
        detected: false,
        confidence: 'low',
      });

      const promise = manager.waitForHuman({ timeout: 1, autoDetect: false });
      await vi.advanceTimersByTimeAsync(2000);
      await promise;

      expect(wsServer.listenerCount('human-solved')).toBe(0);
      expect(isHumanWaitActive(wsServer, 'default')).toBe(false);
      expect(wsServer.broadcastToSession).toHaveBeenCalledWith('default', {
        type: 'handoff-timeout',
        sessionId: 'default',
      });
    });

    it('should release the wait slot if detection fails', async () => {
      vi.mocked(CaptchaDetector.detect).mockRejectedValueOnce(new Error('detect boom'));

      await expect(manager.waitForHuman({ timeout: 5, autoDetect: false }))
        .rejects.toThrow('detect boom');

      expect(wsServer.listenerCount('human-solved')).toBe(0);

      // Slot released — a retry must be admitted.
      vi.mocked(CaptchaDetector.detect).mockResolvedValueOnce({ detected: false, confidence: 'low' });
      const retry = manager.waitForHuman({ timeout: 1, autoDetect: false });
      await vi.advanceTimersByTimeAsync(2000);
      expect((await retry).solved).toBe(false);
    });
  });
});
