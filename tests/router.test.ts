import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../src/executor.js', () => ({
  executeChain: vi.fn().mockResolvedValue({
    success: true,
    steps: [],
    totalDuration: 0,
  }),
  isChainInput: vi.fn((input: string) => /\s&&\s|\s;\s|\s,\s|\s\+\s|\s->\s/.test(input)),
}));

vi.mock('../src/cli/index.js', () => ({
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

vi.mock('../src/cli/output.js', () => ({
  outputError: vi.fn(),
  outputResult: vi.fn(),
}));

vi.mock('../src/plugin/loader.js', () => {
  const mockLoader = {
    getCore: () => ({
      loader: {
        getSite: vi.fn(() => null),
      },
    }),
    scanAndLoad: vi.fn(),
  };
  return {
    XBrowserPluginLoader: vi.fn(() => mockLoader),
  };
});

vi.mock('../src/cli/chain-output.js', () => ({
  printChainResult: vi.fn(),
  printChainResultBrief: vi.fn(),
}));

vi.mock('../src/cli/help.js', () => ({
  showMainHelp: vi.fn(),
}));

vi.mock('../src/builtins/index.js', () => ({
  allBuiltins: [],
}));

vi.mock('../src/browser.js', () => ({
  findSession: vi.fn(() => null),
  createSession: vi.fn(),
  destroyBrowser: vi.fn(),
}));

function mockExit() {
  const origExit = process.exit;
  const exitMock = vi.fn((code: number) => {
    throw new Error(`exit:${code}`);
  });
  process.exit = exitMock as never;
  return {
    restore: () => { process.exit = origExit; },
    mock: exitMock,
  };
}

function suppressExit(fn: () => Promise<void>): Promise<void> {
  return fn().catch(() => {});
}

describe('router', () => {
  let routeCommand: typeof import('../src/router.js').routeCommand;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../src/router.js');
    routeCommand = mod.routeCommand;
  });

  it('shows version with --version flag', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    const exit = mockExit();

    try {
      await routeCommand(['--version']);
    } catch (e) {
      expect(String(e)).toContain('exit:0');
    }
    console.log = origLog;
    exit.restore();
    expect(logs[0]).toContain('xbrowser v');
  });

  it('shows version with -v flag', async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    const exit = mockExit();

    try {
      await routeCommand(['-v']);
    } catch (e) {
      expect(String(e)).toContain('exit:0');
    }
    console.log = origLog;
    exit.restore();
    expect(logs[0]).toContain('xbrowser v');
  });

  it('shows help with --help flag', async () => {
    const { showMainHelp } = await import('../src/cli/help.js');
    const exit = mockExit();

    try {
      await routeCommand(['--help']);
    } catch (e) {
      expect(String(e)).toContain('exit:0');
    }
    exit.restore();
    expect(showMainHelp).toHaveBeenCalled();
  });

  it('shows help when no args', async () => {
    const { showMainHelp } = await import('../src/cli/help.js');
    const exit = mockExit();

    try {
      await routeCommand([]);
    } catch (e) {
      expect(String(e)).toContain('exit:0');
    }
    exit.restore();
    expect(showMainHelp).toHaveBeenCalled();
  });

  it('routes session subcommand to handleSession', async () => {
    const { handleSession } = await import('../src/cli/index.js');
    await routeCommand(['session', 'list']);
    expect(handleSession).toHaveBeenCalledWith(
      ['list'],
      expect.any(Object),
      'text',
      undefined
    );
  });

  it('routes session subcommand with --session option', async () => {
    const { handleSession } = await import('../src/cli/index.js');
    await routeCommand(['--session', 'mysession', 'session', 'list']);
    expect(handleSession).toHaveBeenCalledWith(
      ['list'],
      expect.any(Object),
      'text',
      undefined
    );
  });

  it('routes plugin subcommand to handlePlugin', async () => {
    const { handlePlugin } = await import('../src/cli/index.js');
    await routeCommand(['plugin', 'install', 'some-plugin']);
    expect(handlePlugin).toHaveBeenCalledWith(
      ['install', 'some-plugin'],
      expect.any(Object),
      'text'
    );
  });

  it('routes create subcommand to handleCreate', async () => {
    const { handleCreate } = await import('../src/cli/index.js');
    await routeCommand(['create', 'my-project']);
    expect(handleCreate).toHaveBeenCalledWith(
      ['my-project'],
      expect.any(Object)
    );
  });

  it('routes daemon subcommand to handleDaemon', async () => {
    const { handleDaemon } = await import('../src/cli/index.js');
    await routeCommand(['daemon', 'start']);
    expect(handleDaemon).toHaveBeenCalledWith(
      ['start'],
      expect.any(Object),
      'text'
    );
  });

  it('routes record subcommand to handleRecord', async () => {
    const { handleRecord } = await import('../src/cli/index.js');
    await routeCommand(['record', 'https://example.com']);
    expect(handleRecord).toHaveBeenCalledWith(
      ['https://example.com'],
      expect.any(Object),
      'text'
    );
  });

  it('routes replay subcommand to handleReplay', async () => {
    const { handleReplay } = await import('../src/cli/index.js');
    await routeCommand(['replay', 'recording.json']);
    expect(handleReplay).toHaveBeenCalledWith(
      ['recording.json'],
      expect.any(Object),
      'text'
    );
  });

  it('routes convert subcommand to handleConvert', async () => {
    const { handleConvert } = await import('../src/cli/index.js');
    await routeCommand(['convert', 'input.json']);
    expect(handleConvert).toHaveBeenCalledWith(['input.json'], 'text');
  });

  it('routes extract subcommand to handleExtract', async () => {
    const { handleExtract } = await import('../src/cli/index.js');
    await routeCommand(['extract', 'https://example.com']);
    expect(handleExtract).toHaveBeenCalledWith(['https://example.com'], 'text');
  });

  it('routes filter subcommand to handleFilter', async () => {
    const { handleFilter } = await import('../src/cli/index.js');
    await routeCommand(['filter', 'data.json']);
    expect(handleFilter).toHaveBeenCalledWith(['data.json'], 'text');
  });

  it('routes admin subcommand to handleAdmin', async () => {
    const { handleAdmin } = await import('../src/cli/index.js');
    await routeCommand(['admin', 'status']);
    expect(handleAdmin).toHaveBeenCalledWith(
      ['status'],
      expect.any(Object),
      'text'
    );
  });

  it('routes help subcommand to showMainHelp', async () => {
    const { showMainHelp } = await import('../src/cli/help.js');
    await routeCommand(['help']);
    expect(showMainHelp).toHaveBeenCalled();
  });

  it('routes run subcommand with file argument', async () => {
    const { handleRun } = await import('../src/cli/index.js');
    await routeCommand(['run', 'test.script']);
    expect(handleRun).toHaveBeenCalledWith(
      'test.script',
      expect.objectContaining({ sessionName: 'default' })
    );
  });

  it('routes run subcommand without file argument shows error', async () => {
    const { outputError } = await import('../src/cli/output.js');
    await routeCommand(['run']);
    expect(outputError).toHaveBeenCalledWith('Usage: xbrowser run <file>');
  });

  it('detects chain input with single arg', async () => {
    const { executeChain } = await import('../src/executor.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(true);
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [{ command: 'title', raw: 'title', success: true, data: null, duration: 0 }],
      totalDuration: 0,
    });

    const exit = mockExit();
    await routeCommand(['goto https://example.com && title']);
    exit.restore();

    expect(executeChain).toHaveBeenCalledWith('goto https://example.com && title', { cdpEndpoint: undefined });
  });

  it('exits with code 1 when chain fails in single arg mode', async () => {
    const { executeChain } = await import('../src/executor.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(true);
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: false,
      steps: [],
      totalDuration: 0,
    });

    const exit = mockExit();
    try {
      await routeCommand(['goto bad && title']);
    } catch (e) {
      expect(String(e)).toContain('exit:1');
    }
    exit.restore();
  });

  it('handles stdin mode with commands', async () => {
    const { executeChain } = await import('../src/executor.js');
    const { printChainResult } = await import('../src/cli/chain-output.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [],
      totalDuration: 0,
    });

    await routeCommand([], ['goto https://example.com', 'title']);

    expect(executeChain).toHaveBeenCalledWith('goto https://example.com && title', { fileMode: true, cdpEndpoint: undefined });
    expect(printChainResult).toHaveBeenCalled();
  });

  it('exits with code 1 when stdin chain fails', async () => {
    const { executeChain } = await import('../src/executor.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: false,
      steps: [],
      totalDuration: 0,
    });

    const exit = mockExit();
    try {
      await routeCommand([], ['bad-command']);
    } catch (e) {
      expect(String(e)).toContain('exit:1');
    }
    exit.restore();
  });

  it('handles eval mode with -e flag', async () => {
    const { executeChain } = await import('../src/executor.js');
    const { printChainResultBrief } = await import('../src/cli/chain-output.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [],
      totalDuration: 0,
    });

    await routeCommand(['-e', 'title']);

    expect(executeChain).toHaveBeenCalledWith('title', { cdpEndpoint: undefined });
    expect(printChainResultBrief).toHaveBeenCalled();
  });

  it('handles eval mode with --eval flag', async () => {
    const { executeChain } = await import('../src/executor.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [],
      totalDuration: 0,
    });

    await routeCommand(['--eval', 'title']);

    expect(executeChain).toHaveBeenCalledWith('title', { cdpEndpoint: undefined });
  });

  it('handles multiple -e flags', async () => {
    const { executeChain } = await import('../src/executor.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [],
      totalDuration: 0,
    });

    await routeCommand(['-e', 'goto https://example.com', '-e', 'title']);

    expect(executeChain).toHaveBeenCalledWith('goto https://example.com && title', { cdpEndpoint: undefined });
  });

  it('exits with code 1 when eval chain fails', async () => {
    const { executeChain } = await import('../src/executor.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: false,
      steps: [],
      totalDuration: 0,
    });

    const exit = mockExit();
    try {
      await routeCommand(['-e', 'bad']);
    } catch (e) {
      expect(String(e)).toContain('exit:1');
    }
    exit.restore();
  });

  it('handles -e flag without argument', async () => {
    const origError = console.error;
    const errors: string[] = [];
    console.error = (...args: unknown[]) => errors.push(args.join(' '));

    const exit = mockExit();
    try {
      await routeCommand(['-e']);
    } catch (e) {
      expect(String(e)).toContain('exit:1');
    }
    exit.restore();
    console.error = origError;
    expect(errors[0]).toContain('-e/--eval requires a command argument');
  });

  it('handles unknown command via handleBrowserCommand', async () => {
    const { handleBrowserCommand } = await import('../src/cli/index.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(false);

    await routeCommand(['screenshot']);
    expect(handleBrowserCommand).toHaveBeenCalledWith(
      'screenshot',
      [],
      expect.any(Object),
      'default',
      'text',
      undefined
    );
  });

  it('handles unknown command with arguments', async () => {
    const { handleBrowserCommand } = await import('../src/cli/index.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(false);

    await routeCommand(['goto', 'https://example.com']);
    expect(handleBrowserCommand).toHaveBeenCalledWith(
      'goto',
      ['https://example.com'],
      expect.any(Object),
      'default',
      'text',
      undefined
    );
  });

  it('handles default chain input in switch default', async () => {
    const { executeChain } = await import('../src/executor.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(true);
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [
        { command: 'goto', raw: 'goto url', success: true, data: null, duration: 0 },
      ],
      totalDuration: 0,
    });

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    await routeCommand(['someplugin', 'cmd1', '&&', 'cmd2']);

    console.log = origLog;
    expect(executeChain).toHaveBeenCalled();
    expect(logs.some((l) => l.includes('[OK]'))).toBe(true);
  });

  it('exits with code 1 when default chain fails', async () => {
    const { executeChain } = await import('../src/executor.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(true);
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: false,
      steps: [
        { command: 'bad', raw: 'bad', success: false, data: null, message: 'fail', duration: 0 },
      ],
      totalDuration: 0,
    });

    const origError = console.error;
    console.error = vi.fn();
    const exit = mockExit();
    try {
      await routeCommand(['bad', '&&', 'cmd']);
    } catch (e) {
      expect(String(e)).toContain('exit:1');
    }
    exit.restore();
    console.error = origError;
  });

  it('catches and outputs errors from handlers', async () => {
    const { handleSession } = await import('../src/cli/index.js');
    const { outputError } = await import('../src/cli/output.js');
    vi.mocked(handleSession).mockRejectedValueOnce(new Error('boom'));

    await routeCommand(['session', 'list']);

    expect(outputError).toHaveBeenCalledWith('boom');
  });

  it('catches and outputs non-Error thrown values', async () => {
    const { handleSession } = await import('../src/cli/index.js');
    const { outputError } = await import('../src/cli/output.js');
    vi.mocked(handleSession).mockRejectedValueOnce('string error');

    await routeCommand(['session', 'list']);

    expect(outputError).toHaveBeenCalledWith('string error');
  });

  it('uses json mode with --json flag for session command', async () => {
    const { handleSession } = await import('../src/cli/index.js');
    await routeCommand(['session', 'list', '--json']);
    expect(handleSession).toHaveBeenCalledWith(
      ['list'],
      expect.objectContaining({ json: true }),
      'json',
      undefined
    );
  });

  it('uses yaml mode with --yaml flag for session command', async () => {
    const { handleSession } = await import('../src/cli/index.js');
    await routeCommand(['session', 'list', '--yaml']);
    expect(handleSession).toHaveBeenCalledWith(
      ['list'],
      expect.objectContaining({ yaml: true }),
      'yaml',
      undefined
    );
  });

  it('passes --cdp option as cdpEndpoint', async () => {
    const { handleSession } = await import('../src/cli/index.js');
    await routeCommand(['--cdp', 'ws://localhost:9222', 'session', 'list']);
    expect(handleSession).toHaveBeenCalledWith(
      ['list'],
      expect.any(Object),
      'text',
      'ws://localhost:9222'
    );
  });

  it('routes config subcommand when builtin exists', async () => {
    const { allBuiltins } = await import('../src/builtins/index.js');
    const mockExecute = vi.fn();
    const configBuiltin = { name: 'config', execute: mockExecute };
    vi.mocked(allBuiltins).length = 0;
    vi.mocked(allBuiltins).push(configBuiltin as never);

    await routeCommand(['config', 'set', 'key', 'value']);
    expect(mockExecute).toHaveBeenCalledWith(
      ['set', 'key', 'value'],
      expect.any(Object),
      expect.objectContaining({ cwd: expect.any(String) })
    );
  });

  it('skips config when builtin not found', async () => {
    const { allBuiltins } = await import('../src/builtins/index.js');
    vi.mocked(allBuiltins).length = 0;
    await routeCommand(['config', 'set', 'key', 'value']);
  });

  it('handles --help with site command showing site help text', async () => {
    const mockSite = {
      url: 'https://example.com',
      name: 'testsite',
      config: { description: 'Test site' },
      getAllCommands: () => [
        { name: 'cmd1', description: 'desc1', scope: 'read' },
      ],
    };

    vi.resetModules();
    vi.doMock('../src/plugin/loader.js', () => {
      const mockLoader = {
        getCore: () => ({
          loader: {
            getSite: vi.fn(() => mockSite),
          },
        }),
        scanAndLoad: vi.fn(),
      };
      return {
        XBrowserPluginLoader: vi.fn(() => mockLoader),
      };
    });

    const mod = await import('../src/router.js');
    routeCommand = mod.routeCommand;

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    await routeCommand(['somesite', '--help']);

    console.log = origLog;
    expect(logs.some((l) => l.includes('Test site'))).toBe(true);
  });

  it('handles --help with unknown site falling back to showMainHelp', async () => {
    vi.resetModules();
    vi.doMock('../src/plugin/loader.js', () => {
      const mockLoader = {
        getCore: () => ({
          loader: {
            getSite: vi.fn(() => null),
          },
        }),
        scanAndLoad: vi.fn(),
      };
      return {
        XBrowserPluginLoader: vi.fn(() => mockLoader),
      };
    });

    const mod = await import('../src/router.js');
    routeCommand = mod.routeCommand;

    const { showMainHelp } = await import('../src/cli/help.js');
    await routeCommand(['unknownsite', '--help']);
    expect(showMainHelp).toHaveBeenCalled();
  });

  it('handles --help with json mode for site help', async () => {
    const mockSite = {
      url: 'https://example.com',
      name: 'testsite',
      config: { description: 'Test site' },
      getAllCommands: () => [
        { name: 'cmd1', description: 'desc1', scope: 'read' },
      ],
    };

    vi.resetModules();
    vi.doMock('../src/plugin/loader.js', () => {
      const mockLoader = {
        getCore: () => ({
          loader: {
            getSite: vi.fn(() => mockSite),
          },
        }),
        scanAndLoad: vi.fn(),
      };
      return {
        XBrowserPluginLoader: vi.fn(() => mockLoader),
      };
    });

    const mod = await import('../src/router.js');
    routeCommand = mod.routeCommand;

    const { outputResult } = await import('../src/cli/output.js');
    await routeCommand(['somesite', '--json', '--help']);
    expect(outputResult).toHaveBeenCalledWith(
      expect.objectContaining({
        site: 'somesite',
        commands: expect.any(Array),
      }),
      'json'
    );
  });

  it('handles stdin mode taking priority over other modes', async () => {
    const { executeChain } = await import('../src/executor.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [],
      totalDuration: 0,
    });

    await routeCommand(['session', 'list'], ['goto https://example.com']);

    expect(executeChain).toHaveBeenCalledWith('goto https://example.com', { fileMode: true, cdpEndpoint: undefined });
  });

  it('handles eval mode taking priority over normal routing', async () => {
    const { executeChain } = await import('../src/executor.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [],
      totalDuration: 0,
    });

    await routeCommand(['-e', 'title', 'session', 'list']);

    expect(executeChain).toHaveBeenCalledWith('title', { cdpEndpoint: undefined });
  });

  it('routes preview subcommand to builtin', async () => {
    const { allBuiltins } = await import('../src/builtins/index.js');
    const mockExecute = vi.fn();
    const previewBuiltin = { name: 'preview', execute: mockExecute };
    vi.mocked(allBuiltins).length = 0;
    vi.mocked(allBuiltins).push(previewBuiltin as never);

    await routeCommand(['preview', 'test.html']);
    expect(mockExecute).toHaveBeenCalled();
  });

  it('skips preview when builtin not found', async () => {
    const { allBuiltins } = await import('../src/builtins/index.js');
    vi.mocked(allBuiltins).length = 0;
    await routeCommand(['preview', 'test.html']);
  });

  it('handles --h short flag as help via no-args path', async () => {
    const { showMainHelp } = await import('../src/cli/help.js');
    const exit = mockExit();

    try {
      await routeCommand(['-h']);
    } catch (e) {
      expect(String(e)).toContain('exit:0');
    }
    exit.restore();
  });

  it('handles chain failure with error message in steps', async () => {
    const { executeChain } = await import('../src/executor.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(true);
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: false,
      steps: [
        { command: 'bad', raw: 'bad', success: false, data: null, message: 'test error msg', duration: 0 },
      ],
      totalDuration: 0,
    });

    const origError = console.error;
    console.error = vi.fn();
    const exit = mockExit();
    try {
      await routeCommand(['bad', '&&', 'cmd']);
    } catch (e) {
      expect(String(e)).toContain('exit:1');
    }
    exit.restore();
    console.error = origError;
  });

  it('handles stdin with empty commands array (no stdin)', async () => {
    const { handleSession } = await import('../src/cli/index.js');
    await routeCommand(['session', 'list'], []);
    expect(handleSession).toHaveBeenCalled();
  });

  it('routes preview with empty builtins (no-op)', async () => {
    const { allBuiltins } = await import('../src/builtins/index.js');
    vi.mocked(allBuiltins).length = 0;
    await routeCommand(['preview']);
  });
});
