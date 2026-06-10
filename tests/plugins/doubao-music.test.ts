import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSite = {
  command: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
};

const mockXCLI = {
  createSite: vi.fn(() => mockSite),
};

interface MockElement {
  textContent: string;
  boundingBox: () => { x: number; y: number; width: number; height: number } | null;
  asElement: () => MockElement | null;
  offsetParent: unknown;
  isContentEditable: boolean;
  getAttribute: (attr: string) => string | null;
}

type EvaluateFn = (...args: unknown[]) => unknown;

function createMockElement(overrides: Partial<MockElement> & { textContent?: string } = {}): MockElement {
  const text = overrides.textContent ?? '';
  const box = overrides.boundingBox?.() ?? { x: 100, y: 100, width: 60, height: 30 };
  return {
    textContent: text,
    offsetParent: {} as unknown,
    isContentEditable: false,
    getAttribute: () => null,
    boundingBox: () => box,
    asElement: function () { return this; },
    ...overrides,
  };
}

function createMockPage() {
  const eventListeners: Map<string, Array<(...args: unknown[]) => void>> = new Map();
  let currentUrl = 'https://www.doubao.com/chat/';

  const page = {
    url: () => currentUrl,
    goto: vi.fn(async (url: string) => {
      currentUrl = url;
      return { ok: true };
    }),
    waitForTimeout: vi.fn(async (_ms?: number) => {}),
    waitForSelector: vi.fn(async () => null),
    waitForResponse: vi.fn(async (predicate: (resp: unknown) => boolean) => {
      return { json: async () => ({ code: 0, data: {} }) };
    }),
    waitForFunction: vi.fn(async () => {}),
    evaluate: vi.fn((fn: EvaluateFn | string, ...args: unknown[]) => {
      if (typeof fn === 'string') return {};
      return {};
    }),
    evaluateHandle: vi.fn((fn: EvaluateFn | string, ...args: unknown[]) => {
      return { asElement: () => null };
    }),
    mouse: {
      click: vi.fn(async (_x: number, _y: number) => {}),
    },
    keyboard: {
      type: vi.fn(async (_text: string, _opts?: Record<string, unknown>) => {}),
      press: vi.fn(async (_key: string) => {}),
    },
    screenshot: vi.fn(async () => Buffer.alloc(0)),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const listeners = eventListeners.get(event) || [];
      listeners.push(handler);
      eventListeners.set(event, listeners);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const listeners = eventListeners.get(event);
      if (listeners) {
        const idx = listeners.indexOf(handler);
        if (idx >= 0) listeners.splice(idx, 1);
      }
    }),
    emit: (event: string, ...args: unknown[]) => {
      const listeners = eventListeners.get(event) || [];
      for (const fn of listeners) fn(...args);
    },
    locator: vi.fn((_sel: string) => ({
      first: () => ({
        count: async () => 0,
        click: async () => {},
        fill: async () => {},
      }),
    })),
    _setUrl: (url: string) => { currentUrl = url; },
  };

  return page;
}

type MockPage = ReturnType<typeof createMockPage>;

function createMockCtx(page: MockPage, options: Record<string, unknown> = {}) {
  return {
    page,
    sessionId: 'test-session',
    cdpEndpoint: 'http://localhost:9221',
    options,
    __loginChecked: true,
  } as unknown as Record<string, unknown>;
}

function setupEvalHandle(page: MockPage, elements: Record<string, MockElement | null>) {
  page.evaluateHandle.mockImplementation((fn: unknown, ...args: unknown[]) => {
    const fnStr = typeof fn === 'function' ? fn.toString() : '';
    const argStr = args.map(a => String(a)).join('|');

    for (const [key, el] of Object.entries(elements)) {
      if (argStr === key || argStr.includes(key) || fnStr.includes(key)) {
        return { asElement: () => el };
      }
    }
    return { asElement: () => null };
  });
}

function setupEval(page: MockPage, results: Record<string, unknown>) {
  page.evaluate.mockImplementation((fn: unknown, ...args: unknown[]) => {
    const fnStr = typeof fn === 'function' ? fn.toString() : '';
    const argStr = args.map(a => String(a)).join('|');
    for (const [key, val] of Object.entries(results)) {
      if (fnStr.includes(key) || argStr.includes(key)) return val;
    }
    return null;
  });
}

const SEND_EL = createMockElement({ textContent: '发送', boundingBox: () => ({ x: 100, y: 100, width: 40, height: 20 }) });
const MUSIC_EL = createMockElement({ textContent: '音乐生成', boundingBox: () => ({ x: 900, y: 862, width: 64, height: 32 }) });

async function getMusicHandler(): Promise<(...args: unknown[]) => Promise<unknown>> {
  vi.clearAllMocks();
  const plugin = (await import('../../.xcli/plugins/doubao/index.ts')).default;
  plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'music');
  if (!call) throw new Error('music command not registered');
  return call[1].handler;
}

describe('doubao music command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper: mock evaluate to return a bounding box when safeClickByText
  // searches for a specific text string
  function mockEvaluateForTextClick(page: MockPage, foundText: string) {
    page.evaluate.mockImplementation((fn: unknown, ...args: unknown[]) => {
      const fnStr = typeof fn === 'function' ? fn.toString() : '';
      // safeClickByText evaluates a function that matches textContent === text
      if (fnStr.includes('textContent') && fnStr.includes('offsetParent')) {
        const searchText = args[0] as string;
        if (searchText === '音乐生成' || searchText === foundText) {
          return { x: 100, y: 100, width: 60, height: 30 };
        }
        if (searchText === '更多' || searchText === foundText) {
          return null; // not found is OK
        }
      }
      // safeClickSelector evaluates querySelector
      if (fnStr.includes('document.querySelector') && fnStr.includes('boundingClientRect')) {
        return { x: 100, y: 100, width: 60, height: 30 };
      }
      return null;
    });
    return page;
  }

  describe('Validation', () => {
    it('should fail when neither description nor lyric is provided', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();
      const ctx = createMockCtx(page, {});

      const result = await handler({ timeout: 0 }, ctx);

      expect(result.success).toBe(false);
    });

    it('should use fail() for error cases', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();
      const ctx = createMockCtx(page, {});

      const result = await handler({ timeout: 0 }, ctx);

      expect(result.success).toBe(false);
      expect(result.message).toBeDefined();
      expect(result.tips).toBeDefined();
    });

    it('should use site.login for login check', async () => {
      const plugin = (await import('../../.xcli/plugins/doubao/index.ts')).default;
      plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
      expect(mockSite.login).toHaveBeenCalled();
    });
  });

  describe('Happy path (description mode)', () => {
    it('should submit with description and return submitted status', async () => {
      const handler = await getMusicHandler();
      const page = mockEvaluateForTextClick(createMockPage(), '音乐生成');

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL });
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      const result = await handler({ description: 'a happy song', timeout: 0 }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('submitted');
      expect(result.data.mode).toBe('ai_lyric');
    });
  });

  describe('Happy path (lyric mode)', () => {
    it('should submit with lyric and return submitted status', async () => {
      const handler = await getMusicHandler();
      const page = mockEvaluateForTextClick(createMockPage(), '音乐生成');

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      const result = await handler({ lyric: 'hello world', timeout: 0 }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('submitted');
      expect(result.data.mode).toBe('custom_lyric');
    });

    it('should truncate lyrics over 200 chars', async () => {
      const handler = await getMusicHandler();
      const page = mockEvaluateForTextClick(createMockPage(), '音乐生成');

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.on.mockImplementation(() => {});

      const longLyric = '啊'.repeat(250);
      const ctx = createMockCtx(page, {});
      const result = await handler({ lyric: longLyric, timeout: 0 }, ctx);

      expect(result.success).toBe(true);
      const tips = result.tips as string[];
      const truncationTip = tips.find((t: string) => t.includes('截断'));
      expect(truncationTip).toBeDefined();
    });
  });

  describe('Error cases', () => {
    it('should fail when 音乐生成 button not found', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();
      page.evaluate.mockImplementation(() => null);
      page.evaluateHandle.mockImplementation(() => ({ asElement: () => null }));
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      const result = await handler({ description: 'test song', timeout: 0 }, ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('Debug mode', () => {
    it('should register request listeners when debug is true', async () => {
      const handler = await getMusicHandler();
      const page = mockEvaluateForTextClick(createMockPage(), '音乐生成');

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });

      const registeredHandlers: Array<{ event: string }> = [];
      page.on.mockImplementation((event: string, _h: (...args: unknown[]) => void) => {
        registeredHandlers.push({ event });
      });

      const ctx = createMockCtx(page, {});
      const result = await handler({ lyric: '歌词', debug: true, timeout: 0 }, ctx);

      const requestListeners = registeredHandlers.filter(h => h.event === 'request');
      expect(requestListeners.length).toBeGreaterThanOrEqual(2);

      const tips = result.tips as string[];
      const debugTip = tips.find((t: string) => t.includes('Debug'));
      expect(debugTip).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe('Result schema', () => {
    it('should return result matching declared result schema', async () => {
      const handler = await getMusicHandler();
      const page = mockEvaluateForTextClick(createMockPage(), '音乐生成');

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      const result = await handler({ lyric: '歌词', timeout: 0 }, ctx);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('tips');
      if (result.success) {
        expect(result.data).toHaveProperty('mode');
        expect(result.data).toHaveProperty('status');
      }
    });
  });
});
