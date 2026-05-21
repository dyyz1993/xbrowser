import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockIsDaemonRunning,
  mockForwardNetworkList,
  mockForwardNetworkClear,
  mockForwardNetworkTop,
  mockForwardCommandLog,
  mockForwardNetworkAround,
  mockForwardNetworkAnalyze,
  mockForwardNetworkCurl,
  mockForwardNetworkReplay,
  mockForwardNetworkLike,
  mockForwardNetworkDislike,
  mockForwardNetworkExport,
  mockForwardNetworkInspect,
  mockOutputResult,
  mockOutputError,
} = vi.hoisted(() => ({
  mockIsDaemonRunning: vi.fn<() => Promise<boolean>>(),
  mockForwardNetworkList: vi.fn<() => Promise<unknown>>(),
  mockForwardNetworkClear: vi.fn<() => Promise<void>>(),
  mockForwardNetworkTop: vi.fn<() => Promise<unknown>>(),
  mockForwardCommandLog: vi.fn<() => Promise<unknown>>(),
  mockForwardNetworkAround: vi.fn<() => Promise<unknown>>(),
  mockForwardNetworkAnalyze: vi.fn<() => Promise<unknown>>(),
  mockForwardNetworkCurl: vi.fn<() => Promise<unknown>>(),
  mockForwardNetworkReplay: vi.fn<() => Promise<unknown>>(),
  mockForwardNetworkLike: vi.fn<() => Promise<unknown>>(),
  mockForwardNetworkDislike: vi.fn<() => Promise<unknown>>(),
  mockForwardNetworkExport: vi.fn<() => Promise<unknown>>(),
  mockForwardNetworkInspect: vi.fn<() => Promise<unknown>>(),
  mockOutputResult: vi.fn(),
  mockOutputError: vi.fn(),
}));

vi.mock('../../src/client/daemon-client.js', () => ({
  isDaemonRunning: mockIsDaemonRunning,
  forwardNetworkList: mockForwardNetworkList,
  forwardNetworkClear: mockForwardNetworkClear,
  forwardNetworkTop: mockForwardNetworkTop,
  forwardCommandLog: mockForwardCommandLog,
  forwardNetworkAround: mockForwardNetworkAround,
  forwardNetworkAnalyze: mockForwardNetworkAnalyze,
  forwardNetworkCurl: mockForwardNetworkCurl,
  forwardNetworkReplay: mockForwardNetworkReplay,
  forwardNetworkLike: mockForwardNetworkLike,
  forwardNetworkDislike: mockForwardNetworkDislike,
  forwardNetworkExport: mockForwardNetworkExport,
  forwardNetworkInspect: mockForwardNetworkInspect,
}));

vi.mock('../../src/cli/output.js', () => ({
  outputResult: mockOutputResult,
  outputError: mockOutputError,
}));

vi.mock('@dyyz1993/xcli-core', () => ({
  parseArgs: (argv: string[]) => {
    const positional: string[] = [];
    const options: Record<string, unknown> = {};
    for (let i = 0; i < argv.length; i++) {
      if (argv[i].startsWith('--')) {
        const key = argv[i].slice(2);
        if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          options[key] = argv[++i];
        } else {
          options[key] = true;
        }
      } else if (argv[i].startsWith('-') && argv[i].length === 2) {
        const key = argv[i][1];
        if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          options[key] = argv[++i];
        } else {
          options[key] = true;
        }
      } else {
        positional.push(argv[i]);
      }
    }
    return { positional, options };
  },
}));

vi.mock('../../src/executor.js', () => ({
  executeChain: vi.fn().mockResolvedValue({ success: true, steps: [], totalDuration: 0 }),
  isChainInput: vi.fn(() => false),
}));

vi.mock('../../src/cli/index.js', () => ({
  handleBrowserCommand: vi.fn(),
  handleSession: vi.fn(),
  handlePlugin: vi.fn(),
  handleCreate: vi.fn(),
  handleDaemon: vi.fn(),
  handleRecord: vi.fn(),
  handleReplay: vi.fn(),
  handleConvert: vi.fn(),
  handleExtract: vi.fn(),
  handleFilter: vi.fn(),
  handleRun: vi.fn(),
  handleAdmin: vi.fn(),
}));

vi.mock('../../src/plugin/loader.js', () => {
  const mockLoader = {
    getCore: () => ({
      loader: { getSite: vi.fn(() => null) },
    }),
    scanAndLoad: vi.fn(),
  };
  return { XBrowserPluginLoader: vi.fn(() => mockLoader) };
});

vi.mock('../../src/cli/chain-output.js', () => ({
  printChainResult: vi.fn(),
  printChainResultBrief: vi.fn(),
}));

vi.mock('../../src/cli/help.js', () => ({
  showMainHelp: vi.fn(),
}));

vi.mock('../../src/builtins/index.js', () => ({
  allBuiltins: [],
}));

vi.mock('../../src/browser.js', () => ({
  findSession: vi.fn(() => null),
  createSession: vi.fn(),
  destroyBrowser: vi.fn(),
  findOrRestoreSession: vi.fn(() => null),
  saveSessionDiskMeta: vi.fn(),
}));

import { routeCommand } from '../../src/router.js';

const MOCK_CAPTURES = [
  {
    id: 1,
    method: 'GET',
    status: 200,
    resourceType: 'document',
    path: '/index.html',
    contentType: 'text/html; charset=utf-8',
    size: 2048,
  },
  {
    id: 2,
    method: 'POST',
    status: 404,
    resourceType: 'xhr',
    path: '/api/data',
    contentType: 'application/json',
    size: 512,
  },
];

describe('net CLI command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDaemonRunning.mockResolvedValue(true);
    mockForwardNetworkList.mockResolvedValue({
      total: 2,
      captures: MOCK_CAPTURES,
    });
    mockForwardNetworkClear.mockResolvedValue();
    mockForwardNetworkTop.mockResolvedValue({
      session: 'test',
      entries: [
        {
          id: 1,
          method: 'POST',
          status: 200,
          resourceType: 'xhr',
          path: '/api/users',
          contentType: 'application/json',
          size: 2048,
          score: 85,
          scoreBreakdown: { method: 30, resourceType: 20, size: 20, content: 15 },
        },
        {
          id: 2,
          method: 'GET',
          status: 200,
          resourceType: 'fetch',
          path: '/api/data',
          contentType: 'application/json',
          size: 512,
          score: 40,
          scoreBreakdown: { method: 10, resourceType: 20, size: 0, content: 10 },
        },
      ],
    });
    mockForwardCommandLog.mockResolvedValue({
      session: 'test',
      commands: [
        { id: 1, timestamp: 1700000000000, command: 'goto', params: { url: 'https://example.com' } },
        { id: 2, timestamp: 1700000001000, command: 'click', params: { selector: '#btn' } },
      ],
    });
    mockForwardNetworkAround.mockResolvedValue({
      command: { id: 1, timestamp: 1700000000000, command: 'goto', params: { url: 'https://example.com' }, session: 'test' },
      before: [],
      after: [
        { method: 'GET', status: 200, resourceType: 'document', path: '/index.html' },
        { method: 'POST', status: 201, resourceType: 'xhr', path: '/api/data' },
      ],
      afterCount: 2,
    });
    mockForwardNetworkAnalyze.mockResolvedValue({
      session: 'test',
      total: 3,
      analyzed: [
        {
          id: 1, method: 'GET', status: 200, path: '/api/health',
          contentType: 'application/json', size: 100,
          headers: {}, resourceType: 'fetch', url: 'https://example.com/api/health',
          score: 40, scoreBreakdown: {},
          reusability: { level: 'high', score: 100, reasons: [], detections: { needsSignature: false, needsTimestamp: false, needsAuthToken: false, needsCookies: false, hasFixedCredentials: false } },
        },
        {
          id: 2, method: 'POST', status: 200, path: '/api/login',
          contentType: 'application/json', size: 200,
          headers: { authorization: 'Bearer tok' }, resourceType: 'xhr', url: 'https://example.com/api/login',
          body: { sign: 'abc' },
          score: 80, scoreBreakdown: {},
          reusability: { level: 'low', score: 40, reasons: ['Requires signature parameter', 'Requires authorization token'], detections: { needsSignature: true, needsTimestamp: false, needsAuthToken: true, needsCookies: false, hasFixedCredentials: false } },
        },
        {
          id: 3, method: 'GET', status: 200, path: '/api/data',
          contentType: 'application/json', size: 150,
          headers: {}, resourceType: 'fetch', url: 'https://example.com/api/data',
          score: 30, scoreBreakdown: {},
          reusability: { level: 'medium', score: 80, reasons: ['Requires fresh timestamp'], detections: { needsSignature: false, needsTimestamp: true, needsAuthToken: false, needsCookies: false, hasFixedCredentials: false } },
        },
      ],
    });
    mockForwardNetworkCurl.mockResolvedValue({
      command: "curl --compressed \\\n  -X 'GET' \\\n  'https://example.com/api/data'",
      method: 'GET',
      url: 'https://example.com/api/data',
      headerCount: 2,
      hasBody: false,
    });
    mockForwardNetworkReplay.mockResolvedValue({
      curlCommand: "curl --compressed \\\n  -X 'GET' \\\n  'https://example.com/api/data'",
      replay: {
        success: true,
        status: 200,
        statusText: 'OK',
        contentType: 'application/json',
        size: 256,
        bodyMatch: true,
        duration: 120,
      },
    });
    mockForwardNetworkLike.mockResolvedValue({ ok: true, id: 1, feedback: 'like' });
    mockForwardNetworkDislike.mockResolvedValue({ ok: true, id: 1, feedback: 'dislike' });
    mockForwardNetworkExport.mockResolvedValue({ lang: 'ts', code: "const response = await fetch('https://example.com');" });
    mockForwardNetworkInspect.mockResolvedValue({
      session: 'test',
      capture: {
        id: 1,
        method: 'GET',
        url: 'https://example.com/api/data',
        path: '/api/data',
        status: 200,
        contentType: 'application/json',
        size: 1024,
        resourceType: 'fetch',
        headers: { 'content-type': 'application/json', 'x-custom': 'value' },
        body: { result: 'ok' },
      },
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('net list — text mode', async () => {
    await routeCommand(['net', 'list', '--session', 'test']);
    expect(mockForwardNetworkList).toHaveBeenCalledWith('test', {
      filter: undefined,
      method: undefined,
      limit: 50,
    });
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Network captures');
    expect(output).toContain('session: test');
    expect(output).toContain('Total: 2');
  });

  it('net list — json mode', async () => {
    await routeCommand(['net', 'list', '--json', '--session', 'test']);
    expect(mockOutputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 2,
        captures: expect.arrayContaining([
          expect.objectContaining({ id: 1 }),
          expect.objectContaining({ id: 2 }),
        ]),
      }),
      'json'
    );
  });

  it('net list — with filter', async () => {
    await routeCommand(['net', 'list', '--filter', 'httpbin', '--session', 'test']);
    expect(mockForwardNetworkList).toHaveBeenCalledWith('test', {
      filter: 'httpbin',
      method: undefined,
      limit: 50,
    });
  });

  it('net list — with method filter', async () => {
    await routeCommand(['net', 'list', '--method', 'POST', '--session', 'test']);
    expect(mockForwardNetworkList).toHaveBeenCalledWith('test', {
      filter: undefined,
      method: 'POST',
      limit: 50,
    });
  });

  it('net list — with limit', async () => {
    await routeCommand(['net', 'list', '--limit', '10', '--session', 'test']);
    expect(mockForwardNetworkList).toHaveBeenCalledWith('test', {
      filter: undefined,
      method: undefined,
      limit: 10,
    });
  });

  it('net clear', async () => {
    await routeCommand(['net', 'clear', '--session', 'test']);
    expect(mockForwardNetworkClear).toHaveBeenCalledWith('test');
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('cleared');
  });

  it('net — daemon not running and auto-start fails', async () => {
    mockIsDaemonRunning.mockResolvedValue(false);
    mockForwardNetworkList.mockRejectedValue(new Error('Daemon not available'));
    await routeCommand(['net', 'list', '--session', 'test']);
    expect(mockOutputError).toHaveBeenCalledWith(
      expect.stringContaining('Daemon not available')
    );
  });

  it('net — unknown sub-command', async () => {
    await routeCommand(['net', 'unknown', '--session', 'test']);
    expect(mockOutputError).toHaveBeenCalledWith(
      'Unknown net sub-command: unknown. Use: list, clear, top, log, around, analyze, curl, replay, inspect, like, dislike, export'
    );
  });

  describe('net top', () => {
    it('calls forwardNetworkTop with correct params', async () => {
      await routeCommand(['net', 'top', '--session', 'test']);
      expect(mockForwardNetworkTop).toHaveBeenCalledWith('test', { minScore: 0, limit: 20 });
    });

    it('passes min-score and limit options', async () => {
      await routeCommand(['net', 'top', '--session', 'test', '--min-score', '30', '--limit', '5']);
      expect(mockForwardNetworkTop).toHaveBeenCalledWith('test', { minScore: 30, limit: 5 });
    });

    it('displays scored output in text mode', async () => {
      await routeCommand(['net', 'top', '--session', 'test']);
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Top valued requests');
      expect(output).toContain('session: test');
      expect(output).toContain('85');
      expect(output).toContain('POST');
      expect(output).toContain('/api/users');
    });

    it('outputs JSON when --json flag is used', async () => {
      await routeCommand(['net', 'top', '--json', '--session', 'test']);
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          session: 'test',
          entries: expect.arrayContaining([
            expect.objectContaining({ score: 85 }),
          ]),
        }),
        'json'
      );
    });
  });

  describe('net log', () => {
    it('calls forwardCommandLog with correct params', async () => {
      await routeCommand(['net', 'log', '--session', 'test']);
      expect(mockForwardCommandLog).toHaveBeenCalledWith('test', 50);
    });

    it('passes limit option', async () => {
      await routeCommand(['net', 'log', '--session', 'test', '--limit', '10']);
      expect(mockForwardCommandLog).toHaveBeenCalledWith('test', 10);
    });

    it('displays command log in text mode', async () => {
      await routeCommand(['net', 'log', '--session', 'test']);
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Command log');
      expect(output).toContain('session: test');
      expect(output).toContain('goto');
      expect(output).toContain('click');
    });

    it('outputs JSON when --json flag is used', async () => {
      await routeCommand(['net', 'log', '--json', '--session', 'test']);
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          session: 'test',
          commands: expect.arrayContaining([
            expect.objectContaining({ command: 'goto' }),
          ]),
        }),
        'json',
      );
    });
  });

  describe('net around', () => {
    it('calls forwardNetworkAround with correct params', async () => {
      await routeCommand(['net', 'around', '1', '--session', 'test']);
      expect(mockForwardNetworkAround).toHaveBeenCalledWith('test', 1, 5000);
    });

    it('passes custom window option', async () => {
      await routeCommand(['net', 'around', '1', '--session', 'test', '--window', '3000']);
      expect(mockForwardNetworkAround).toHaveBeenCalledWith('test', 1, 3000);
    });

    it('displays around output in text mode', async () => {
      await routeCommand(['net', 'around', '1', '--session', 'test']);
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Command: #1');
      expect(output).toContain('goto');
      expect(output).toContain('AFTER (2 requests)');
    });

    it('outputs JSON when --json flag is used', async () => {
      await routeCommand(['net', 'around', '1', '--json', '--session', 'test']);
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          afterCount: 2,
        }),
        'json',
      );
    });
  });

  describe('net analyze', () => {
    it('calls forwardNetworkAnalyze with correct session', async () => {
      await routeCommand(['net', 'analyze', '--session', 'test']);
      expect(mockForwardNetworkAnalyze).toHaveBeenCalledWith('test');
    });

    it('displays grouped analysis in text mode', async () => {
      await routeCommand(['net', 'analyze', '--session', 'test']);
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('API Reusability Analysis');
      expect(output).toContain('session: test');
      expect(output).toContain('HIGH');
      expect(output).toContain('MEDIUM');
      expect(output).toContain('LOW');
      expect(output).toContain('/api/health');
      expect(output).toContain('/api/login');
      expect(output).toContain('[100]');
      expect(output).toContain('[ 40]');
      expect(output).toContain('Requires signature parameter');
    });

    it('outputs JSON when --json flag is used', async () => {
      await routeCommand(['net', 'analyze', '--json', '--session', 'test']);
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          session: 'test',
          total: 3,
          analyzed: expect.arrayContaining([
            expect.objectContaining({
              reusability: expect.objectContaining({ level: 'high' }),
            }),
          ]),
        }),
        'json',
      );
    });
  });

  describe('net curl', () => {
    it('calls forwardNetworkCurl with correct session and id', async () => {
      await routeCommand(['net', 'curl', '1', '--session', 'test']);
      expect(mockForwardNetworkCurl).toHaveBeenCalledWith('test', 1);
    });

    it('displays curl command in text mode', async () => {
      await routeCommand(['net', 'curl', '1', '--session', 'test']);
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('GET');
      expect(output).toContain('https://example.com/api/data');
      expect(output).toContain('curl');
    });

    it('outputs JSON when --json flag is used', async () => {
      await routeCommand(['net', 'curl', '1', '--json', '--session', 'test']);
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: 'https://example.com/api/data',
        }),
        'json',
      );
    });

    it('shows error when no id provided', async () => {
      await routeCommand(['net', 'curl', '--session', 'test']);
      expect(mockOutputError).toHaveBeenCalledWith('Usage: xbrowser net curl <id> [--session default]');
    });

    it('shows error when entry not found', async () => {
      mockForwardNetworkCurl.mockResolvedValue({ error: 'Entry #999 not found' });
      await routeCommand(['net', 'curl', '999', '--session', 'test']);
      expect(mockOutputError).toHaveBeenCalledWith('Entry #999 not found');
    });
  });

  describe('net replay', () => {
    it('calls forwardNetworkReplay with correct session and id', async () => {
      await routeCommand(['net', 'replay', '1', '--session', 'test']);
      expect(mockForwardNetworkReplay).toHaveBeenCalledWith('test', 1);
    });

    it('displays replay result in text mode', async () => {
      await routeCommand(['net', 'replay', '1', '--session', 'test']);
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Replay Result');
      expect(output).toContain('200');
      expect(output).toContain('OK');
      expect(output).toContain('120ms');
    });

    it('outputs JSON when --json flag is used', async () => {
      await routeCommand(['net', 'replay', '1', '--json', '--session', 'test']);
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          replay: expect.objectContaining({ status: 200 }),
        }),
        'json',
      );
    });

    it('shows error when no id provided', async () => {
      await routeCommand(['net', 'replay', '--session', 'test']);
      expect(mockOutputError).toHaveBeenCalledWith('Usage: xbrowser net replay <id> [--session default]');
    });

    it('shows error when entry not found', async () => {
      mockForwardNetworkReplay.mockResolvedValue({ error: 'Entry #999 not found' });
      await routeCommand(['net', 'replay', '999', '--session', 'test']);
      expect(mockOutputError).toHaveBeenCalledWith('Entry #999 not found');
    });

    it('displays FAILED for replay with error', async () => {
      mockForwardNetworkReplay.mockResolvedValue({
        curlCommand: "curl -X 'GET' 'https://example.com'",
        replay: {
          success: false,
          status: null,
          statusText: '',
          contentType: '',
          size: 0,
          bodyMatch: false,
          duration: 0,
          error: 'ECONNREFUSED',
        },
      });
      await routeCommand(['net', 'replay', '1', '--session', 'test']);
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('FAILED');
      expect(output).toContain('ECONNREFUSED');
    });
  });

  describe('net inspect', () => {
    it('calls forwardNetworkInspect with correct params', async () => {
      await routeCommand(['net', 'inspect', '1', '--session', 'test']);
      expect(mockForwardNetworkInspect).toHaveBeenCalledWith('test', 1);
    });

    it('displays inspect output in text mode', async () => {
      await routeCommand(['net', 'inspect', '1', '--session', 'test']);
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Request #1');
      expect(output).toContain('GET');
      expect(output).toContain('https://example.com/api/data');
      expect(output).toContain('x-custom');
    });

    it('outputs JSON when --json flag is used', async () => {
      await routeCommand(['net', 'inspect', '1', '--json', '--session', 'test']);
      expect(mockOutputResult).toHaveBeenCalledWith(
        expect.objectContaining({
          session: 'test',
          capture: expect.objectContaining({ id: 1 }),
        }),
        'json',
      );
    });

    it('shows error when no id provided', async () => {
      await routeCommand(['net', 'inspect', '--session', 'test']);
      expect(mockOutputError).toHaveBeenCalledWith('Usage: xbrowser net inspect <id> [--session default]');
    });

    it('shows error when entry not found', async () => {
      mockForwardNetworkInspect.mockResolvedValue({ session: 'test', capture: null });
      await routeCommand(['net', 'inspect', '999', '--session', 'test']);
      expect(mockOutputError).toHaveBeenCalledWith('Entry #999 not found');
    });
  });

  describe('net like', () => {
    it('calls forwardNetworkLike with correct params', async () => {
      await routeCommand(['net', 'like', '1', '--session', 'test']);
      expect(mockForwardNetworkLike).toHaveBeenCalledWith('test', 1);
    });

    it('shows confirmation message', async () => {
      await routeCommand(['net', 'like', '1', '--session', 'test']);
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Marked #1 as useful');
    });

    it('shows error when no id provided', async () => {
      await routeCommand(['net', 'like', '--session', 'test']);
      expect(mockOutputError).toHaveBeenCalledWith('Usage: xbrowser net like <id>');
    });
  });

  describe('net dislike', () => {
    it('calls forwardNetworkDislike with correct params', async () => {
      await routeCommand(['net', 'dislike', '1', '--session', 'test']);
      expect(mockForwardNetworkDislike).toHaveBeenCalledWith('test', 1);
    });

    it('shows confirmation message', async () => {
      await routeCommand(['net', 'dislike', '1', '--session', 'test']);
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Marked #1 as not useful');
    });

    it('shows error when no id provided', async () => {
      await routeCommand(['net', 'dislike', '--session', 'test']);
      expect(mockOutputError).toHaveBeenCalledWith('Usage: xbrowser net dislike <id>');
    });
  });

  describe('net export', () => {
    it('calls forwardNetworkExport with default lang ts', async () => {
      await routeCommand(['net', 'export', '1', '--session', 'test']);
      expect(mockForwardNetworkExport).toHaveBeenCalledWith('test', 1, 'ts');
    });

    it('calls forwardNetworkExport with --lang python', async () => {
      await routeCommand(['net', 'export', '1', '--session', 'test', '--lang', 'python']);
      expect(mockForwardNetworkExport).toHaveBeenCalledWith('test', 1, 'python');
    });

    it('calls forwardNetworkExport with --lang curl', async () => {
      await routeCommand(['net', 'export', '1', '--session', 'test', '--lang', 'curl']);
      expect(mockForwardNetworkExport).toHaveBeenCalledWith('test', 1, 'curl');
    });

    it('outputs code to console', async () => {
      await routeCommand(['net', 'export', '1', '--session', 'test']);
      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('await fetch');
    });

    it('shows error when no id provided', async () => {
      await routeCommand(['net', 'export', '--session', 'test']);
      expect(mockOutputError).toHaveBeenCalledWith('Usage: xbrowser net export <id> [--lang ts|python|curl]');
    });

    it('shows error when entry not found', async () => {
      mockForwardNetworkExport.mockResolvedValue({ error: 'Entry #999 not found' });
      await routeCommand(['net', 'export', '999', '--session', 'test']);
      expect(mockOutputError).toHaveBeenCalledWith('Entry #999 not found');
    });
  });
});
