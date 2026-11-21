import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StreamStateConfig, CropConfig } from '../../src/stream/index.js';

/**
 * Focused tests for per-session isolation of the StreamCoordinator's
 * last-frame cache.
 *
 * All frames are synthetic base64 markers processed by a stubbed
 * FrameProcessor (no sharp, no browser): the tests assert on cache scoping
 * and routing, not on image encoding.
 */

const h = vi.hoisted(() => ({
  processCalls: [] as Array<{ data: string; crop: CropConfig | undefined }>,
}));

vi.mock('../../src/stream/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/stream/index.js')>();
  return {
    ...actual,
    // Synthetic frame processing: echo the source bytes back untouched so
    // assertions can identify which session's cache a payload came from.
    FrameProcessor: class {
      async process(
        data: string,
        _config: StreamStateConfig,
        _viewportWidth?: number,
        _viewportHeight?: number,
        cropConfig?: CropConfig,
      ): Promise<Buffer> {
        h.processCalls.push({ data, crop: cropConfig });
        return Buffer.from(data, 'base64');
      }
    },
  };
});

import { StreamCoordinator } from '../../src/ws/stream-coordinator.js';
import type { BroadcastSink } from '../../src/ws/stream-coordinator.js';
import { SessionManager } from '../../src/ws/session-manager.js';
import type { Page } from '../../src/browser-shim.js';

interface DecodedPayload {
  sessionId: string;
  header: {
    type: string;
    data: { sessionId: string; id: string; viewport: { width: number; height: number } };
  };
  image: Buffer;
}

function b64(marker: string): string {
  return Buffer.from(marker, 'utf-8').toString('base64');
}

function createSink() {
  const broadcastBinaryToSession = vi.fn((_sessionId: string, _payload: Buffer) => {});
  const sink: BroadcastSink = { broadcastBinaryToSession };
  return { sink, broadcastBinaryToSession };
}

function decodeCalls(broadcast: ReturnType<typeof createSink>['broadcastBinaryToSession']): DecodedPayload[] {
  return broadcast.mock.calls.map(([sessionId, payload]) => {
    const headerLen = payload.readUInt32BE(0);
    const header = JSON.parse(payload.subarray(4, 4 + headerLen).toString('utf-8'));
    return { sessionId, header, image: payload.subarray(4 + headerLen) };
  });
}

function createMockPage(url = 'https://a.example'): Page {
  return {
    url: vi.fn(() => url),
    viewportSize: vi.fn(() => null),
    evaluate: vi.fn(async () => ({ width: 1280, height: 800 })),
    screenshot: vi.fn(async () => Buffer.from('snap-A', 'utf-8')),
    on: vi.fn(),
    mouse: {},
    keyboard: {},
  } as unknown as Page;
}

describe('StreamCoordinator per-session last-frame cache', () => {
  let coordinator: StreamCoordinator;
  let broadcast: ReturnType<typeof createSink>['broadcastBinaryToSession'];

  beforeEach(() => {
    h.processCalls.length = 0;
    const { sink, broadcastBinaryToSession } = createSink();
    broadcast = broadcastBinaryToSession;
    coordinator = new StreamCoordinator(sink);
  });

  describe('cached frame independence', () => {
    beforeEach(async () => {
      // Seed two concurrent sessions with distinct synthetic frames.
      await coordinator.processAndBroadcast(b64('frame-A'), { width: 1280, height: 800 }, 'sess-A', 'sess-A', 'f-a', 1, 'https://a');
      await coordinator.processAndBroadcast(b64('frame-B'), { width: 800, height: 600 }, 'sess-B', 'sess-B', 'f-b', 2, 'https://b');
      broadcast.mockClear();
    });

    it('replays each session its own cached frame, never the other session\'s', async () => {
      await coordinator.replayLastFrame('sess-A');
      await coordinator.replayLastFrame('sess-B');

      const payloads = decodeCalls(broadcast);
      expect(payloads).toHaveLength(2);

      const [a, b] = payloads;
      // Each replay is broadcast to exactly its own session...
      expect(a.sessionId).toBe('sess-A');
      expect(b.sessionId).toBe('sess-B');
      // ...labelled as that session...
      expect(a.header.data.sessionId).toBe('sess-A');
      expect(b.header.data.sessionId).toBe('sess-B');
      // ...and carries its own synthetic marker bytes (not the other's).
      expect(a.image.toString('utf-8')).toBe('frame-A');
      expect(b.image.toString('utf-8')).toBe('frame-B');
    });

    it('returns per-session cached viewports', () => {
      expect(coordinator.getLastFrameViewport('sess-A')).toEqual({ width: 1280, height: 800 });
      expect(coordinator.getLastFrameViewport('sess-B')).toEqual({ width: 800, height: 600 });
      expect(coordinator.getLastFrameViewport('sess-unknown')).toBeNull();
    });

    it('legacy no-arg viewport falls back to the most recently updated session', () => {
      expect(coordinator.getLastFrameViewport()).toEqual({ width: 800, height: 600 });
    });

    it('clearing one session leaves the other session\'s cache intact', async () => {
      coordinator.clearLastFrame('sess-A');

      expect(coordinator.getLastFrameViewport('sess-A')).toBeNull();
      await coordinator.replayLastFrame('sess-A');
      expect(broadcast).not.toHaveBeenCalled();

      // sess-B is untouched and still replays its own frame.
      await coordinator.replayLastFrame('sess-B');
      const payloads = decodeCalls(broadcast);
      expect(payloads).toHaveLength(1);
      expect(payloads[0].sessionId).toBe('sess-B');
      expect(payloads[0].image.toString('utf-8')).toBe('frame-B');
    });

    it('legacy no-arg clear drops every session\'s cache', async () => {
      coordinator.clearLastFrame();
      expect(coordinator.getLastFrameViewport('sess-A')).toBeNull();
      expect(coordinator.getLastFrameViewport('sess-B')).toBeNull();

      await coordinator.replayLastFrame('sess-A');
      await coordinator.replayLastFrame('sess-B');
      expect(broadcast).not.toHaveBeenCalled();
    });
  });

  it('a session with no cached frame of its own replays nothing (no cross-session fallback)', async () => {
    await coordinator.processAndBroadcast(b64('frame-A'), { width: 1280, height: 800 }, 'sess-A', 'sess-A', 'f-a', 1, 'https://a');
    broadcast.mockClear();

    // A newly joined viewer on sess-B must not receive sess-A's pixels.
    await coordinator.replayLastFrame('sess-B');
    expect(broadcast).not.toHaveBeenCalled();
    expect(coordinator.getLastFrameViewport('sess-B')).toBeNull();
  });

  it('prefers the session\'s uncropped source over its processed frame on replay', async () => {
    // Processed frame first, then a static snapshot (uncropped source).
    await coordinator.processAndBroadcast(b64('frame-A'), { width: 1280, height: 800 }, 'sess-A', 'sess-A', 'f-a', 1, 'https://a');
    await coordinator.takeStaticSnapshot('sess-A', createMockPage(), 1);
    broadcast.mockClear();

    await coordinator.replayLastFrame('sess-A');

    const payloads = decodeCalls(broadcast);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].image.toString('utf-8')).toBe('snap-A');
  });

  it('preserves legacy crop selection: replay re-crops the uncropped source for that session', async () => {
    await coordinator.takeStaticSnapshot('sess-A', createMockPage(), 1);
    coordinator.setCrop('sess-A', {
      selector: '#qr',
      box: { x: 100, y: 100, width: 400, height: 300 },
    });
    broadcast.mockClear();
    h.processCalls.length = 0;

    await coordinator.replayLastFrame('sess-A');

    // The uncropped source was re-processed with this session's crop config.
    expect(h.processCalls).toHaveLength(1);
    expect(h.processCalls[0].data).toBe(b64('snap-A'));
    expect(h.processCalls[0].crop).toEqual({ x: 100, y: 100, width: 400, height: 300 });

    // Header reports the cropped viewport dimensions (legacy behavior).
    const payloads = decodeCalls(broadcast);
    expect(payloads[0].header.data.viewport).toEqual({ width: 400, height: 300 });
  });

  it('releaseSession drops both the frame cache and the crop for that session', async () => {
    await coordinator.processAndBroadcast(b64('frame-A'), { width: 1280, height: 800 }, 'sess-A', 'sess-A', 'f-a', 1, 'https://a');
    coordinator.setCrop('sess-A', { selector: '#x', box: { x: 0, y: 0, width: 10, height: 10 } });

    coordinator.releaseSession('sess-A');

    expect(coordinator.getLastFrameViewport('sess-A')).toBeNull();
    expect(coordinator.getCrop('sess-A')).toBeUndefined();
    broadcast.mockClear();
    await coordinator.replayLastFrame('sess-A');
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('SessionManager.unregisterSession cleanup', () => {
  let sm: SessionManager;

  beforeEach(() => {
    sm = new SessionManager();
  });

  afterEach(() => {
    // Clears ElementMonitor poller intervals even when assertions fail.
    for (const id of sm.getSessionIds()) sm.unregisterSession(id);
  });

  it('releases the coordinator per-session cache on unregister', async () => {
    const { sink, broadcastBinaryToSession: broadcast } = createSink();
    const coordinator = new StreamCoordinator(sink);
    sm.setStreamCoordinator(coordinator);
    sm.registerSession('s1', createMockPage());

    await coordinator.processAndBroadcast(b64('frame-s1'), { width: 1280, height: 800 }, 's1', 's1', 'f-1', 1, 'https://a');
    coordinator.setCrop('s1', { selector: '#x', box: { x: 0, y: 0, width: 10, height: 10 } });
    expect(coordinator.getLastFrameViewport('s1')).toEqual({ width: 1280, height: 800 });
    broadcast.mockClear();

    sm.unregisterSession('s1');

    expect(coordinator.getLastFrameViewport('s1')).toBeNull();
    expect(coordinator.getCrop('s1')).toBeUndefined();
    await coordinator.replayLastFrame('s1');
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('unregistering an unknown session does not throw and still clears stale cache', () => {
    const { sink } = createSink();
    const coordinator = new StreamCoordinator(sink);
    sm.setStreamCoordinator(coordinator);

    expect(() => sm.unregisterSession('ghost')).not.toThrow();
  });
});
