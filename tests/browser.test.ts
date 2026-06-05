import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('{}'),
}));

const hoisted = vi.hoisted(() => {
  const mockPage = {
    url: vi.fn().mockReturnValue('about:blank'),
    goto: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(true),
    isClosed: vi.fn().mockReturnValue(false),
  };
  const mockContext = {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(mockPage),
    pages: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    off: vi.fn(),
  };
  const mockBrowser = {
    close: vi.fn().mockResolvedValue(undefined),
    newContext: vi.fn().mockResolvedValue(mockContext),
    contexts: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    off: vi.fn(),
    disconnected: false,
  };
  return { mockPage, mockContext, mockBrowser };
});

vi.mock('../src/cdp-driver/index.js', () => ({
  launch: vi.fn().mockResolvedValue({ browser: hoisted.mockBrowser, wsEndpoint: 'ws://localhost:0' }),
}));

// Don't mock resolveCDPEndpoint — let it use real impl which calls fetch (mocked via stubGlobal)

vi.mock('../src/recorder/session-recorder.js', () => ({
  SessionRecorder: { cleanup: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  getBrowser,
  createSession,
  findSession,
  getSessionById,
  getAllSessions,
  closeSessionByName,
  closeAllSessions,
  destroyBrowser,
  resetForTesting,
} from '../src/browser.js';
import { launch } from '../src/cdp-driver/index.js';

const { mockPage, mockContext, mockBrowser } = hoisted;
const mockLaunch = launch as ReturnType<typeof vi.fn>;

describe('browser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContext.close.mockResolvedValue(undefined);
    mockContext.pages.mockReturnValue([]);
    mockContext.newPage.mockResolvedValue(mockPage);
    mockPage.url.mockReturnValue('about:blank');
    mockPage.goto.mockResolvedValue(undefined);
    mockBrowser.close.mockResolvedValue(undefined);
    mockBrowser.newContext.mockResolvedValue(mockContext);
    mockBrowser.contexts.mockReturnValue([]);
    mockLaunch.mockResolvedValue({ browser: mockBrowser, wsEndpoint: 'ws://localhost:0' });
    mockBrowser.disconnected = false;
    resetForTesting();
  });

  afterEach(() => {
    resetForTesting();
  });

  describe('getBrowser', () => {
    it('should launch browser on first call', async () => {
      const b = await getBrowser({ headless: true });

      expect(mockLaunch).toHaveBeenCalledWith({ executablePath: undefined, headless: true });
      expect(b).toBe(mockBrowser);
    });

    it('should return cached browser on subsequent calls', async () => {
      const b1 = await getBrowser();
      const b2 = await getBrowser();

      expect(b1).toBe(b2);
      expect(mockLaunch).toHaveBeenCalledTimes(1);
    });

    it('should connect via CDP when cdpEndpoint is provided', async () => {
      resetForTesting();

      const b = await getBrowser({ cdpEndpoint: 'ws://localhost:9222/devtools/browser/id' });

      expect(mockLaunch).toHaveBeenCalledWith({ cdpEndpoint: 'ws://localhost:9222/devtools/browser/id' });
      expect(b).toBe(mockBrowser);
    });

    it('should auto-discover CDP endpoint from "auto"', async () => {
      resetForTesting();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ webSocketDebuggerUrl: 'ws://auto-discovered:9222/ws' }),
      });

      await getBrowser({ cdpEndpoint: 'auto' });

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:9222/json/version');
      expect(mockLaunch).toHaveBeenCalledWith({ cdpEndpoint: 'ws://auto-discovered:9222/ws' });
    });

    it('should discover CDP from port number', async () => {
      resetForTesting();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ webSocketDebuggerUrl: 'ws://localhost:9333/ws' }),
      });

      await getBrowser({ cdpEndpoint: '9333' });

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:9333/json/version');
      expect(mockLaunch).toHaveBeenCalledWith({ cdpEndpoint: 'ws://localhost:9333/ws' });
    });

    it('should throw when auto-discover fails', async () => {
      resetForTesting();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await expect(
        getBrowser({ cdpEndpoint: 'auto' })
      ).rejects.toThrow('Could not auto-discover CDP endpoint');
    });

    it('should use executablePath from options', async () => {
      resetForTesting();

      await getBrowser({ executablePath: '/usr/bin/chromium' });

      expect(mockLaunch).toHaveBeenCalledWith({
        executablePath: '/usr/bin/chromium',
        headless: true,
      });
    });
  });

  describe('createSession', () => {
    it('should create a new session with default options', async () => {
      const session = await createSession('test-session');

      expect(session.name).toBe('test-session');
      expect(session.id).toBeTruthy();
      expect(session.context).toBe(mockContext);
      expect(session.page).toBe(mockPage);
      expect(session.isCDP).toBeFalsy();
    });

    it('should navigate to URL when provided', async () => {
      mockPage.url.mockReturnValue('about:blank');

      await createSession('nav-session', 'https://example.com');

      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', {
        timeout: 15000,
        waitUntil: 'domcontentloaded',
      });
    });

    it('should not navigate when page already at URL', async () => {
      mockPage.url.mockReturnValue('https://example.com');

      await createSession('same-url', 'https://example.com');

      expect(mockPage.goto).not.toHaveBeenCalled();
    });

    it('should handle CDP sessions with existing pages', async () => {
      const existingPage = {
        url: vi.fn().mockReturnValue('https://existing.com'),
        goto: vi.fn(),
        on: vi.fn(),
        close: vi.fn(),
        evaluate: vi.fn().mockResolvedValue(true),
        isClosed: vi.fn().mockReturnValue(false),
      };
      mockBrowser.contexts.mockReturnValue([mockContext]);
      mockContext.pages.mockReturnValue([existingPage]);

      const session = await createSession('cdp-session', undefined, {
        cdpEndpoint: 'ws://test',
      });

      expect(session.isCDP).toBe(true);
      expect(session.page).toBe(existingPage);
    });
  });

  describe('findSession', () => {
    it('should find session by name', async () => {
      const session = await createSession('find-me');
      const found = findSession('find-me');

      expect(found).toBeDefined();
      expect(found?.id).toBe(session.id);
    });

    it('should return undefined for unknown name', () => {
      expect(findSession('unknown')).toBeUndefined();
    });
  });

  describe('getSessionById', () => {
    it('should find session by id', async () => {
      const session = await createSession('by-id');
      const found = getSessionById(session.id);

      expect(found).toBeDefined();
      expect(found?.name).toBe('by-id');
    });

    it('should return undefined for unknown id', () => {
      expect(getSessionById('no-such-id')).toBeUndefined();
    });
  });

  describe('getAllSessions', () => {
    it('should return all sessions', async () => {
      await createSession('s1');
      await createSession('s2');

      const all = getAllSessions();

      expect(all).toHaveLength(2);
      expect(all.map((s) => s.name)).toContain('s1');
      expect(all.map((s) => s.name)).toContain('s2');
    });
  });

  describe('closeSessionByName', () => {
    it('should close and remove session by name', async () => {
      await createSession('close-me');

      const result = await closeSessionByName('close-me');

      expect(result).toBe(true);
      expect(mockContext.close).toHaveBeenCalled();
      expect(findSession('close-me')).toBeUndefined();
    });

    it('should close session by id', async () => {
      const session = await createSession('close-by-id');

      const result = await closeSessionByName(session.id);

      expect(result).toBe(true);
      expect(findSession('close-by-id')).toBeUndefined();
    });

    it('should return false for unknown session', async () => {
      const result = await closeSessionByName('unknown');

      expect(result).toBe(false);
    });
  });

  describe('closeAllSessions', () => {
    it('should close all sessions', async () => {
      await createSession('a1');
      await createSession('a2');

      await closeAllSessions();

      expect(getAllSessions()).toHaveLength(0);
      expect(mockContext.close).toHaveBeenCalledTimes(2);
    });

    it('should ignore close errors', async () => {
      await createSession('error-session');
      mockContext.close.mockRejectedValueOnce(new Error('close failed'));

      await expect(closeAllSessions()).resolves.toBeUndefined();
    });
  });

  describe('destroyBrowser', () => {
    it('should close all sessions and browser', async () => {
      await createSession('d1');

      await destroyBrowser();

      expect(getAllSessions()).toHaveLength(0);
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should handle browser close errors', async () => {
      await getBrowser();
      mockBrowser.close.mockRejectedValueOnce(new Error('close error'));

      await expect(destroyBrowser()).resolves.toBeUndefined();
    });
  });
});
