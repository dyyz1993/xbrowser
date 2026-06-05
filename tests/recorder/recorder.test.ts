import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RecorderController } from '../../src/recorder/recorder.js';
import { PlaybackEngine } from '../../src/recorder/player.js';
import type { RecordingSession } from '../../src/recorder/recorder.js';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import type { Page } from '../../src/browser-shim.js';

const TEST_DIR = resolve(tmpdir(), 'xbrowser-test-recorder');

function createMockPage(events: unknown[] = []): Page {
  let evalCallback: ((script: string) => Promise<unknown>) = async () => events;

  return {
    url: vi.fn().mockReturnValue('https://example.com'),
    goto: vi.fn().mockResolvedValue({ status: () => 200 }),
    evaluate: vi.fn().mockImplementation(async (script: unknown) => {
      if (typeof script === 'string') {
        if (script.includes('__xbrowserRecorder')) {
          return events;
        }
        return undefined;
      }
      return undefined;
    }),
    addInitScript: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
    },
    context: vi.fn().mockReturnValue({
      newCDPSession: vi.fn().mockResolvedValue({}),
    }),
  } as unknown as Page;
}

describe('RecorderController', () => {
  let mockPage: Page;

  beforeEach(() => {
    mockPage = createMockPage([]);
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should start recording', async () => {
    const recorder = new RecorderController(mockPage);
    await recorder.start({ url: 'https://example.com' });
    const status = recorder.getStatus();
    expect(status).not.toBeNull();
    expect(status?.isRecording).toBe(true);
    expect(status?.eventCount).toBeGreaterThan(0);
  });

  it('should throw if start called twice', async () => {
    const recorder = new RecorderController(mockPage);
    await recorder.start({ url: 'https://example.com' });
    await expect(recorder.start({ url: 'https://example.com' })).rejects.toThrow(
      'already in progress'
    );
  });

  it('should stop recording and return session', async () => {
    const recorder = new RecorderController(mockPage);
    await recorder.start({ url: 'https://example.com' });
    const result = await recorder.stop(resolve(TEST_DIR, 'test.yaml'));
    expect(result.session).toBeDefined();
    expect(result.session.startUrl).toBe('https://example.com');
    expect(result.session.events.length).toBeGreaterThan(0);
    expect(existsSync(result.path)).toBe(true);
  });

  it('should throw if stop called without start', async () => {
    const recorder = new RecorderController(mockPage);
    await expect(recorder.stop()).rejects.toThrow('No recording');
  });

  it('should return null status when not recording', () => {
    const recorder = new RecorderController(mockPage);
    expect(recorder.getStatus()).toBeNull();
  });

  it('should record page_load event on start', async () => {
    const recorder = new RecorderController(mockPage);
    await recorder.start({ url: 'https://example.com' });
    const result = await recorder.stop(resolve(TEST_DIR, 'test2.yaml'));
    const pageLoads = result.session.events.filter((e) => e.type === 'page_load');
    expect(pageLoads.length).toBeGreaterThan(0);
  });
});

describe('PlaybackEngine', () => {
  let mockPage: Page;

  beforeEach(() => {
    mockPage = createMockPage();
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should create engine from file', () => {
    const session: RecordingSession = {
      id: 'test',
      name: '',
      startUrl: 'https://example.com',
      startTime: new Date().toISOString(),
      duration: 1000,
      events: [
        { id: 'evt_001', type: 'click', timestamp: 0, selector: '#btn' },
      ],
    };
    const filePath = resolve(TEST_DIR, 'playback.yaml');
    const yaml = require('yaml');
    writeFileSync(filePath, yaml.stringify(session));
    const engine = PlaybackEngine.fromFile(mockPage, filePath);
    expect(engine).toBeDefined();
  });

  it('should play click events', async () => {
    const session: RecordingSession = {
      id: 'test',
      name: '',
      startUrl: 'https://example.com',
      startTime: new Date().toISOString(),
      duration: 100,
      events: [
        { id: 'evt_001', type: 'click', timestamp: 0, selector: '#btn' },
      ],
    };
    const engine = new PlaybackEngine(mockPage, session);
    const result = await engine.play({ slowMo: 0 });
    expect(result.success).toBe(true);
    expect(result.eventsPlayed).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('should play type events', async () => {
    const session: RecordingSession = {
      id: 'test',
      name: '',
      startUrl: '',
      startTime: new Date().toISOString(),
      duration: 100,
      events: [
        { id: 'evt_001', type: 'type', timestamp: 0, selector: '#input', data: { value: 'hello' } },
      ],
    };
    const engine = new PlaybackEngine(mockPage, session);
    const result = await engine.play({ slowMo: 0 });
    expect(result.success).toBe(true);
  });

  it('should play scroll events', async () => {
    const session: RecordingSession = {
      id: 'test',
      name: '',
      startUrl: '',
      startTime: new Date().toISOString(),
      duration: 100,
      events: [
        { id: 'evt_001', type: 'scroll', timestamp: 0, data: { scrollX: 0, scrollY: 500 } },
      ],
    };
    const engine = new PlaybackEngine(mockPage, session);
    const result = await engine.play({ slowMo: 0 });
    expect(result.success).toBe(true);
  });

  it('should report errors when event fails', async () => {
    const failPage = createMockPage();
    (failPage.click as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
    (failPage.evaluate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));

    const session: RecordingSession = {
      id: 'test',
      name: '',
      startUrl: '',
      startTime: new Date().toISOString(),
      duration: 100,
      events: [
        { id: 'evt_001', type: 'click', timestamp: 0, selector: '#missing' },
      ],
    };
    const engine = new PlaybackEngine(failPage, session);
    const result = await engine.play({ slowMo: 0 });
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toBe('not found');
  });

  it('should continue on error when stopOnError is false', async () => {
    const failPage = createMockPage();
    (failPage.click as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'));
    (failPage.evaluate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'));

    const session: RecordingSession = {
      id: 'test',
      name: '',
      startUrl: '',
      startTime: new Date().toISOString(),
      duration: 200,
      events: [
        { id: 'evt_001', type: 'click', timestamp: 0, selector: '#fail' },
        { id: 'evt_002', type: 'keypress', timestamp: 100, data: { key: 'Enter' } },
      ],
    };
    const engine = new PlaybackEngine(failPage, session);
    const result = await engine.play({ slowMo: 0, stopOnError: false });
    expect(result.errors).toHaveLength(1);
    expect(result.eventsPlayed).toBe(1);
  });
});
