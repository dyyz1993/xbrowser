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

describe('doubao music command - hook-driven flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Phase 1: Open music panel', () => {
    it('should find and click 音乐生成 button when it exists', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();
      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      await handler({ description: 'test song', timeout: 0 }, ctx);

      expect(page.mouse.click).toHaveBeenCalled();
    });

    it('should fail when 音乐生成 button not found', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();
      page.evaluateHandle.mockImplementation(() => ({ asElement: () => null }));
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      const result = await handler({ description: 'test song', timeout: 0 }, ctx);

      expect(result.success).toBe(false);
    });

    it('should fail when 音乐生成 button exists but not visible', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();
      const musicEl = createMockElement({ textContent: '音乐生成', boundingBox: () => null });
      page.evaluateHandle.mockImplementation(() => ({ asElement: () => musicEl }));
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      const result = await handler({ description: 'test song', timeout: 0 }, ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('Phase 2: Select custom lyric mode', () => {
    it('should click AI帮我写歌词 when lyric param is provided and span exists', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      const aiSpan = createMockElement({ textContent: 'AI 帮我写歌词', boundingBox: () => ({ x: 500, y: 400, width: 120, height: 28 }) });
      const customDiv = createMockElement({ textContent: '自定义歌词', boundingBox: () => ({ x: 500, y: 450, width: 80, height: 24 }) });

      setupEvalHandle(page, {
        '音乐生成': MUSIC_EL,
        'AI 帮我写歌词': aiSpan,
        '自定义歌词': customDiv,
        'flow-end-msg-send': SEND_EL,
        'textarea[placeholder="自定义歌词"]': null,
      });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      await handler({ lyric: '天亮了 屏幕还亮着', timeout: 0 }, ctx);

      // AI click at center of AI span
      const clickCalls = page.mouse.click.mock.calls;
      const aiClick = clickCalls.find(
        (c: number[]) => Math.abs(c[0] - 560) < 10 && Math.abs(c[1] - 414) < 10
      );
      expect(aiClick).toBeDefined();
    });

    it('should click 自定义歌词 after AI帮我写歌词 dropdown opens', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      const aiSpan = createMockElement({ textContent: 'AI 帮我写歌词', boundingBox: () => ({ x: 500, y: 400, width: 120, height: 28 }) });
      const customDiv = createMockElement({ textContent: '自定义歌词', boundingBox: () => ({ x: 500, y: 450, width: 80, height: 24 }) });

      setupEvalHandle(page, {
        '音乐生成': MUSIC_EL,
        'AI 帮我写歌词': aiSpan,
        '自定义歌词': customDiv,
        'flow-end-msg-send': SEND_EL,
        'textarea[placeholder="自定义歌词"]': null,
      });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      await handler({ lyric: '测试歌词', timeout: 0 }, ctx);

      const clickCalls = page.mouse.click.mock.calls;
      const customClick = clickCalls.find(
        (c: number[]) => Math.abs(c[0] - 540) < 10 && Math.abs(c[1] - 462) < 10
      );
      expect(customClick).toBeDefined();
    });

    it('should continue with AI lyric mode when lyric param not provided', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      const editSpan = createMockElement({
        textContent: '描述歌词要表达的主题',
        isContentEditable: true,
        boundingBox: () => ({ x: 300, y: 500, width: 400, height: 40 }),
      });

      setupEvalHandle(page, {
        '音乐生成': MUSIC_EL,
        '描述歌词要表达的主题': editSpan,
        'flow-end-msg-send': SEND_EL,
      });
      page.evaluate.mockImplementation((fn: unknown) => {
        const fnStr = typeof fn === 'function' ? fn.toString() : '';
        if (fnStr.includes('editableSpans') || fnStr.includes('描述歌词要表达的主题')) return true;
        return null;
      });
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      await handler({ description: '春天的田野', timeout: 0 }, ctx);

      const clickCalls = page.mouse.click.mock.calls;
      const editClick = clickCalls.find(
        (c: number[]) => Math.abs(c[0] - 500) < 10 && Math.abs(c[1] - 520) < 10
      );
      expect(editClick).toBeDefined();
    });
  });

  describe('Phase 3: Input lyrics', () => {
    it('should type lyrics into textarea and click confirm', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, {
        '音乐生成': MUSIC_EL,
        'flow-end-msg-send': SEND_EL,
        'textarea[placeholder="自定义歌词"]': null,
      });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const lyric = '天亮了 屏幕还亮着 夜深了 心还在跳';
      const ctx = createMockCtx(page, {});
      const result = await handler({ lyric, timeout: 0 }, ctx);

      expect(page.keyboard.type).toHaveBeenCalledWith(
        lyric,
        expect.objectContaining({ delay: 30 })
      );
    });

    it('should truncate lyrics over 200 chars with warning in tips', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, {
        '音乐生成': MUSIC_EL,
        'flow-end-msg-send': SEND_EL,
        'textarea[placeholder="自定义歌词"]': null,
      });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const longLyric = '啊'.repeat(250);
      const ctx = createMockCtx(page, {});
      const result = await handler({ lyric: longLyric, timeout: 0 }, ctx);

      const typedText = page.keyboard.type.mock.calls[0]?.[0] as string;
      expect(typedText.length).toBeLessThanOrEqual(200);

      const tips = result.tips as string[];
      const truncationTip = tips.find((t: string) => t.includes('截断'));
      expect(truncationTip).toBeDefined();
    });

    it('should click confirm after lyrics input', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();
      const confirmEl = createMockElement({ textContent: '确认', boundingBox: () => ({ x: 550, y: 420, width: 60, height: 30 }) });

      setupEvalHandle(page, {
        '音乐生成': MUSIC_EL,
        'flow-end-msg-send': SEND_EL,
        'textarea[placeholder="自定义歌词"]': null,
        '确认': confirmEl,
      });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      await handler({ lyric: '测试歌词', timeout: 0 }, ctx);

      const clickCalls = page.mouse.click.mock.calls;
      const confirmClick = clickCalls.find(
        (c: number[]) => Math.abs(c[0] - 580) < 10 && Math.abs(c[1] - 435) < 10
      );
      expect(confirmClick).toBeDefined();
    });
  });

  describe('Phase 4: Select style/mood/voice', () => {
    it('should select style when param provided', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      const currentEl = createMockElement({ textContent: '流行', boundingBox: () => ({ x: 600, y: 350, width: 50, height: 24 }) });
      const targetEl = createMockElement({ textContent: '摇滚', boundingBox: () => ({ x: 600, y: 400, width: 50, height: 24 }) });

      let handleCallIdx = 0;
      page.evaluateHandle.mockImplementation((fn: unknown, ...args: unknown[]) => {
        const fnStr = typeof fn === 'function' ? fn.toString() : '';
        const argStr = args.map(a => String(a)).join('|');
        if (argStr.includes('音乐生成') || fnStr.includes('音乐生成')) return { asElement: () => MUSIC_EL };
        if (argStr.includes('AI 帮我写歌词') || fnStr.includes('AI 帮我写歌词')) return { asElement: () => null };
        if (argStr.includes('我想创作一首歌曲') || fnStr.includes('我想创作一首歌曲')) return { asElement: () => null };
        if (fnStr.includes('querySelector') && argStr.includes('flow-end-msg-send')) return { asElement: () => SEND_EL };
        if (fnStr.includes('querySelector') && argStr.includes('textarea')) return { asElement: () => null };
        // selectInlineOption: first call is current (candidates), second is target
        if (argStr.includes('摇滚')) return { asElement: () => targetEl };
        if (fnStr.includes('opts') || argStr.includes('流行') || argStr.includes('嘻哈')) return { asElement: () => currentEl };
        return { asElement: () => null };
      });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      const result = await handler({ lyric: '歌词', style: '摇滚', timeout: 0 }, ctx);

      const tips = result.tips as string[];
      const styleTip = tips.find((t: string) => t.includes('摇滚'));
      expect(styleTip).toBeDefined();
    });

    it('should skip selection when style param not provided', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      const result = await handler({ lyric: '歌词', timeout: 0 }, ctx);

      const tips = result.tips as string[];
      const styleTip = tips.find((t: string) => t.includes('风格'));
      expect(styleTip).toBeUndefined();
    });
  });

  describe('Phase 5: Submit and wait', () => {
    it('should click send button (#flow-end-msg-send) when it exists', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();
      const sendEl = createMockElement({ textContent: '发送', boundingBox: () => ({ x: 960, y: 900, width: 40, height: 30 }) });

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': sendEl, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      await handler({ lyric: '歌词', timeout: 0 }, ctx);

      const clickCalls = page.mouse.click.mock.calls;
      const sendClick = clickCalls.find(
        (c: number[]) => Math.abs(c[0] - 980) < 10 && Math.abs(c[1] - 915) < 10
      );
      expect(sendClick).toBeDefined();
    });

    it('should press Enter when send button not found', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      await handler({ lyric: '歌词', timeout: 0 }, ctx);

      expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
    });

    it('should return submitted status when timeout is 0 (async mode)', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      const result = await handler({ lyric: '歌词', timeout: 0 }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('submitted');
    });
  });

  describe('Phase 6: Network interception & sync wait', () => {
    it('should register response listener for bigmusic/get_video', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => null);

      const registeredHandlers: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];
      page.on.mockImplementation((event: string, h: (...args: unknown[]) => void) => {
        registeredHandlers.push({ event, handler: h });
      });

      const ctx = createMockCtx(page, {});
      await handler({ lyric: '歌词', timeout: 0 }, ctx);

      const responseListener = registeredHandlers.find(h => h.event === 'response');
      expect(responseListener).toBeDefined();
    });

    it('should return timeout status when sync wait expires without audio URL', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => false);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      const result = await handler({ lyric: '歌词', timeout: 1 }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('timeout');
    });

    it('should return error when page shows generation failure text', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation((fn: unknown) => {
        const fnStr = typeof fn === 'function' ? fn.toString() : '';
        if (fnStr.includes('生成失败') || fnStr.includes('出错了') || fnStr.includes('body') && fnStr.includes('innerText')) {
          return true;
        }
        return null;
      });
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      const result = await handler({ lyric: '歌词', timeout: 1 }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.error).toBe('生成失败');
    });
  });

  describe('Validation', () => {
    it('should fail when neither description nor lyric is provided', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();
      const ctx = createMockCtx(page, {});

      const result = await handler({ timeout: 0 }, ctx);

      expect(result.success).toBe(false);
    });

    it('should accept description without lyric (AI lyric mode)', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, '描述歌词要表达的主题': createMockElement({ textContent: '描述歌词要表达的主题', isContentEditable: true, boundingBox: () => ({ x: 300, y: 500, width: 400, height: 40 }) }) });
      page.evaluate.mockImplementation((fn: unknown) => {
        const fnStr = typeof fn === 'function' ? fn.toString() : '';
        if (fnStr.includes('editableSpans') || fnStr.includes('描述歌词要表达的主题')) return true;
        return null;
      });
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      const result = await handler({ description: '快乐的歌曲', timeout: 0 }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.mode).toBe('ai_lyric');
    });

    it('should set mode to custom_lyric when lyric is provided', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      const result = await handler({ lyric: '测试歌词', timeout: 0 }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.mode).toBe('custom_lyric');
    });

    it('should include all params in result data', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      const result = await handler(
        { lyric: '歌词', style: '摇滚', mood: '忧郁', voice: '男声', duration: 120, timeout: 0 },
        ctx
      );

      expect(result.data.style).toBe('摇滚');
      expect(result.data.mood).toBe('忧郁');
      expect(result.data.voice).toBe('男声');
      expect(result.data.duration).toBe(120);
      expect(result.data.lyric).toBe('歌词');
    });
  });

  describe('Debug mode', () => {
    it('should register request listener when debug is true', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => null);

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
    });
  });

  describe('xcli-core integration', () => {
    it('should use site.login for login check', async () => {
      const plugin = (await import('../../.xcli/plugins/doubao/index.ts')).default;
      plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
      expect(mockSite.login).toHaveBeenCalled();
    });

    it('should return result matching declared result schema', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => null);
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

    it('should use fail() for error cases', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();
      const ctx = createMockCtx(page, {});

      const result = await handler({ timeout: 0 }, ctx);

      expect(result.success).toBe(false);
      expect(result.message).toBeDefined();
      expect(result.tips).toBeDefined();
    });
  });

  describe('hook-driven flow (no waitForTimeout)', () => {
    it('should use waitForFunction instead of waitForTimeout for panel expansion', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      await handler({ description: 'test', timeout: 0 }, ctx);

      expect(page.waitForFunction).toHaveBeenCalled();
      expect(page.waitForTimeout).not.toHaveBeenCalled();
    });

    it('should wait for textarea via waitForSelector instead of waitForTimeout', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      await handler({ lyric: '测试歌词', timeout: 0 }, ctx);

      expect(page.waitForSelector).toHaveBeenCalled();
      expect(page.waitForTimeout).not.toHaveBeenCalled();
    });

    it('should wait for confirm button via waitForFunction', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      await handler({ lyric: '歌词', timeout: 0 }, ctx);

      expect(page.waitForFunction.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should wait for dialog to close via waitForGone (waitForSelector detached)', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      await handler({ lyric: '歌词', timeout: 0 }, ctx);

      const detachedCalls = page.waitForSelector.mock.calls.filter(
        (call: unknown[]) => {
          const opts = call[1] as Record<string, unknown> | undefined;
          return opts?.state === 'detached';
        }
      );
      expect(detachedCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should wait for description text via waitForFunction', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => null);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      await handler({ lyric: '歌词', timeout: 0 }, ctx);

      const descWaitCalls = page.waitForFunction.mock.calls.filter(
        (call: unknown[]) => {
          const fn = call[0] as Function;
          return fn.toString().includes('我想创作一首歌曲');
        }
      );
      expect(descWaitCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should register response listener for bigmusic/get_video', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => null);

      const registeredHandlers: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];
      page.on.mockImplementation((event: string, h: (...args: unknown[]) => void) => {
        registeredHandlers.push({ event, handler: h });
      });

      const ctx = createMockCtx(page, {});
      await handler({ lyric: '歌词', timeout: 0 }, ctx);

      const responseListener = registeredHandlers.find(h => h.event === 'response');
      expect(responseListener).toBeDefined();
    });

    it('should timeout gracefully when network response never comes', async () => {
      const handler = await getMusicHandler();
      const page = createMockPage();

      setupEvalHandle(page, { '音乐生成': MUSIC_EL, 'flow-end-msg-send': SEND_EL, 'textarea[placeholder="自定义歌词"]': null });
      page.evaluate.mockImplementation(() => false);
      page.on.mockImplementation(() => {});

      const ctx = createMockCtx(page, {});
      const result = await handler({ lyric: '歌词', timeout: 1 }, ctx);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('timeout');
      expect(page.waitForTimeout).not.toHaveBeenCalled();
    });
  });
});
