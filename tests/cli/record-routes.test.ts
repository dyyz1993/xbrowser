import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockOutputResult,
  mockOutputError,
  mockGetAllSessions,
  mockRecorderStart,
  mockRecorderStop,
  mockRecorderGetStatus,
  mockPlay,
  mockExtractAndSave,
  mockPrintExtractSummary,
  mockFilterRecording,
  mockParseExcludeTypes,
  mockFsReadFileSync,
  mockFsWriteFileSync,
  mockFsChmodSync,
  mockYamlParse,
} = vi.hoisted(() => ({
  mockOutputResult: vi.fn(),
  mockOutputError: vi.fn(),
  mockGetAllSessions: vi.fn(),
  mockRecorderStart: vi.fn(),
  mockRecorderStop: vi.fn(),
  mockRecorderGetStatus: vi.fn(),
  mockPlay: vi.fn(),
  mockExtractAndSave: vi.fn(),
  mockPrintExtractSummary: vi.fn(),
  mockFilterRecording: vi.fn(),
  mockParseExcludeTypes: vi.fn(),
  mockFsReadFileSync: vi.fn(),
  mockFsWriteFileSync: vi.fn(),
  mockFsChmodSync: vi.fn(),
  mockYamlParse: vi.fn(),
}));

vi.mock('../../src/cli/output.js', () => ({
  outputResult: mockOutputResult,
  outputError: mockOutputError,
}));

vi.mock('../../src/session/session-client.js', () => ({
  getAllSessions: mockGetAllSessions,
}));

vi.mock('../../src/recorder/recorder.js', () => ({
  RecorderController: vi.fn().mockImplementation(() => ({
    start: mockRecorderStart,
    stop: mockRecorderStop,
    getStatus: mockRecorderGetStatus,
  })),
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
  readFileSync: mockFsReadFileSync,
  writeFileSync: mockFsWriteFileSync,
  existsSync: vi.fn(),
  chmodSync: mockFsChmodSync,
}));

vi.mock('yaml', () => ({
  parse: mockYamlParse,
}));

import { handleRecord, handleReplay, handleConvert, handleExtract, handleFilter } from '../../src/cli/record-routes.js';

describe('record-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputError.mockImplementation(() => { throw new Error('EXIT'); });
  });

  describe('handleRecord', () => {
    it('should output error when record start has no --url', async () => {
      await expect(handleRecord(['start'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Usage: xbrowser record start --url <url>');
    });

    it('should output error when no active session for record start', async () => {
      mockGetAllSessions.mockReturnValue([]);
      await expect(handleRecord(['start'], { url: 'https://example.com' }, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith(expect.stringContaining('No active session'));
    });

    it('should output error when stop called with no active recorder', async () => {
      mockOutputError.mockImplementation(() => { throw new Error('EXIT'); });
      await expect(handleRecord(['stop'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('No recording in progress');
    });

    it('should start recording with valid session and url', async () => {
      const mockPage = {};
      mockGetAllSessions.mockReturnValue([{ page: mockPage }]);
      mockRecorderStart.mockResolvedValue(undefined);
      await handleRecord(['start'], { url: 'https://example.com' }, 'json');
      expect(mockRecorderStart).toHaveBeenCalledWith({ url: 'https://example.com', name: undefined });
      expect(mockOutputResult).toHaveBeenCalledWith({ ok: true, url: 'https://example.com' }, 'json');
    });

    it('should stop recording and output result', async () => {
      const mockPage = {};
      mockGetAllSessions.mockReturnValue([{ page: mockPage }]);
      mockRecorderStart.mockResolvedValue(undefined);
      mockRecorderStop.mockResolvedValue({
        path: '/tmp/rec.yaml',
        session: { events: [{ type: 'click' }, { type: 'type' }], duration: 5000 },
      });
      await handleRecord(['start'], { url: 'https://example.com' }, 'text');
      await handleRecord(['stop'], { output: '/tmp/out.yaml' }, 'json');
      expect(mockRecorderStop).toHaveBeenCalledWith('/tmp/out.yaml');
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, path: '/tmp/rec.yaml', events: 2, duration: 5000 }),
        'json'
      );
    });

    it('should return recording false when no active recorder for status', async () => {
      await handleRecord(['status'], {}, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith({ recording: false }, 'json');
    });

    it('should return status when recorder is active', async () => {
      const mockPage = {};
      mockGetAllSessions.mockReturnValue([{ page: mockPage }]);
      mockRecorderStart.mockResolvedValue(undefined);
      mockRecorderGetStatus.mockReturnValue({ isRecording: true, eventCount: 5, duration: 3000 });
      await handleRecord(['start'], { url: 'https://example.com' }, 'text');
      await handleRecord(['status'], {}, 'json');
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ recording: true, events: 5, duration: 3000 }),
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

    it('should output error when no active session for replay', async () => {
      mockGetAllSessions.mockReturnValue([]);
      await expect(handleReplay(['rec.yaml'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith(expect.stringContaining('No active session'));
    });

    it('should replay recording with default slowMo', async () => {
      const mockPage = {};
      mockGetAllSessions.mockReturnValue([{ page: mockPage }]);
      mockPlay.mockResolvedValue({ success: true, eventsPlayed: 3 });
      await handleReplay(['rec.yaml'], {}, 'json');
      expect(mockPlay).toHaveBeenCalledWith({ slowMo: 1 });
      expect(mockOutputResult).toHaveBeenCalledWith({ success: true, eventsPlayed: 3 }, 'json');
    });

    it('should replay recording with custom slow-mo option', async () => {
      const mockPage = {};
      mockGetAllSessions.mockReturnValue([{ page: mockPage }]);
      mockPlay.mockResolvedValue({ success: true });
      await handleReplay(['rec.yaml'], { 'slow-mo': '5' }, 'text');
      expect(mockPlay).toHaveBeenCalledWith({ slowMo: 5 });
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
      mockFsReadFileSync.mockReturnValue('events:\n  - type: click');
      mockYamlParse.mockReturnValue({ startUrl: 'https://example.com', events: [{ type: 'click' }] });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      handleConvert(['rec.yaml', 'out.js'], 'text');
      expect(mockFsWriteFileSync).toHaveBeenCalledWith('out.js', expect.any(String));
      expect(mockFsChmodSync).toHaveBeenCalledWith('out.js', 0o755);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Converted'));
      logSpy.mockRestore();
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
      handleExtract(['rec.yaml'], 'text');
      expect(mockExtractAndSave).toHaveBeenCalledWith('rec.yaml');
      expect(mockPrintExtractSummary).toHaveBeenCalledWith({ startUrl: 'https://a.com' });
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
      handleFilter(['in.yaml', 'out.yaml', '--exclude-types=click'], 'text');
      expect(mockFilterRecording).toHaveBeenCalledWith('in.yaml', 'out.yaml', ['click']);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Filtered'));
      logSpy.mockRestore();
    });
  });
});
