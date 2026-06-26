import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock browser.ts — all session management + CDP resolution
vi.mock('../../src/browser.js', () => ({
  createSession: vi.fn().mockResolvedValue({
    id: 'test-session-id',
    name: 'default',
    page: { url: () => 'https://example.com', evaluate: vi.fn(), context: () => ({ newCDPSession: vi.fn() }) },
    context: { browser: () => ({}), on: vi.fn() },
    createdAt: Date.now(),
    cdpEndpoint: undefined,
  }),
  findSession: vi.fn().mockReturnValue(undefined),
  closeSessionByName: vi.fn().mockResolvedValue(undefined),
  getAllSessions: vi.fn().mockReturnValue([]),
  saveSessionDiskMeta: vi.fn(),
}));

// Mock executor.ts
vi.mock('../../src/executor.js', () => ({
  executeCommand: vi.fn().mockResolvedValue({ success: true, data: null, tips: [], duration: 0 }),
  executeChain: vi.fn().mockResolvedValue({ success: true, steps: [], totalDuration: 0 }),
}));

// Mock xcli-core session store functions used by rpc-handlers
vi.mock('@dyyz1993/xcli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dyyz1993/xcli-core')>();
  return {
    ...actual,
    createSessionMeta: vi.fn(),
    removeSession: vi.fn(),
  };
});

// Mock WebSocket server
vi.mock('../../src/websocket-server.js', () => ({
  WSServer: vi.fn().mockImplementation(() => ({
    attachToServer: vi.fn().mockResolvedValue(undefined),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    pauseScreencast: vi.fn().mockResolvedValue(undefined),
    resumeScreencast: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock recorder
vi.mock('../../src/recorder/session-recorder.js', () => {
  const MockSessionRecorder = vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue({ data: { actions: [], network: [] }, summary: { durationMs: 0, steps: [] } }),
    isRecording: false,
    actionCount: 0,
    networkCount: 0,
    getLiveData: vi.fn().mockReturnValue({ actions: [], network: [] }),
    addManualCheckpoint: vi.fn(),
    recordCommandAction: vi.fn(),
  }));
  MockSessionRecorder.readData = vi.fn().mockReturnValue(null);
  MockSessionRecorder.readSummary = vi.fn().mockReturnValue(null);
  return { SessionRecorder: MockSessionRecorder };
});

// Mock player
vi.mock('../../src/recorder/player.js', () => {
  const MockPlaybackEngine = vi.fn().mockImplementation(() => ({
    play: vi.fn().mockResolvedValue({ success: true, duration: 0, eventsPlayed: 0, totalEvents: 0 }),
  }));
  MockPlaybackEngine.fromFile = vi.fn();
  return { PlaybackEngine: MockPlaybackEngine };
});

// Mock utils/cdp
vi.mock('../../src/utils/cdp.js', () => ({
  resolveCDPEndpoint: vi.fn().mockResolvedValue('http://localhost:9222'),
}));

import { createRPCHandler } from '../../src/daemon/rpc-handlers.js';
import { networkStore } from '../../src/daemon/network-store.js';
import { commandLogStore } from '../../src/daemon/network-store.js';
import { feedbackStore } from '../../src/daemon/feedback-store.js';

describe('createRPCHandler', () => {
  let handler: (method: string, params: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    networkStore.clear('default');
    commandLogStore.clear?.('default');
    feedbackStore.clear?.();
    const h = createRPCHandler();
    handler = h as unknown as typeof handler;
  });

  // ── Utility ──
  describe('ping', () => {
    it('should return ok with pid', async () => {
      const result = await handler('ping', {});
      expect(result).toEqual({ ok: true, pid: process.pid });
    });
  });

  // ── Unknown method ──
  describe('unknown method', () => {
    it('should throw for unknown method', async () => {
      await expect(handler('nonexistent:method', {})).rejects.toThrow('Unknown method');
    });
  });

  // ── Session management ──
  describe('session:list', () => {
    it('should return empty session list', async () => {
      const result = await handler('session:list', {});
      expect(result).toEqual([]);
    });
  });

  describe('session:close', () => {
    it('should close a session by name', async () => {
      const result = await handler('session:close', { name: 'test-sess' });
      expect(result).toEqual({ ok: true });
    });
  });

  // ── Network analysis ──
  describe('network:list', () => {
    it('should return empty captures for new session', async () => {
      const result = await handler('network:list', { session: 'default' }) as { captures: unknown[]; total: number };
      expect(result.captures).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should pass filter and limit options', async () => {
      const result = await handler('network:list', {
        session: 'default',
        filter: 'api',
        method: 'GET',
        limit: 5,
      }) as { captures: unknown[] };
      expect(result.captures).toEqual([]);
    });
  });

  describe('network:inspect', () => {
    it('should return null capture for non-existent id', async () => {
      const result = await handler('network:inspect', { session: 'default', id: 999 }) as { capture: unknown };
      expect(result.capture).toBeNull();
    });
  });

  describe('network:clear', () => {
    it('should clear session network store', async () => {
      const result = await handler('network:clear', { session: 'default' });
      expect(result).toEqual({ ok: true });
    });
  });

  describe('network:top', () => {
    it('should return scored entries', async () => {
      const result = await handler('network:top', { session: 'default' }) as { session: string };
      expect(result.session).toBe('default');
    });
  });

  describe('network:around', () => {
    it('should return entries around a command', async () => {
      const result = await handler('network:around', { session: 'default', commandId: 1 });
      expect(result).toBeDefined();
    });
  });

  describe('network:analyze', () => {
    it('should analyze session network entries', async () => {
      const result = await handler('network:analyze', { session: 'default' }) as { session: string; total: number; analyzed: unknown[] };
      expect(result.session).toBe('default');
      expect(Array.isArray(result.analyzed)).toBe(true);
    });
  });

  describe('network:curl', () => {
    it('should return error for non-existent entry', async () => {
      const result = await handler('network:curl', { session: 'default', id: 999 });
      expect(result).toEqual({ error: expect.stringContaining('not found') });
    });
  });

  describe('network:replay', () => {
    it('should return error for non-existent entry', async () => {
      const result = await handler('network:replay', { session: 'default', id: 999 });
      expect(result).toEqual({ error: expect.stringContaining('not found') });
    });
  });

  describe('network:like / dislike', () => {
    it('should return error for liking non-existent entry', async () => {
      const result = await handler('network:like', { session: 'default', id: 999 });
      expect(result).toEqual({ error: expect.stringContaining('not found') });
    });

    it('should return error for disliking non-existent entry', async () => {
      const result = await handler('network:dislike', { session: 'default', id: 999 });
      expect(result).toEqual({ error: expect.stringContaining('not found') });
    });
  });

  describe('network:feedback', () => {
    it('should return feedback list', async () => {
      const result = await handler('network:feedback', {}) as { feedback: unknown[] };
      expect(Array.isArray(result.feedback)).toBe(true);
    });
  });

  describe('network:export', () => {
    it('should return error for non-existent entry', async () => {
      const result = await handler('network:export', { session: 'default', id: 999 });
      expect(result).toEqual({ error: expect.stringContaining('not found') });
    });
  });

  // ── Command log ──
  describe('command:log', () => {
    it('should return command log for session', async () => {
      const result = await handler('command:log', { session: 'default' }) as { session: string; commands: unknown[] };
      expect(result.session).toBe('default');
      expect(Array.isArray(result.commands)).toBe(true);
    });
  });

  // ── Session recording ──
  describe('record:status', () => {
    it('should return not recording for session without recorder', async () => {
      const result = await handler('record:status', { session: 'default' });
      expect(result).toMatchObject({ recording: false, session: 'default', hasRecording: false });
    });
  });

  describe('record:summary', () => {
    it('should return ok false when no summary found', async () => {
      const result = await handler('record:summary', { session: 'default' });
      expect(result).toMatchObject({ ok: false });
    });
  });

  describe('record:stop', () => {
    it('should return ok false when no active recording', async () => {
      const result = await handler('record:stop', { session: 'default' });
      expect(result).toMatchObject({ ok: false });
    });
  });

  describe('record:checkpoint', () => {
    it('should return ok false when no active recording', async () => {
      const result = await handler('record:checkpoint', { session: 'default', hint: 'test' });
      expect(result).toMatchObject({ ok: false });
    });

    it('should return ok false when hint is missing', async () => {
      const result = await handler('record:checkpoint', { session: 'default' });
      expect(result).toMatchObject({ ok: false });
    });
  });

  describe('replay:resume', () => {
    it('should return ok false when no paused replay', async () => {
      const result = await handler('replay:resume', {});
      expect(result).toMatchObject({ ok: false });
    });
  });

  // ── Replay ──
  describe('replay', () => {
    it('should return ok false when file is missing', async () => {
      const result = await handler('replay', {});
      expect(result).toMatchObject({ ok: false });
    });
  });

  // ── Viewer ──
  describe('viewer:check-selector', () => {
    it('should return found false when no selector', async () => {
      const result = await handler('viewer:check-selector', {});
      expect(result).toEqual({ found: false });
    });

    it('should return found false when session not found', async () => {
      const result = await handler('viewer:check-selector', { selector: '#btn', name: 'nonexistent' });
      expect(result).toEqual({ found: false });
    });
  });
});
