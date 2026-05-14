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
  mockPageEvaluate,
  mockPageGoto,
  mockPageUrl,
  mockContextAddInitScript,
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
  mockPageEvaluate: vi.fn(),
  mockPageGoto: vi.fn(),
  mockPageUrl: vi.fn(),
  mockContextAddInitScript: vi.fn(),
}));

const mockPage = {
  evaluate: mockPageEvaluate,
  goto: mockPageGoto,
  url: mockPageUrl,
  context: vi.fn().mockReturnValue({ addInitScript: mockContextAddInitScript }),
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
  parse: mockYamlParse,
  stringify: vi.fn((obj: unknown) => JSON.stringify(obj)),
}));

import { handleRecord, handleReplay, handleConvert, handleExtract, handleFilter } from '../../src/cli/record-routes.js';

describe('record-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputError.mockImplementation(() => { throw new Error('EXIT'); });
    mockPageUrl.mockReturnValue('about:blank');
    mockPageEvaluate.mockResolvedValue(undefined);
    mockPageGoto.mockResolvedValue(undefined);
    mockContextAddInitScript.mockResolvedValue(undefined);
    mockPage.context.mockReturnValue({ addInitScript: mockContextAddInitScript });
  });

  describe('handleRecord', () => {
    it('should output error when record start has no --url', async () => {
      await expect(handleRecord(['start'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith('Usage: xbrowser record start --url <url> [--cdp <endpoint>]');
    });

    it('should start recording by injecting JS into page', async () => {
      mockFindOrRestoreSession.mockResolvedValue({ page: mockPage });
      mockPageUrl.mockReturnValue('about:blank');

      await handleRecord(['start'], { url: 'https://example.com' }, 'json');

      expect(mockPageGoto).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ waitUntil: 'domcontentloaded' }));
      expect(mockPageEvaluate).toHaveBeenCalled();
      expect(mockContextAddInitScript).toHaveBeenCalled();
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, url: 'https://example.com', injected: true }),
        'json'
      );
    });

    it('should start recording without goto when already on target page', async () => {
      mockFindOrRestoreSession.mockResolvedValue({ page: mockPage });
      mockPageUrl.mockReturnValue('https://example.com/page');

      await handleRecord(['start'], { url: 'https://example.com' }, 'json');

      expect(mockPageGoto).not.toHaveBeenCalled();
      expect(mockPageEvaluate).toHaveBeenCalled();
    });

    it('should create session when none found for start', async () => {
      mockFindOrRestoreSession.mockResolvedValue(null);
      mockCreateSession.mockResolvedValue({ page: mockPage });
      mockPageUrl.mockReturnValue('about:blank');

      await handleRecord(['start'], { url: 'https://example.com' }, 'json');

      expect(mockCreateSession).toHaveBeenCalledWith('default', 'https://example.com', {});
      expect(mockPageEvaluate).toHaveBeenCalled();
    });

    it('should pass cdpEndpoint to resolveSession', async () => {
      mockFindOrRestoreSession.mockResolvedValue({ page: mockPage });
      mockPageUrl.mockReturnValue('https://example.com');

      await handleRecord(['start'], { url: 'https://example.com', cdp: 'http://localhost:9222' }, 'json');

      expect(mockFindOrRestoreSession).toHaveBeenCalledWith('default', 'http://localhost:9222');
    });

    it('should stop recording and extract events', async () => {
      const events = [
        { type: 'click', ts: 100 },
        { type: 'input', ts: 500 },
        { type: 'keydown', ts: 1200 },
      ];
      mockFindOrRestoreSession.mockResolvedValue({ page: mockPage });
      mockPageUrl.mockReturnValue('https://example.com/page');
      mockPageEvaluate.mockResolvedValue(events);
      mockFsExistsSync.mockReturnValue(true);

      await handleRecord(['stop'], {}, 'json');

      expect(mockPageEvaluate).toHaveBeenCalledWith(expect.any(Function));
      expect(mockFsWriteFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'utf8'
      );
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, events: 3, duration: '1s' }),
        'json'
      );
    });

    it('should stop recording with no events', async () => {
      mockFindOrRestoreSession.mockResolvedValue({ page: mockPage });
      mockPageEvaluate.mockResolvedValue([]);

      await handleRecord(['stop'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, events: 0, message: 'No events captured' }),
        'json'
      );
    });

    it('should output error when stop cannot read events from page', async () => {
      mockFindOrRestoreSession.mockResolvedValue({ page: mockPage });
      mockPageEvaluate.mockRejectedValue(new Error('detached'));

      await expect(handleRecord(['stop'], {}, 'text')).rejects.toThrow('EXIT');
      expect(mockOutputError).toHaveBeenCalledWith(expect.stringContaining('Could not read events'));
    });

    it('should use custom output path for stop', async () => {
      mockFindOrRestoreSession.mockResolvedValue({ page: mockPage });
      mockPageUrl.mockReturnValue('https://example.com');
      mockPageEvaluate.mockResolvedValue([{ type: 'click', ts: 0 }]);
      mockFsExistsSync.mockReturnValue(true);

      await handleRecord(['stop'], { output: '/tmp/custom.yaml' }, 'json');

      expect(mockFsWriteFileSync).toHaveBeenCalledWith('/tmp/custom.yaml', expect.any(String), 'utf8');
    });

    it('should return status when recording is active', async () => {
      mockFindOrRestoreSession.mockResolvedValue({ page: mockPage });
      mockPageUrl.mockReturnValue('https://example.com');
      mockPageEvaluate
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(5);

      await handleRecord(['status'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ recording: true, events: 5, url: 'https://example.com' }),
        'json'
      );
    });

    it('should return recording false when no session found for status', async () => {
      mockFindOrRestoreSession.mockResolvedValue(null);

      await handleRecord(['status'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ recording: false, message: 'No session found' }),
        'json'
      );
    });

    it('should return recording false when page evaluate fails for status', async () => {
      mockFindOrRestoreSession.mockResolvedValue({ page: mockPage });
      mockPageEvaluate.mockRejectedValue(new Error('disconnected'));

      await handleRecord(['status'], {}, 'json');

      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({ recording: false, message: 'Cannot reach page' }),
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
