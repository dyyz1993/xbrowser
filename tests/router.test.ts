      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 闭包/副作用依赖，删除已实证破坏测试
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  registerCommandDefinition: vi.fn(),
  outputFormatter: vi.fn(),
  isCommandResult: vi.fn(),
  // xcli-core 导出的是实例（helpGenerator.generate(...)），不是工厂
  helpGenerator: { generate: vi.fn() },
}));

vi.mock('../src/client/daemon-client.js', () => ({
  forwardExec: vi.fn().mockResolvedValue(null),
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
}));

vi.mock('../src/cli/output.js', () => ({
  outputEnvelope: vi.fn(),
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
    // 别名兜底（router 目录名→site 名）；getSite 恒 null → 恒 undefined 透传
    resolveSiteName: vi.fn(() => undefined),
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

      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 闭包/副作用依赖，删除已实证破坏测试
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
      await routeCommand(['--version']);
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
    expect(handleFilter).toHaveBeenCalledWith(['data.json'], 'text', expect.any(Object));
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

    expect(executeChain).toHaveBeenCalledWith('goto https://example.com && title', {
      cdpEndpoint: undefined,
      sessionName: 'default',
      frame: undefined,
    });
  });

  it('outputs error when chain fails in single arg mode', async () => {
    const { executeChain } = await import('../src/executor.js');
    const { isChainInput } = await import('../src/executor.js');
    const { outputError } = await import('../src/cli/output.js');
    vi.mocked(isChainInput).mockReturnValue(true);
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: false,
      steps: [],
      totalDuration: 0,
    });

    await routeCommand(['goto bad && title']);
    expect(outputError).toHaveBeenCalledWith('Command failed');
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

	    expect(executeChain).toHaveBeenCalledWith('goto https://example.com ; title', { fileMode: true, cdpEndpoint: undefined, sessionName: 'default' });
    expect(printChainResult).toHaveBeenCalled();
  });

  it('outputs error when stdin chain fails', async () => {
    const { executeChain } = await import('../src/executor.js');
    const { outputError } = await import('../src/cli/output.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: false,
      steps: [],
      totalDuration: 0,
    });

    await routeCommand([], ['bad-command']);
    expect(outputError).toHaveBeenCalledWith('Command failed');
  });

  it('handles eval mode with -e flag', async () => {
    const { executeChain } = await import('../src/executor.js');
    const { printChainResult } = await import('../src/cli/chain-output.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [],
      totalDuration: 0,
    });

    await routeCommand(['-e', 'title']);

    // Docs (README/help "Eval Flag") promise -e values are COMMANDS: a value
    // whose first word is a registered command goes into the chain verbatim
    // (2026-09-12-4 fix), not base64-wrapped as eval JS.
    expect(executeChain).toHaveBeenCalledWith('title', { cdpEndpoint: undefined, sessionName: 'default' });
    expect(printChainResult).toHaveBeenCalled();
  });

  it('handles eval mode with --eval flag', async () => {
    const { executeChain } = await import('../src/executor.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [],
      totalDuration: 0,
    });

    await routeCommand(['--eval', 'title']);

    expect(executeChain).toHaveBeenCalledWith('title', { cdpEndpoint: undefined, sessionName: 'default' });
  });

  it('handles multiple -e flags', async () => {
    const { executeChain } = await import('../src/executor.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [],
      totalDuration: 0,
    });

    await routeCommand(['-e', 'goto https://example.com', '-e', 'title']);

    expect(executeChain).toHaveBeenCalledWith('goto https://example.com ; title', { cdpEndpoint: undefined, sessionName: 'default' });
  });

  it('wraps non-command -e values as eval JS scripts', async () => {
    const { executeChain } = await import('../src/executor.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [],
      totalDuration: 0,
    });

    await routeCommand(['-e', '1+1', '-e', 'document.title']);

    const b1 = Buffer.from('1+1', 'utf8').toString('base64url');
    const b2 = Buffer.from('document.title', 'utf8').toString('base64url');
    expect(executeChain).toHaveBeenCalledWith(`eval --script-b64 ${b1} ; eval --script-b64 ${b2}`, { cdpEndpoint: undefined, sessionName: 'default' });
  });

  it('preserves in-chain --output when reassembling chain input (2026-09-12-8)', async () => {
    const { executeChain, isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockImplementation((input: string) => /\s&&\s|\s;\s|\s,\s|\s\+\s|\s->\s/.test(input));
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [],
      totalDuration: 0,
    });

    // Quoted chain with an in-chain screenshot --output: the flag and its
    // value must survive chain reassembly (they were stripped as "global
    // flags", silently rerouting the screenshot to the temp dir).
    await routeCommand(['--session', 't1', 'refresh && screenshot --output /tmp/must-exist.png']);

    expect(executeChain).toHaveBeenCalledWith(
      'refresh && screenshot --output /tmp/must-exist.png',
      { cdpEndpoint: undefined, sessionName: 't1' },
    );
  });

  it('outputs error when eval chain fails', async () => {
    const { executeChain } = await import('../src/executor.js');
    const { outputError } = await import('../src/cli/output.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: false,
      steps: [],
      totalDuration: 0,
    });

    await routeCommand(['-e', 'bad']);
    expect(outputError).toHaveBeenCalledWith('Command failed');
  });

  it('handles -e flag without argument', async () => {
    const origError = console.error;
    const errors: string[] = [];
    console.error = (...args: unknown[]) => errors.push(args.join(' '));

    await routeCommand(['-e']);

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

  it('passes explicit --session to browser commands', async () => {
    const { handleBrowserCommand } = await import('../src/cli/index.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(false);

    await routeCommand(['--session', 'agent-task', 'snapshot']);
    expect(handleBrowserCommand).toHaveBeenCalledWith(
      'snapshot',
      [],
      expect.any(Object),
      'agent-task',
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
        resolveSiteName: vi.fn((n: string) => n),
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
        resolveSiteName: vi.fn((n: string) => n),
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
        resolveSiteName: vi.fn((n: string) => n),
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

	    expect(executeChain).toHaveBeenCalledWith('goto https://example.com', { fileMode: true, cdpEndpoint: undefined, sessionName: 'default' });
  });

  it('handles eval mode taking priority over normal routing', async () => {
    const { executeChain } = await import('../src/executor.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [],
      totalDuration: 0,
    });

    await routeCommand(['-e', 'title', 'session', 'list']);

    // Eval mode wins over normal routing; `title` is a registered command so
    // it goes into the chain verbatim (2026-09-12-4 fix).
    expect(executeChain).toHaveBeenCalledWith('title', { cdpEndpoint: undefined, sessionName: 'default' });
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 闭包/副作用依赖，删除已实证破坏测试
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

  it('should use XBROWSER_SESSION env var as default session name when --session not provided', async () => {
    vi.resetModules();
    vi.doMock('../src/plugin/loader.js', () => {
      const mockLoader = {
        getCore: () => ({
          loader: { getSite: vi.fn(() => null) },
        }),
        scanAndLoad: vi.fn(),
        resolveSiteName: vi.fn((n: string) => n),
      };
      return { XBrowserPluginLoader: vi.fn(() => mockLoader) };
    });
    const mod = await import('../src/router.js');
    const { handleBrowserCommand } = await import('../src/cli/index.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(false);
    process.env.XBROWSER_SESSION = 'env-session';
    try {
      await mod.routeCommand(['screenshot']);
      expect(handleBrowserCommand).toHaveBeenCalledWith(
        'screenshot',
        [],
        expect.any(Object),
        'env-session',
        'text',
        undefined
      );
    } finally {
      delete process.env.XBROWSER_SESSION;
    }
  });

  it('should prefer --session flag over XBROWSER_SESSION env var', async () => {
    vi.resetModules();
    vi.doMock('../src/plugin/loader.js', () => {
      const mockLoader = {
        getCore: () => ({
          loader: { getSite: vi.fn(() => null) },
        }),
        scanAndLoad: vi.fn(),
        resolveSiteName: vi.fn((n: string) => n),
      };
      return { XBrowserPluginLoader: vi.fn(() => mockLoader) };
    });
    const mod = await import('../src/router.js');
    const { handleBrowserCommand } = await import('../src/cli/index.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(false);
    process.env.XBROWSER_SESSION = 'env-session';
    try {
      await mod.routeCommand(['--session', 'flag-session', 'screenshot']);
      expect(handleBrowserCommand).toHaveBeenCalledWith(
        'screenshot',
        [],
        expect.any(Object),
        'flag-session',
        'text',
        undefined
      );
    } finally {
      delete process.env.XBROWSER_SESSION;
    }
  });

  it('should use default when neither --session nor XBROWSER_SESSION is set', async () => {
    vi.resetModules();
    vi.doMock('../src/plugin/loader.js', () => {
      const mockLoader = {
        getCore: () => ({
          loader: { getSite: vi.fn(() => null) },
        }),
        scanAndLoad: vi.fn(),
        resolveSiteName: vi.fn((n: string) => n),
      };
      return { XBrowserPluginLoader: vi.fn(() => mockLoader) };
    });
    const mod = await import('../src/router.js');
    const { handleBrowserCommand } = await import('../src/cli/index.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(false);
    delete process.env.XBROWSER_SESSION;
    await mod.routeCommand(['screenshot']);
    expect(handleBrowserCommand).toHaveBeenCalledWith(
      'screenshot',
      [],
      expect.any(Object),
      'default',
      'text',
      undefined
    );
  });

  it('should use XBROWSER_CDP env var as default cdp endpoint when --cdp not provided', async () => {
    vi.resetModules();
    vi.doMock('../src/plugin/loader.js', () => {
      const mockLoader = {
        getCore: () => ({
          loader: { getSite: vi.fn(() => null) },
        }),
        scanAndLoad: vi.fn(),
        resolveSiteName: vi.fn((n: string) => n),
      };
      return { XBrowserPluginLoader: vi.fn(() => mockLoader) };
    });
    const mod = await import('../src/router.js');
    const { handleBrowserCommand } = await import('../src/cli/index.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(false);
    process.env.XBROWSER_CDP = 'http://localhost:9221';
    try {
      await mod.routeCommand(['screenshot']);
      expect(handleBrowserCommand).toHaveBeenCalledWith(
        'screenshot',
        [],
        expect.any(Object),
        'default',
        'text',
        'http://localhost:9221'
      );
    } finally {
      delete process.env.XBROWSER_CDP;
    }
  });

  it('should prefer --cdp flag over XBROWSER_CDP env var', async () => {
    vi.resetModules();
    vi.doMock('../src/plugin/loader.js', () => {
      const mockLoader = {
        getCore: () => ({
          loader: { getSite: vi.fn(() => null) },
        }),
        scanAndLoad: vi.fn(),
        resolveSiteName: vi.fn((n: string) => n),
      };
      return { XBrowserPluginLoader: vi.fn(() => mockLoader) };
    });
    const mod = await import('../src/router.js');
    const { handleBrowserCommand } = await import('../src/cli/index.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(false);
    process.env.XBROWSER_CDP = 'http://localhost:9221';
    try {
      await mod.routeCommand(['--cdp', 'ws://localhost:9222', 'screenshot']);
      expect(handleBrowserCommand).toHaveBeenCalledWith(
        'screenshot',
        [],
        expect.any(Object),
        'default',
        'text',
        'ws://localhost:9222'
      );
    } finally {
      delete process.env.XBROWSER_CDP;
    }
  });
  // ── Defense (2026-08-15 real-sites smoke): fill 值含空格不得被拆分 ──
  // 攻击复现：fill "#kw" "a b c" 曾被 quoted-arg 启发式误拆成 ['a','b','c']，
  // fill 实际只写入 'a'。防守：命令串启发式仅作用于首个非旗标参数。
  it('keeps fill value with spaces as a single argument', async () => {
    const { handleBrowserCommand } = await import('../src/cli/index.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(false);

    await routeCommand(['fill', '#kw', 'a b c']);
    expect(handleBrowserCommand).toHaveBeenCalledWith(
      'fill',
      ['#kw', 'a b c'],
      expect.any(Object),
      'default',
      'text',
      undefined
    );
  });

  it('still expands single command-string form (xbrowser "goto url")', async () => {
    const { handleBrowserCommand } = await import('../src/cli/index.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(false);

    await routeCommand(['goto https://example.com/page']);
    expect(handleBrowserCommand).toHaveBeenCalledWith(
      'goto',
      ['https://example.com/page'],
      expect.any(Object),
      'default',
      'text',
      undefined
    );
  });

  it('keeps eval script with spaces intact after command word', async () => {
    // `eval <script>` is intercepted before chain parsing and routed
    // base64url-encoded, so ';' and newlines inside the script survive.
    // (daemon forwardExec is mocked to null → local chain path is asserted.)
    const { executeChain } = await import('../src/executor.js');
    const { handleBrowserCommand } = await import('../src/cli/index.js');
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [],
      totalDuration: 0,
    });

    await routeCommand(['eval', 'JSON.stringify({a: 1, b: 2})']);

    const b64 = Buffer.from('JSON.stringify({a: 1, b: 2})', 'utf8').toString('base64url');
    expect(executeChain).toHaveBeenCalledWith(`eval --script-b64 ${b64}`, { cdpEndpoint: undefined, sessionName: 'default' });
    expect(handleBrowserCommand).not.toHaveBeenCalled();
  });

  // ── 回归（2026-11-23）：引号命令链 + 其它 flag，`;` 链被拆没 ──
  // 攻击复现：`xbrowser "goto A; goto B" --session s` 进 argv 拆分块后，`;` 被
  // flatMap(part => part.split(';')) 删光——重写后的 argv 不含链运算符，只有第一个
  // goto 静默执行（输出还是单命令格式）。
  // 防守：首个非 flag 参数 isChainInput() 为真时原样交给链执行器，与单 argv 形态同语义。
  describe('quoted chain string combined with other flags', () => {
    const STEP_A = 'goto https://example.com/';
    const STEP_B = 'goto https://example.com/?a=1';
    // 与 src/executor.ts isChainInput 的正则一致——文件顶部默认 mock 缺 `;\s` / `||\s`，
    // 识别不了 "goto A; goto B"。
    const isChainLikeProduction = (input: string): boolean =>
      /\s&&\s|\|\|\s|\s;\s|;\s|\s,\s|\s\+\s|\s->\s/.test(input);

    /** 链执行器收到的输入，经生产链解析器拆成步骤（断言"跑了几步"，不依赖 mock 返回值） */
    async function chainStepsSeen(): Promise<string[][]> {
      const { executeChain } = await import('../src/executor.js');
      const { parseCommandChain } = await import('../src/chain-parser.js');
      return vi.mocked(executeChain).mock.calls.flatMap(([input]) =>
        parseCommandChain(input).map((pipeline) => pipeline.pipeline));
    }

    beforeEach(async () => {
      const { executeChain, isChainInput } = await import('../src/executor.js');
      vi.mocked(isChainInput).mockImplementation(isChainLikeProduction);
      vi.mocked(executeChain).mockResolvedValue({ success: true, steps: [], totalDuration: 0 });
    });

    it.each([
      ['; glued to the previous step', `${STEP_A}; ${STEP_B}`],
      ['; with a space on each side', `${STEP_A} ; ${STEP_B}`],
    ])('executes both steps of a quoted chain (%s) when --session is given', async (_spacing, chain) => {
      const { handleBrowserCommand } = await import('../src/cli/index.js');

      await routeCommand([chain, '--session', 's']);

      expect(await chainStepsSeen()).toEqual([[STEP_A], [STEP_B]]);
      expect(handleBrowserCommand).not.toHaveBeenCalled();
    });

    it('routes a quoted "&&" chain with --session through the chain executor', async () => {
      const { executeChain } = await import('../src/executor.js');
      const { handleBrowserCommand } = await import('../src/cli/index.js');

      await routeCommand([`${STEP_A} && title`, '--session', 's']);

      expect(await chainStepsSeen()).toEqual([[STEP_A, 'title']]);
      expect(executeChain).toHaveBeenCalledWith(`${STEP_A} && title`, {
        cdpEndpoint: undefined,
        sessionName: 's',
        frame: undefined,
      });
      expect(handleBrowserCommand).not.toHaveBeenCalled();
    });

    it.each([
      ['--json before the chain', ['--json', `${STEP_A}; ${STEP_B}`], 'json'],
      ['--json before --session', ['--json', '--session', 's', `${STEP_A}; ${STEP_B}`], 'json'],
      ['--json after the chain', [`${STEP_A}; ${STEP_B}`, '--json'], 'json'],
      ['--json after --session', ['--session', 's', '--json', `${STEP_A}; ${STEP_B}`], 'json'],
      ['--yaml after --session', ['--session', 's', '--yaml', `${STEP_A}; ${STEP_B}`], 'yaml'],
    ])('routes a quoted ";" chain to the chain executor with %s', async (_label, argv, outputMode) => {
      const { outputEnvelope } = await import('../src/cli/output.js');
      const { printChainResult } = await import('../src/cli/chain-output.js');
      const { handleBrowserCommand } = await import('../src/cli/index.js');

      await routeCommand(argv);

      expect(await chainStepsSeen()).toEqual([[STEP_A], [STEP_B]]);
      expect(outputEnvelope).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
        expect.objectContaining({ command: 'chain' }),
        outputMode,
      );
      expect(printChainResult).not.toHaveBeenCalled();
      expect(handleBrowserCommand).not.toHaveBeenCalled();
    });

    it('passes --cdp / --session / --frame given around the chain to the chain executor', async () => {
      const { executeChain } = await import('../src/executor.js');
      const chain = `${STEP_A}; ${STEP_B}`;

      await routeCommand(['--cdp', '9222', chain, '--session', 's', '--frame', 'captcha.gtimg.com']);

      expect(await chainStepsSeen()).toEqual([[STEP_A], [STEP_B]]);
      expect(executeChain).toHaveBeenCalledWith(chain, {
        cdpEndpoint: '9222',
        sessionName: 's',
        frame: 'captcha.gtimg.com',
      });
    });

    // ── 不得回归（2026-08-15 real-sites smoke 防线等）──
    it('keeps a space-containing VALUE after the command word intact', async () => {
      const { handleBrowserCommand } = await import('../src/cli/index.js');

      await routeCommand(['fill', '#kw', 'a b c', '--session', 's']);

      expect(handleBrowserCommand).toHaveBeenCalledWith(
        'fill',
        ['#kw', 'a b c'],
        expect.any(Object),
        's',
        'text',
        undefined
      );
    });

    it('still expands a single quoted command given with --session', async () => {
      const { executeChain } = await import('../src/executor.js');
      const { handleBrowserCommand } = await import('../src/cli/index.js');

      await routeCommand(["click '#btn'", '--session', 's']);

      expect(executeChain).not.toHaveBeenCalled();
      expect(handleBrowserCommand).toHaveBeenCalledWith(
        'click',
        ["'#btn'"],
        expect.any(Object),
        's',
        'text',
        undefined
      );
    });

    // 布尔 flag（--json/--help/…）不带值：紧跟其后的引号命令不是 flag 值。
    it('still expands a single quoted command that follows a boolean flag', async () => {
      const { executeChain } = await import('../src/executor.js');
      const { handleBrowserCommand } = await import('../src/cli/index.js');

      await routeCommand(['--session', 's', '--json', 'goto https://example.com']);

      expect(executeChain).not.toHaveBeenCalled();
      expect(handleBrowserCommand).toHaveBeenCalledWith(
        'goto',
        ['https://example.com'],
        expect.objectContaining({ json: true, session: 's' }),
        's',
        'json',
        undefined
      );
    });

    it('keeps plugin steps and their in-chain flags intact when routing with --session', async () => {
      const { executeChain } = await import('../src/executor.js');
      const { handleBrowserCommand } = await import('../src/cli/index.js');
      const chain = "set-viewport 1200 630 && content cover --title 'Self-Healing Replay' --output cover.png";

      await routeCommand([chain, '--session', 's']);

      expect(await chainStepsSeen()).toEqual([
        ['set-viewport 1200 630', "content cover --title 'Self-Healing Replay' --output cover.png"],
      ]);
      expect(executeChain).toHaveBeenCalledWith(chain, { cdpEndpoint: undefined, sessionName: 's', frame: undefined });
      expect(handleBrowserCommand).not.toHaveBeenCalled();
    });

    it('leaves a separator with a space on the left only on the single-command path, like the single-argv form', async () => {
      const { executeChain } = await import('../src/executor.js');
      const { handleBrowserCommand } = await import('../src/cli/index.js');
      const notAChain = `${STEP_A} ;${STEP_B}`;

      await routeCommand([notAChain]); // 单 argv 形态
      await routeCommand([notAChain, '--session', 's']); // 带 flag 形态必须给出相同结果

      expect(executeChain).not.toHaveBeenCalled();
      expect(vi.mocked(handleBrowserCommand).mock.calls[1].slice(0, 2))
        .toEqual(vi.mocked(handleBrowserCommand).mock.calls[0].slice(0, 2));
    });
  });

  // ── 回归（2026-11-23）：`xbrowser eval --help` 把 help 当脚本执行 ──
  // 攻击复现：eval 脚本形态在 help 检查之前拦截，`--help` 被拼进脚本发给页面
  // （ReferenceError: help is not defined，还会写 session 归档 / 错题本）。
  // 防守：eval 之后的参数里有独立的 `--help` / `-h` token 时按普通命令走 help 路径。
  describe('eval help request', () => {
    const HELP_TEXT = '<generated help>';

    async function expectNothingExecuted(): Promise<void> {
      const { executeChain } = await import('../src/executor.js');
      const { forwardExec } = await import('../src/client/daemon-client.js');
      const { handleBrowserCommand } = await import('../src/cli/index.js');
      expect(executeChain).not.toHaveBeenCalled();
      expect(forwardExec).not.toHaveBeenCalled();
      expect(handleBrowserCommand).not.toHaveBeenCalled();
    }

    /** 跑一条命令并返回它写到 console.log 的内容 */
    async function routeCapturingLog(argv: string[]): Promise<string[]> {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
      try {
        await routeCommand(argv);
      } finally {
        console.log = origLog;
      }
      return logs;
    }

    beforeEach(async () => {
      const { helpGenerator } = await import('@dyyz1993/xcli-core');
      vi.mocked(helpGenerator.generate).mockReturnValue(HELP_TEXT);
    });

    it.each([
      [['eval', '--help']],
      [['eval', '-h']],
      [['eval', '--help', '--session', 's']],
      [['eval', '-h', '--session', 's']],
      [['--session', 's', 'eval', '--help']],
      [['eval', '--help', '--frame', 'captcha.gtimg.com']],
    ])('prints eval help and executes nothing for %j', async (argv) => {
      const { helpGenerator } = await import('@dyyz1993/xcli-core');

      const logs = await routeCapturingLog(argv);

      await expectNothingExecuted();
      expect(helpGenerator.generate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'eval' }),
        expect.anything(),
      );
      expect(logs).toEqual([HELP_TEXT]);
    });

    it('prints eval help as JSON with --json', async () => {
      const { outputResult } = await import('../src/cli/output.js');

      await routeCommand(['eval', '--json', '--help']);

      await expectNothingExecuted();
      expect(outputResult).toHaveBeenCalledWith(expect.objectContaining({ command: 'eval' }), 'json');
    });

    it('keeps command help for other commands on the same help path', async () => {
      const { helpGenerator } = await import('@dyyz1993/xcli-core');

      const logs = await routeCapturingLog(['goto', '--help']);

      expect(helpGenerator.generate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'goto' }),
        expect.anything(),
      );
      expect(logs).toEqual([HELP_TEXT]);
      await expectNothingExecuted();
    });

    it.each([
      ['help'],
      ['typeof window.help'],
      ['document.querySelector("#help").textContent'],
    ])('still routes eval %j to script mode', async (script) => {
      const { forwardExec } = await import('../src/client/daemon-client.js');
      const { helpGenerator } = await import('@dyyz1993/xcli-core');

      await routeCommand(['eval', script]);

      const b64 = Buffer.from(script, 'utf8').toString('base64url');
      expect(forwardExec).toHaveBeenCalledWith('eval', { 'script-b64': b64 }, 'default', undefined);
      expect(helpGenerator.generate).not.toHaveBeenCalled();
    });

    it('keeps -e flag mode untouched', async () => {
      const { executeChain } = await import('../src/executor.js');
      const { helpGenerator } = await import('@dyyz1993/xcli-core');

      await routeCommand(['-e', 'document.title']);

      const b64 = Buffer.from('document.title', 'utf8').toString('base64url');
      expect(executeChain).toHaveBeenCalledWith(`eval --script-b64 ${b64}`, { cdpEndpoint: undefined, sessionName: 'default' });
      expect(helpGenerator.generate).not.toHaveBeenCalled();
    });
  });
});

