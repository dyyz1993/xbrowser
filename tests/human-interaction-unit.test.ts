import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies
vi.mock('child_process', () => ({ execSync: vi.fn() }));

vi.mock('../src/config.js', () => ({
  getCaptchaConfig: vi.fn().mockReturnValue({
    notifyUrl: '',
    autoOpen: false,
    timeout: 60,
    strategy: 'preview-first',
  }),
  getConfigValue: vi.fn(),
  setConfigValue: vi.fn(),
}));

vi.mock('../src/websocket-server.js', () => ({
  WSServer: vi.fn(),
}));

vi.mock('../src/screencast.js', () => ({
  ScreencastCapturer: vi.fn().mockImplementation(() => ({
    startCapture: vi.fn().mockResolvedValue(undefined),
    stopCapture: vi.fn().mockResolvedValue(undefined),
    isCapturing: false,
  })),
}));

vi.mock('../src/captcha-detector.js', () => ({
  CaptchaDetector: Object.assign(
    vi.fn(),
    { detect: vi.fn().mockResolvedValue({ detected: false }) },
  ),
}));

vi.mock('../src/webhook.js', () => ({
  WebhookNotifier: vi.fn().mockImplementation(() => ({
    notify: vi.fn().mockResolvedValue(undefined),
    notifyCaptcha: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/utils/shell-escape.js', () => ({
  shellEscape: vi.fn((s: string) => `'${s}'`),
}));

import { HumanInteractionManager } from '../src/human-interaction.js';

function createMockPage(): Record<string, unknown> {
  return {
    url: vi.fn().mockReturnValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Example'),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('')),
  };
}

function createMockWsServer() {
  return {
    getPreviewUrl: vi.fn().mockReturnValue('http://localhost:9224/preview/default'),
    getPort: vi.fn().mockReturnValue(9224),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    pauseScreencast: vi.fn().mockResolvedValue(undefined),
    resumeScreencast: vi.fn().mockResolvedValue(undefined),
    broadcast: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    removeListener: vi.fn(),
  };
}

describe('HumanInteractionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct without error', () => {
    const page = createMockPage();
    const mgr = new HumanInteractionManager(createMockWsServer() as never, page as never);
    expect(mgr).toBeDefined();
  });

  it('waitForHuman should timeout when no captcha detected', async () => {
    const page = createMockPage();
    const mgr = new HumanInteractionManager(createMockWsServer() as never, page as never);

    const result = await mgr.waitForHuman({ reason: 'test', timeout: 0.1 });
    expect(result.solved).toBe(false);
    expect(result.method).toBe('timeout');
  });

  it('waitForHuman should use default options when none provided', async () => {
    const page = createMockPage();
    const mgr = new HumanInteractionManager(createMockWsServer() as never, page as never);

    const result = await mgr.waitForHuman({ timeout: 0.1 });
    expect(result).toBeDefined();
    expect(result.solved).toBe(false);
  });
});
