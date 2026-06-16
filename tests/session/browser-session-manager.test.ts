import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs for disk persistence
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('{}'),
}));

// Mock browser module
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
    discoverContexts: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    disconnected: false,
  };
  return { mockPage, mockContext, mockBrowser };
});

vi.mock('../../src/cdp-driver/index.js', () => ({
  launch: vi.fn().mockResolvedValue({ browser: hoisted.mockBrowser, wsEndpoint: 'ws://localhost:0' }),
}));

vi.mock('../../src/recorder/session-recorder.js', () => ({
  SessionRecorder: { cleanup: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocks
import { BrowserSessionManager } from '../../src/session/browser-session-manager.js';
import { resetForTesting } from '../../src/browser.js';
import { launch } from '../../src/cdp-driver/index.js';

const { mockPage, mockContext, mockBrowser } = hoisted;
const mockLaunch = launch as ReturnType<typeof vi.fn>;

describe('BrowserSessionManager', () => {
  let manager: BrowserSessionManager;

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
    manager = new BrowserSessionManager();
  });

  afterEach(() => {
    resetForTesting();
  });

  describe('createSession', () => {
    it('should create a session and return BrowserSessionInfo', async () => {
      const info = await manager.createSession('test', { url: 'https://example.com' });

      expect(info.name).toBe('test');
      expect(info.id).toBeTruthy();
      expect(info.url).toBe('about:blank'); // mockPage.url returns 'about:blank'
      expect(info.createdAt).toBeTruthy();
    });

    it('should throw if session name already exists', async () => {
      await manager.createSession('dup', {});
      await expect(manager.createSession('dup', {})).rejects.toThrow();
    });

    it('should create session with CDP options', async () => {
      mockBrowser.contexts.mockReturnValue([mockContext]);
      mockContext.pages.mockReturnValue([]);

      const info = await manager.createSession('cdp-test', {
        cdpEndpoint: 'ws://localhost:9222',
      });

      expect(info.name).toBe('cdp-test');
    });
  });

  describe('getSession', () => {
    it('should return session info by name', async () => {
      const created = await manager.createSession('find-me', { url: 'http://x' });
      const found = await manager.getSession('find-me');

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe('find-me');
    });

    it('should return undefined for non-existent session', async () => {
      expect(await manager.getSession('nope')).toBeUndefined();
    });
  });

  describe('destroySession', () => {
    it('should close and remove session', async () => {
      await manager.createSession('doom', {});
      const destroyed = await manager.destroySession('doom');

      expect(destroyed).toBeDefined();
      expect(destroyed!.name).toBe('doom');
      expect(await manager.getSession('doom')).toBeUndefined();
    });

    it('should return undefined for non-existent session', async () => {
      expect(await manager.destroySession('ghost')).toBeUndefined();
    });
  });

  describe('listSessions', () => {
    it('should return empty when no sessions', async () => {
      expect(await manager.listSessions()).toEqual([]);
    });

    it('should return all created sessions', async () => {
      await manager.createSession('a', {});
      await manager.createSession('b', {});

      const list = await manager.listSessions();
      expect(list).toHaveLength(2);
      expect(list.map((s) => s.name)).toContain('a');
      expect(list.map((s) => s.name)).toContain('b');
    });
  });

  describe('closeAll', () => {
    it('should close all sessions', async () => {
      await manager.createSession('a', {});
      await manager.createSession('b', {});

      await manager.closeAll();

      expect(await manager.listSessions()).toEqual([]);
    });
  });

  describe('destroy', () => {
    it('should close all sessions and browser', async () => {
      await manager.createSession('d1', {});

      await manager.destroy();

      expect(await manager.listSessions()).toEqual([]);
      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });

  describe('findOrRestore', () => {
    it('should find in-memory session', async () => {
      const created = await manager.createSession('in-mem', {});
      const found = await manager.findOrRestore('in-mem');

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
    });

    it('should return undefined when session not found', async () => {
      const result = await manager.findOrRestore('ghost');
      expect(result).toBeUndefined();
    });
  });
});
