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
}));

vi.mock('../src/cli/output.js', () => ({
  outputError: vi.fn(),
}));

vi.mock('../src/plugin/loader.js', () => {
  const mockLoader = {
    getCore: () => ({
      loader: {
        getSite: () => null,
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
    const origExit = process.exit;
    process.exit = ((code: number) => {
      throw new Error(`exit:${code}`);
    }) as never;

    try {
      await routeCommand(['--version']);
    } catch (e) {
      expect(String(e)).toContain('exit:0');
    }
    console.log = origLog;
    process.exit = origExit;
    expect(logs[0]).toContain('xbrowser v');
  });

  it('shows help with --help flag', async () => {
    const { showMainHelp } = await import('../src/cli/help.js');
    const origExit = process.exit;
    process.exit = ((code: number) => {
      throw new Error(`exit:${code}`);
    }) as never;

    try {
      await routeCommand(['--help']);
    } catch (e) {
      expect(String(e)).toContain('exit:0');
    }
    process.exit = origExit;
    expect(showMainHelp).toHaveBeenCalled();
  });

  it('shows help when no args', async () => {
    const { showMainHelp } = await import('../src/cli/help.js');
    const origExit = process.exit;
    process.exit = ((code: number) => {
      throw new Error(`exit:${code}`);
    }) as never;

    try {
      await routeCommand([]);
    } catch (e) {
      expect(String(e)).toContain('exit:0');
    }
    process.exit = origExit;
    expect(showMainHelp).toHaveBeenCalled();
  });

  it('routes session list to handleSession', async () => {
    const { handleSession } = await import('../src/cli/index.js');
    await routeCommand(['session', 'list']);
    expect(handleSession).toHaveBeenCalledWith(
      ['list'],
      expect.any(Object),
      'text',
      undefined
    );
  });

  it('detects chain input', async () => {
    const { executeChain } = await import('../src/executor.js');
    const { isChainInput } = await import('../src/executor.js');
    vi.mocked(isChainInput).mockReturnValue(true);
    vi.mocked(executeChain).mockResolvedValueOnce({
      success: true,
      steps: [{ command: 'title', raw: 'title', success: true, data: null, duration: 0 }],
      totalDuration: 0,
    });

    const origExit = process.exit;
    process.exit = (() => {}) as never;
    await routeCommand(['goto https://example.com , title']);
    process.exit = origExit;

    expect(executeChain).toHaveBeenCalled();
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
      'text'
    );
  });
});
