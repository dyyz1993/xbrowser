import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockOutputResult,
  mockOutputError,
  mockForwardRecordStart,
  mockForwardRecordStop,
  mockForwardRecordStatus,
  mockForwardRecordSummary,
  mockForwardReplay,
  mockReadSummary,
  mockGetRecordingsDir,
  mockFsReadFileSync,
  mockFsWriteFileSync,
  mockFsExistsSync,
  mockFsMkdirSync,
  mockFsChmodSync,
  mockYamlParse,
  mockPlay,
  mockExtractAndSave,
  mockPrintExtractSummary,
  mockFilterRecording,
  mockParseExcludeTypes,
  mockReadMarkdownSummary,
} = vi.hoisted(() => ({
  mockOutputResult: vi.fn(),
  mockOutputError: vi.fn(),
  mockForwardRecordStart: vi.fn(),
  mockForwardRecordStop: vi.fn(),
  mockForwardRecordStatus: vi.fn(),
  mockForwardRecordSummary: vi.fn(),
  mockForwardReplay: vi.fn(),
  mockReadSummary: vi.fn(),
  mockGetRecordingsDir: vi.fn((name: string) => `/home/.xbrowser/sessions/${name}/recordings`),
  mockFsReadFileSync: vi.fn(),
  mockFsWriteFileSync: vi.fn(),
  mockFsExistsSync: vi.fn(),
  mockFsMkdirSync: vi.fn(),
  mockFsChmodSync: vi.fn(),
  mockYamlParse: vi.fn(),
  mockPlay: vi.fn(),
  mockExtractAndSave: vi.fn(),
  mockPrintExtractSummary: vi.fn(),
  mockFilterRecording: vi.fn(),
  mockParseExcludeTypes: vi.fn(),
  mockReadMarkdownSummary: vi.fn(),
}));

vi.mock('../../src/cli/output.js', () => ({
  outputEnvelope: vi.fn(),
  outputResult: mockOutputResult,
  outputError: mockOutputError,
}));

vi.mock('../../src/client/daemon-client.js', () => ({
  forwardRecordStart: mockForwardRecordStart,
  forwardRecordStop: mockForwardRecordStop,
  forwardRecordStatus: mockForwardRecordStatus,
  forwardRecordSummary: mockForwardRecordSummary,
  forwardReplay: mockForwardReplay,
  isDaemonRunning: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/recorder/session-recorder.js', () => ({
  SessionRecorder: {
    readSummary: mockReadSummary,
    readMarkdownSummary: mockReadMarkdownSummary,
    getRecordingsDir: mockGetRecordingsDir,
  },
}));

vi.mock('../../src/recorder/player.js', () => ({
  PlaybackEngine: {
    fromFile: vi.fn().mockReturnValue({ play: mockPlay }),
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

vi.mock('node:fs', () => ({
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
    it('should call forwardRecordStart and output success', async () => {
      mockForwardRecordStart.mockResolvedValue({
        ok: true,
        startUrl: 'https://example.com',
      });

      await handleRecord(['start'], { url: 'https://example.com' }, 'json');

      expect(mockForwardRecordStart).toHaveBeenCalledWith('default', 'https://example.com', undefined);
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          sessionName: 'default',
          startUrl: 'https://example.com',
        }),
        'json',
      );
    });

    it('should output error when daemon returns failure for start', async () => {
      mockForwardRecordStart.mockResolvedValue({
        ok: false,
        error: 'Recording already in progress',
        pid: 1234,
      });

      await expect(handleRecord(['start'], { url: 'https://example.com' }, 'json')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Recording already in progress');
    });

    // --- stop subcommand ---
    it('should call forwardRecordStop and report success', async () => {
      mockForwardRecordStop.mockResolvedValue({
        ok: true,
        actions: 5,
        network: 3,
        durationMs: 5000,
        steps: [],
      });
      mockReadSummary.mockReturnValue(null);

      await handleRecord(['stop'], {}, 'json');

      expect(mockForwardRecordStop).toHaveBeenCalledWith('default', undefined);
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, sessionName: 'default', actions: 5 }),
        'json',
      );
    });

    it('should report error when daemon returns failure for stop', async () => {
      mockForwardRecordStop.mockResolvedValue({
        ok: false,
        error: 'No active recording',
      });

      await expect(handleRecord(['stop'], {}, 'json')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('No active recording');
    });

    it('should print summary when stop returns data with existing summary', async () => {
      mockForwardRecordStop.mockResolvedValue({
        ok: true,
        actions: 3,
        network: 1,
        durationMs: 2000,
        steps: [],
      });
      mockReadSummary.mockReturnValue({
        startUrl: 'https://example.com',
        recordedAt: '2024-01-01',
        durationMs: 2000,
        totalActions: 3,
        totalNetworkRequests: 1,
        steps: [],
      });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handleRecord(['stop'], {}, 'text');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Recording Summary'));
      logSpy.mockRestore();
    });

    it('should respect --session option for stop', async () => {
      mockForwardRecordStop.mockResolvedValue({
        ok: true,
        actions: 0,
        network: 0,
        durationMs: 0,
        steps: [],
      });
      mockReadSummary.mockReturnValue(null);

      await handleRecord(['stop'], { session: 'my-session' }, 'json');

      expect(mockForwardRecordStop).toHaveBeenCalledWith('my-session', undefined);
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ sessionName: 'my-session' }),
        'json',
      );
    });

    // --- status subcommand ---
    it('should call forwardRecordStatus and output result', async () => {
      mockForwardRecordStatus.mockResolvedValue({
        recording: true,
        sessionName: 'default',
        pid: 1234,
        startUrl: 'https://example.com',
      });

      await handleRecord(['status'], {}, 'json');

      expect(mockForwardRecordStatus).toHaveBeenCalledWith('default');
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          recording: true,
          sessionName: 'default',
          pid: 1234,
        }),
        'json',
      );
    });

    it('should return recording false from daemon RPC', async () => {
      mockForwardRecordStatus.mockResolvedValue({
        recording: false,
        sessionName: 'default',
      });

      await handleRecord(['status'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ recording: false, sessionName: 'default' }),
        'json',
      );
    });

    it('should handle dead process from daemon RPC status', async () => {
      mockForwardRecordStatus.mockResolvedValue({
        recording: false,
        sessionName: 'default',
        reason: 'process_dead',
      });

      await handleRecord(['status'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ recording: false }),
        'json',
      );
    });

    it('should respect --session option for status', async () => {
      mockForwardRecordStatus.mockResolvedValue({
        recording: false,
        sessionName: 'custom',
      });

      await handleRecord(['status'], { session: 'custom' }, 'json');

      expect(mockForwardRecordStatus).toHaveBeenCalledWith('custom');
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
      expect(mockOutputError).toHaveBeenCalledWith('Usage: xbrowser replay <file> [--session <name>] [--slow-mo <ms>]');
    });

    it('should call forwardReplay with resolved absolute path', async () => {
      mockForwardReplay.mockResolvedValue({
        ok: true,
        success: true,
        duration: 500,
        eventsPlayed: 3,
        totalEvents: 3,
        errors: [],
      });

      await handleReplay(['recording.yaml'], {}, 'json');

      expect(mockForwardReplay).toHaveBeenCalledWith(
        expect.stringContaining('recording.yaml'),
        'default',
        undefined,
      );
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, success: true, eventsPlayed: 3 }),
        'json',
      );
    });

    it('should forward --session and --slow-mo options', async () => {
      mockForwardReplay.mockResolvedValue({
        ok: true,
        success: true,
        duration: 1000,
        eventsPlayed: 5,
        totalEvents: 5,
        errors: [],
      });

      await handleReplay(['test.yaml'], { session: 'my-session', 'slow-mo': '2' }, 'json');

      expect(mockForwardReplay).toHaveBeenCalledWith(
        expect.stringContaining('test.yaml'),
        'my-session',
        2,
      );
    });

    it('should output error when daemon returns failure', async () => {
      mockForwardReplay.mockResolvedValue({
        ok: false,
        success: false,
        duration: 0,
        eventsPlayed: 0,
        totalEvents: 0,
        errors: [{ error: 'Session not found: missing' }],
      });

      await expect(handleReplay(['rec.yaml'], { session: 'missing' }, 'json')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Session not found: missing');
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

      vi.doMock('../../src/commands/convert.js', () => ({
        generateJSScript: () => 'console.log("test")',
        generatePythonScript: () => 'print("test")',
        generateBashScript: () => 'echo test',
      }));

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handleConvert(['rec.yaml', 'out.js'], 'text');
      expect(mockFsWriteFileSync).toHaveBeenCalledWith('out.js', expect.any(String));
      expect(mockFsChmodSync).toHaveBeenCalledWith('out.js', 0o755);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Converted'));
      logSpy.mockRestore();
    });

    it('should map new-format actions (element.selector) to flat events before converting', async () => {
      // New recorder format: selector lives under action.element.selector, not top-level.
      // Without the mapping, converters see selector=undefined and fall back to 'body'.
      mockFsReadFileSync.mockReturnValue('{"actions":[]}');
      mockYamlParse.mockReturnValue({
        startUrl: 'https://example.com',
        actions: [
          { type: 'click', element: { selector: '#btn' } },
          { type: 'input', element: { selector: '#input' }, value: 'hello' },
        ],
      });

      // Use the REAL convert module (undo the doMock from the previous test)
      vi.doMock('../../src/commands/convert.js', async () => {
        return await import('../../src/commands/convert.js');
      });

      await handleConvert(['rec.json', 'out.js'], 'text');
      const written = mockFsWriteFileSync.mock.calls[0]?.[1] as string;
      expect(written).toContain("page.click('#btn')");
      expect(written).toContain("page.fill('#input', 'hello')");
      // Must NOT fall back to body
      expect(written).not.toContain("page.click('body')");
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
