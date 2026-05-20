import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockOutputResult,
  mockOutputError,
  mockFindOrRestoreSession,
  mockCreateSession,
  mockPlay,
  mockExtractAndSave,
  mockPrintExtractSummary,
  mockFilterRecording,
  mockParseExcludeTypes,
  mockFsReadFileSync,
  mockFsWriteFileSync,
  mockFsChmodSync,
  mockYamlParse,
  mockFsExistsSync,
  mockFsMkdirSync,
  mockSendStopSignal,
  mockReadSummary,
  mockReadData,
} = vi.hoisted(() => ({
  mockOutputResult: vi.fn(),
  mockOutputError: vi.fn(),
  mockFindOrRestoreSession: vi.fn(),
  mockCreateSession: vi.fn(),
  mockPlay: vi.fn(),
  mockExtractAndSave: vi.fn(),
  mockPrintExtractSummary: vi.fn(),
  mockFilterRecording: vi.fn(),
  mockParseExcludeTypes: vi.fn(),
  mockFsReadFileSync: vi.fn(),
  mockFsWriteFileSync: vi.fn(),
  mockFsChmodSync: vi.fn(),
  mockYamlParse: vi.fn(),
  mockFsExistsSync: vi.fn(),
  mockFsMkdirSync: vi.fn(),
  mockSendStopSignal: vi.fn(),
  mockReadSummary: vi.fn(),
  mockReadData: vi.fn(),
}));

const mockPage = {
  evaluate: vi.fn(),
  goto: vi.fn(),
  url: vi.fn(),
  context: vi.fn().mockReturnValue({ addInitScript: vi.fn() }),
};

vi.mock('../../src/cli/output.js', () => ({
  outputResult: mockOutputResult,
  outputError: mockOutputError,
}));

vi.mock('../../src/browser.js', () => ({
  findOrRestoreSession: mockFindOrRestoreSession,
  createSession: mockCreateSession,
}));

vi.mock('../../src/recorder/player.js', () => ({
  PlaybackEngine: {
    fromFile: vi.fn().mockReturnValue({ play: mockPlay }),
  },
}));

vi.mock('../../src/recorder/session-recorder.js', () => ({
  SessionRecorder: {
    sendStopSignal: mockSendStopSignal,
    readSummary: mockReadSummary,
    readData: mockReadData,
    getRecordingsDir: vi.fn((name: string) => `/home/.xbrowser/sessions/${name}/recordings`),
  },
}));

vi.mock('../../src/commands/extract.js', () => ({
  extractAndSave: mockExtractAndSave,
  printExtractSummary: mockPrintExtractSummary,
}));

vi.mock('../../src/commands/filter.js', () => ({
  filterRecording: mockFilterRecording,
  parseExcludeTypes: mockParseExcludeTypes,
}));

vi.mock('fs', () => ({
  readFileSync: mockFsReadFileSync,
  writeFileSync: mockFsWriteFileSync,
  existsSync: mockFsExistsSync,
  chmodSync: mockFsChmodSync,
  mkdirSync: mockFsMkdirSync,
}));

vi.mock('yaml', () => ({
  default: { parse: mockYamlParse, stringify: vi.fn((obj: unknown) => JSON.stringify(obj)) },
  parse: mockYamlParse,
  stringify: vi.fn((obj: unknown) => JSON.stringify(obj)),
}));

import { handleRecord, handleReplay, handleConvert, handleExtract, handleFilter } from '../../src/cli/record-routes.js';

describe('record-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputError.mockImplementation(() => { throw new Error('EXIT'); });
  });

  describe('handleRecord', () => {
    // --- start subcommand ---
    it('should output error when record start has no --cdp', async () => {
      await expect(handleRecord(['start'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('CDP endpoint is required for recording. Use --cdp <endpoint>');
    });

    it('should output error when recording already in progress', async () => {
      // readControlFile reads from fs.readFileSync
      mockFsReadFileSync.mockReturnValue(JSON.stringify({
        pid: 1234,
        startedAt: '2024-01-01T00:00:00Z',
        startUrl: 'https://example.com',
        sessionName: 'default',
      }));

      await handleRecord(['start'], { cdp: 'http://localhost:9222' }, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          error: 'Recording already in progress',
          pid: 1234,
        }),
        'json'
      );
    });

    // --- stop subcommand ---
    it('should send stop signal and report success', async () => {
      const control = {
        pid: 1234,
        startedAt: '2024-01-01T00:00:00Z',
        startUrl: 'https://example.com',
        sessionName: 'default',
      };
      mockSendStopSignal.mockResolvedValue(control);
      mockReadSummary.mockReturnValue({
        startUrl: 'https://example.com',
        recordedAt: '2024-01-01',
        durationMs: 5000,
        totalActions: 3,
        totalNetworkRequests: 10,
        steps: [],
      });

      await handleRecord(['stop'], {}, 'json');

      expect(mockSendStopSignal).toHaveBeenCalledWith('default');
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, pid: 1234, sessionName: 'default' }),
        'json'
      );
    });

    it('should report no active recording when stop has no control file', async () => {
      mockSendStopSignal.mockResolvedValue(null);
      mockReadData.mockReturnValue(null);

      await handleRecord(['stop'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false, error: expect.stringContaining('No active recording') }),
        'json'
      );
    });

    it('should report existing data when recorder already exited', async () => {
      mockSendStopSignal.mockResolvedValue(null);
      mockReadData.mockReturnValue({ actions: [{ type: 'click' }], network: [{ url: '/api' }] });

      await handleRecord(['stop'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          actions: 1,
          network: 1,
        }),
        'json'
      );
    });

    it('should respect --session option for stop', async () => {
      const control = { pid: 5678, startedAt: '', startUrl: '', sessionName: 'my-session' };
      mockSendStopSignal.mockResolvedValue(control);
      mockReadSummary.mockReturnValue(null);

      await handleRecord(['stop'], { session: 'my-session' }, 'json');

      expect(mockSendStopSignal).toHaveBeenCalledWith('my-session');
    });

    // --- status subcommand ---
    it('should return status when recording is active (process alive)', async () => {
      const controlFile = {
        pid: process.pid, // use current pid — it's always alive
        startedAt: '2024-01-01T00:00:00Z',
        startUrl: 'https://example.com',
        sessionName: 'default',
      };
      // readControlFile reads from fs.readFileSync
      mockFsReadFileSync.mockReturnValue(JSON.stringify(controlFile));

      await handleRecord(['status'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          recording: true,
          sessionName: 'default',
          pid: process.pid,
          startUrl: 'https://example.com',
        }),
        'json'
      );
    });

    it('should return recording false when no control file found', async () => {
      // readControlFile catches and returns null
      mockFsReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

      await handleRecord(['status'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ recording: false, sessionName: 'default' }),
        'json'
      );
    });

    it('should return recording false when control file process is dead', async () => {
      const controlFile = {
        pid: 999999999, // impossible pid — process.kill will throw
        startedAt: '2024-01-01T00:00:00Z',
        startUrl: 'https://example.com',
        sessionName: 'default',
      };
      mockFsReadFileSync.mockReturnValue(JSON.stringify(controlFile));

      await handleRecord(['status'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ recording: false, sessionName: 'default' }),
        'json'
      );
    });

    it('should respect --session option for status', async () => {
      mockFsReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

      await handleRecord(['status'], { session: 'custom' }, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ recording: false, sessionName: 'custom' }),
        'json'
      );
    });

    // --- unknown subcommand ---
    it('should print usage for unknown record subcommand', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handleRecord(['unknown'], {}, 'text');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
      logSpy.mockRestore();
    });
  });

  describe('handleReplay', () => {
    it('should output error when no file path provided', async () => {
      await expect(handleReplay([], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Usage: xbrowser replay <file>');
    });

    it('should replay recording with existing session', async () => {
      mockFindOrRestoreSession.mockResolvedValue({ page: mockPage });
      mockPlay.mockResolvedValue({ success: true, eventsPlayed: 3 });

      await handleReplay(['rec.yaml'], {}, 'json');

      expect(mockPlay).toHaveBeenCalledWith({ slowMo: 1 });
      expect(mockOutputResult).toHaveBeenCalledWith({ success: true, eventsPlayed: 3 }, 'json');
    });

    it('should create session for replay when none found', async () => {
      mockFindOrRestoreSession.mockResolvedValue(null);
      mockCreateSession.mockResolvedValue({ page: mockPage });
      mockPlay.mockResolvedValue({ success: true });

      await handleReplay(['rec.yaml'], {}, 'json');

      expect(mockCreateSession).toHaveBeenCalledWith('default', undefined, {});
      expect(mockPlay).toHaveBeenCalled();
    });

    it('should replay recording with custom slow-mo option', async () => {
      mockFindOrRestoreSession.mockResolvedValue({ page: mockPage });
      mockPlay.mockResolvedValue({ success: true });

      await handleReplay(['rec.yaml'], { 'slow-mo': '5' }, 'text');

      expect(mockPlay).toHaveBeenCalledWith({ slowMo: 5 });
    });
  });

  describe('handleConvert', () => {
    it('should exit when file path missing', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT'); });
      await expect(handleConvert([], 'text')).rejects.toThrow('EXIT');
      exitSpy.mockRestore();
    });

    it('should exit when output path missing', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT'); });
      await expect(handleConvert(['rec.yaml'], 'text')).rejects.toThrow('EXIT');
      exitSpy.mockRestore();
    });

    it('should convert recording to JS script', async () => {
      mockFsReadFileSync.mockReturnValue('events:\n  - type: click');
      mockYamlParse.mockReturnValue({ startUrl: 'https://example.com', events: [{ type: 'click' }] });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handleConvert(['rec.yaml', 'out.js'], 'text');
      expect(mockFsWriteFileSync).toHaveBeenCalledWith('out.js', expect.any(String));
      expect(mockFsChmodSync).toHaveBeenCalledWith('out.js', 0o755);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Converted'));
      logSpy.mockRestore();
    });
  });

  describe('handleExtract', () => {
    it('should exit when no file path provided', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT'); });
      await expect(handleExtract([], 'text')).rejects.toThrow('EXIT');
      exitSpy.mockRestore();
    });

    it('should extract and save summary', async () => {
      mockExtractAndSave.mockReturnValue({ summary: { startUrl: 'https://a.com' }, outputPath: '/tmp/out.md' });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handleExtract(['rec.yaml'], 'text');
      expect(mockExtractAndSave).toHaveBeenCalledWith('rec.yaml');
      expect(mockPrintExtractSummary).toHaveBeenCalledWith({ startUrl: 'https://a.com' });
      logSpy.mockRestore();
    });
  });

  describe('handleFilter', () => {
    it('should exit when file path missing', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT'); });
      await expect(handleFilter([], 'text')).rejects.toThrow('EXIT');
      exitSpy.mockRestore();
    });

    it('should filter recording and output result', async () => {
      mockParseExcludeTypes.mockReturnValue(['click']);
      mockFilterRecording.mockReturnValue({ originalCount: 10, filteredCount: 5, removed: 5, percentage: 50 });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handleFilter(['in.yaml', 'out.yaml', '--exclude-types=click'], 'text');
      expect(mockFilterRecording).toHaveBeenCalledWith('in.yaml', 'out.yaml', ['click']);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Filtered'));
      logSpy.mockRestore();
    });
  });
});
