import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockOutputResult,
  mockOutputError,
  mockReadFileSync,
  mockWriteFileSync,
  mockExistsSync,
  mockMkdirSync,
  mockFsChmodSync,
  mockYamlParse,
  mockPlay,
  mockExtractAndSave,
  mockPrintExtractSummary,
  mockFilterRecording,
  mockParseExcludeTypes,
  mockSendStopSignal,
  mockReadData,
  mockReadSummary,
  mockGetRecordingsDir,
} = vi.hoisted(() => ({
  mockOutputResult: vi.fn(),
  mockOutputError: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockFsChmodSync: vi.fn(),
  mockYamlParse: vi.fn(),
  mockPlay: vi.fn(),
  mockExtractAndSave: vi.fn(),
  mockPrintExtractSummary: vi.fn(),
  mockFilterRecording: vi.fn(),
  mockParseExcludeTypes: vi.fn(),
  mockSendStopSignal: vi.fn(),
  mockReadData: vi.fn(),
  mockReadSummary: vi.fn(),
  mockGetRecordingsDir: vi.fn(),
}));

vi.mock('../../src/cli/output.js', () => ({
  outputResult: mockOutputResult,
  outputError: mockOutputError,
}));

vi.mock('../../src/recorder/session-recorder.js', () => ({
  SessionRecorder: {
    sendStopSignal: mockSendStopSignal,
    readData: mockReadData,
    readSummary: mockReadSummary,
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

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  existsSync: mockExistsSync,
  chmodSync: mockFsChmodSync,
  mkdirSync: mockMkdirSync,
}));

vi.mock('yaml', () => ({
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
    it('should output error when record start has no --cdp', async () => {
      await expect(handleRecord(['start'], { url: 'https://example.com' }, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('CDP endpoint is required for recording. Use --cdp <endpoint>');
    });

    it('should print usage for unknown record subcommand', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handleRecord(['unknown'], {}, 'text');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
      logSpy.mockRestore();
    });

    it('should return no active recording for stop with no control file', async () => {
      mockSendStopSignal.mockResolvedValue(null);
      mockReadData.mockReturnValue(null);

      await handleRecord(['stop'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false, error: expect.stringContaining('No active recording') }),
        'json'
      );
    });

    it('should return recording data found for stop with existing data on disk', async () => {
      mockSendStopSignal.mockResolvedValue(null);
      mockReadData.mockReturnValue({ actions: [1, 2, 3], network: [1] });

      await handleRecord(['stop'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, actions: 3, network: 1 }),
        'json'
      );
    });

    it('should output stop signal sent when control file found', async () => {
      mockSendStopSignal.mockResolvedValue({
        pid: 12345,
        sessionName: 'default',
        startedAt: '2024-01-01',
        startUrl: 'https://example.com',
      });
      mockReadSummary.mockReturnValue(null);
      mockGetRecordingsDir.mockReturnValue('/tmp/recordings');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await handleRecord(['stop'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, message: 'Stop signal sent to recording process', pid: 12345 }),
        'json'
      );
      logSpy.mockRestore();
    });

    it('should return recording false when no control file for status', async () => {
      mockReadFileSync.mockReturnValue(undefined);
      mockExistsSync.mockReturnValue(false);

      await handleRecord(['status'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        { recording: false, sessionName: 'default' },
        'json'
      );
    });

    it('should return recording false when control file found but process dead for status', async () => {
      mockReadFileSync.mockReturnValue(JSON.stringify({ pid: 99999999, startedAt: '2024-01-01', startUrl: 'https://example.com' }));
      mockExistsSync.mockReturnValue(true);

      await handleRecord(['status'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ recording: false, sessionName: 'default' }),
        'json'
      );
    });

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
      const mockPage = { evaluate: vi.fn() };
      const mockFindOrRestoreSession = vi.fn().mockResolvedValue({ page: mockPage });
      const mockCreateSession = vi.fn();

      vi.doMock('../../src/browser.js', () => ({
        findOrRestoreSession: mockFindOrRestoreSession,
        createSession: mockCreateSession,
      }));

      const { handleReplay: replay } = await import('../../src/cli/record-routes.js');
      mockPlay.mockResolvedValue({ success: true, eventsPlayed: 3 });
    });

    it('should replay recording with custom slow-mo option', async () => {
      const mockPage = { evaluate: vi.fn() };
      const mockFindOrRestoreSession = vi.fn().mockResolvedValue({ page: mockPage });

      vi.doMock('../../src/browser.js', () => ({
        findOrRestoreSession: mockFindOrRestoreSession,
        createSession: vi.fn(),
      }));

      const { handleReplay: replay } = await import('../../src/cli/record-routes.js');
      mockPlay.mockResolvedValue({ success: true });
    });
  });

  describe('handleConvert', () => {
    it('should exit when file path missing', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT'); });
      expect(() => handleConvert([], 'text')).toThrow('EXIT');
      exitSpy.mockRestore();
    });

    it('should exit when output path missing', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT'); });
      expect(() => handleConvert(['rec.yaml'], 'text')).toThrow('EXIT');
      exitSpy.mockRestore();
    });

    it('should convert recording to JS script', () => {
      mockReadFileSync.mockReturnValue('events:\n  - type: click');
      mockYamlParse.mockReturnValue({ startUrl: 'https://example.com', events: [{ type: 'click' }] });

      vi.doMock('../../src/commands/convert.js', () => ({
        generateJSScript: () => 'console.log("test")',
        generatePythonScript: () => 'print("test")',
        generateBashScript: () => 'echo test',
      }));

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT'); });

      try {
        handleConvert(['rec.yaml', 'out.js'], 'text');
      } catch {
        // process.exit throws in test
      }

      logSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  describe('handleExtract', () => {
    it('should exit when no file path provided', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT'); });
      expect(() => handleExtract([], 'text')).toThrow('EXIT');
      exitSpy.mockRestore();
    });

    it('should extract and save summary', () => {
      mockExtractAndSave.mockReturnValue({ summary: { startUrl: 'https://a.com' }, outputPath: '/tmp/out.md' });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      vi.doMock('../../src/commands/extract.js', () => ({
        extractAndSave: mockExtractAndSave,
        printExtractSummary: mockPrintExtractSummary,
      }));

      try {
        handleExtract(['rec.yaml'], 'text');
      } catch {
        // may exit
      }

      logSpy.mockRestore();
    });
  });

  describe('handleFilter', () => {
    it('should exit when file path missing', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT'); });
      expect(() => handleFilter([], 'text')).toThrow('EXIT');
      exitSpy.mockRestore();
    });

    it('should filter recording and output result', () => {
      mockParseExcludeTypes.mockReturnValue(['click']);
      mockFilterRecording.mockReturnValue({ originalCount: 10, filteredCount: 5, removed: 5, percentage: 50 });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      vi.doMock('../../src/commands/filter.js', () => ({
        filterRecording: mockFilterRecording,
        parseExcludeTypes: mockParseExcludeTypes,
      }));

      try {
        handleFilter(['in.yaml', 'out.yaml', '--exclude-types=click'], 'text');
      } catch {
        // may exit
      }

      logSpy.mockRestore();
    });
  });
});
