import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod/v4';
import { handlePluginOrChainRoute, type PluginRouteRequest } from '../../src/router/plugin-routing.js';

const {
  mockGetPluginLoader,
  mockExecuteChain,
  mockIsChainInput,
  mockGetPluginStorage,
  mockFindOrRestoreSession,
  mockCreateSession,
  mockSaveSessionDiskMeta,
  mockCheckPluginLoginRequired,
  mockLoadHooks,
  mockAttachDetectAntiBot,
  mockBuildViewerUrl,
  mockOutputEnvelope,
  mockOutputError,
  mockOutputResult,
  mockOutputLoginRequired,
  mockShowCommandHelp,
  mockForwardPluginExec,
  mockCommandHandler,
} = vi.hoisted(() => ({
  mockGetPluginLoader: vi.fn(),
  mockExecuteChain: vi.fn(),
  mockIsChainInput: vi.fn(),
  mockGetPluginStorage: vi.fn(),
  mockFindOrRestoreSession: vi.fn(),
  mockCreateSession: vi.fn(),
  mockSaveSessionDiskMeta: vi.fn(),
  mockCheckPluginLoginRequired: vi.fn(),
  mockLoadHooks: vi.fn(),
  mockAttachDetectAntiBot: vi.fn(),
  mockBuildViewerUrl: vi.fn(),
  mockOutputEnvelope: vi.fn(),
  mockOutputError: vi.fn(),
  mockOutputResult: vi.fn(),
  mockOutputLoginRequired: vi.fn(),
  mockShowCommandHelp: vi.fn(),
  mockForwardPluginExec: vi.fn(),
  mockCommandHandler: vi.fn(),
}));

vi.mock('../../src/executor.js', () => ({
  executeChain: mockExecuteChain,
  isChainInput: mockIsChainInput,
  getPluginStorage: mockGetPluginStorage,
}));

vi.mock('../../src/utils/plugin-singleton.js', () => ({
  getPluginLoader: mockGetPluginLoader,
}));

// 路由按「命令名是否已注册」决定 token 里的分隔符是值还是链（见下方链重组用例）
vi.mock('../../src/commands/command-registry.js', () => {
  const registered = new Set(['fill', 'type', 'goto', 'title', 'url', 'mouse', 'eval']);
  return { getCommand: (name: string) => (registered.has(name) ? { name } : undefined) };
});

vi.mock('../../src/plugin/login-guard.js', () => ({
  checkPluginLoginRequired: mockCheckPluginLoginRequired,
}));

vi.mock('../../src/browser.js', () => ({
  findOrRestoreSession: mockFindOrRestoreSession,
  createSession: mockCreateSession,
  saveSessionDiskMeta: mockSaveSessionDiskMeta,
}));

vi.mock('../../src/utils/viewer-url.js', () => ({
  buildViewerUrl: mockBuildViewerUrl,
}));

vi.mock('../../src/context.js', () => ({
  attachDetectAntiBot: mockAttachDetectAntiBot,
}));

vi.mock('../../src/hooks/loader.js', () => ({
  loadHooks: mockLoadHooks,
}));

vi.mock('../../src/cli/output.js', () => ({
  outputEnvelope: mockOutputEnvelope,
  outputError: mockOutputError,
  outputResult: mockOutputResult,
}));

vi.mock('../../src/router/help.js', () => ({
  outputLoginRequired: mockOutputLoginRequired,
  showCommandHelp: mockShowCommandHelp,
}));

vi.mock('../../src/client/daemon-client.js', () => ({
  forwardPluginExec: mockForwardPluginExec,
}));

interface MockSite {
  name: string;
  config: { name: string; url: string; description: string };
  url: string;
  getAllCommands: () => Array<{ name: string }>;
  getCommand: (name: string) => {
    name: string;
    description: string;
    scope: string;
    parameters: z.ZodType;
    handler: (...args: unknown[]) => Promise<unknown>;
  } | undefined;
}

function createMockSite(): MockSite {
  return {
    name: 'mysite',
    config: { name: 'mysite', url: 'https://mysite.example', description: 'mock site' },
    url: 'https://mysite.example',
    getAllCommands: () => [{ name: 'mycmd' }],
    getCommand: (name: string) => name === 'mycmd'
      ? {
          name: 'mycmd',
          description: 'mock command',
          scope: 'page',
          parameters: z.object({ message: z.string().optional() }),
          handler: mockCommandHandler,
        }
      : undefined,
  };
}

function setupLoaderWithSites(sites: MockSite[]): void {
  mockGetPluginLoader.mockResolvedValue({
    resolveSiteName: (name: string) => sites.find((s) => s.name === name)?.name,
    getCore: () => ({
      loader: {
        getSite: (name: string) => sites.find((s) => s.name === name),
      },
    }),
  });
}

function buildRequest(overrides: Partial<PluginRouteRequest> = {}): PluginRouteRequest {
  return {
    command: 'mysite',
    cmdArgs: ['mycmd'],
    argv: ['mysite', 'mycmd'],
    options: {},
    mode: 'text',
    sessionName: 'default',
    chainTokenStart: -1,
    chainTokenEnd: -1,
    ...overrides,
  };
}

interface ChainStepLike {
  raw: string;
  success: boolean;
  data: Record<string, unknown>;
  duration: number;
  tips: Array<string | { level: string; message: string }>;
}

function joinedConsoleOutput(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((c: unknown[]) => c.map((a) => String(a)).join(' ')).join('\n');
}

describe('plugin-routing tips rendering (#439)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsChainInput.mockReturnValue(false);
    mockGetPluginStorage.mockReturnValue({});
    mockAttachDetectAntiBot.mockImplementation(() => {});
    mockBuildViewerUrl.mockReturnValue(undefined);
    mockCheckPluginLoginRequired.mockResolvedValue({ ok: true });
    mockLoadHooks.mockResolvedValue([]);
    mockSaveSessionDiskMeta.mockResolvedValue(undefined);
    mockFindOrRestoreSession.mockResolvedValue({
      id: 'sess-1',
      name: 'default',
      page: { url: () => 'about:blank' },
      context: { browser: () => ({}), pages: () => [] },
      cdpEndpoint: 'http://localhost:9221',
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    delete process.env.XBROWSER_DAEMON_WORKER;
  });

  const MIXED_TIPS: Array<string | { level: string; message: string }> = [
    { level: 'info', message: 'tip-from-tip-object' },
    'tip-from-plain-string',
  ];

  it('renders Tip objects as .message in chain step output (no "[object Object]")', async () => {
    setupLoaderWithSites([]);
    mockIsChainInput.mockReturnValue(true);
    mockExecuteChain.mockResolvedValue({
      success: true,
      totalDuration: 12,
      steps: [{
        raw: 'goto https://a.example',
        success: true,
        data: { url: 'https://a.example' },
        duration: 12,
        tips: MIXED_TIPS,
      }] as ChainStepLike[],
    });

    const handled = await handlePluginOrChainRoute(buildRequest({
      command: 'goto',
      cmdArgs: [],
      argv: ['goto', 'https://a.example', '&&', 'title'],
    }));

    expect(handled).toBe(true);
    const output = joinedConsoleOutput(logSpy);
    expect(output).toContain('tip-from-tip-object');
    expect(output).toContain('tip-from-plain-string');
    expect(output).not.toContain('[object Object]');
    expect(mockExecuteChain).toHaveBeenCalledWith('goto https://a.example && title', { cdpEndpoint: undefined, sessionName: 'default' });
  });

  it('renders Tip objects as .message for daemon-forwarded results in json mode', async () => {
    setupLoaderWithSites([createMockSite()]);
    mockForwardPluginExec.mockResolvedValue({
      success: true,
      data: { echo: 'done' },
      tips: MIXED_TIPS,
      duration: 5,
    });

    // 信封在本文件里是 mock；这里换成真实现，断言的是真正写出的内容
    const actual = await vi.importActual<typeof import('../../src/cli/output.js')>('../../src/cli/output.js');
    mockOutputEnvelope.mockImplementationOnce(actual.outputEnvelope);
    const handled = await handlePluginOrChainRoute(buildRequest({ mode: 'json' }));

    expect(handled).toBe(true);
    // 第 6 个参数是 --bridge 开关（未传 = false）
    expect(mockForwardPluginExec).toHaveBeenCalledWith('mysite.mycmd', {}, 'default', undefined, undefined, false);
    const output = joinedConsoleOutput(errSpy);
    expect(output).toContain('tip-from-tip-object');
    expect(output).toContain('tip-from-plain-string');
    expect(output).not.toContain('[object Object]');
  });

  // 以前转发成功的结果在 --json / --yaml 下直接打印 data，失败时却打印信封
  it('wraps a daemon-forwarded success in the same envelope as a local run (json)', async () => {
    setupLoaderWithSites([createMockSite()]);
    mockForwardPluginExec.mockResolvedValue({ success: true, data: { echo: 'done' }, tips: [], duration: 5 });

    const handled = await handlePluginOrChainRoute(buildRequest({ mode: 'json' }));

    expect(handled).toBe(true);
    expect(mockOutputEnvelope).toHaveBeenCalledWith(
      { success: true, data: { echo: 'done' }, message: undefined, tips: [], duration: 5 },
      { command: 'mysite mycmd' },
      'json',
    );
    expect(joinedConsoleOutput(logSpy)).not.toContain('echo');
  });

  it('reports the round-trip time when the daemon result carries no duration', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    try {
      setupLoaderWithSites([createMockSite()]);
      mockForwardPluginExec.mockImplementation(async () => {
        vi.setSystemTime(1_000_007);
        return { success: true, data: { echo: 'done' }, tips: [] } as never;
      });

      await handlePluginOrChainRoute(buildRequest({ mode: 'json' }));

      expect(mockOutputEnvelope).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, duration: 7 }),
        { command: 'mysite mycmd' },
        'json',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('wraps a daemon-forwarded success in the envelope for yaml too', async () => {
    setupLoaderWithSites([createMockSite()]);
    mockForwardPluginExec.mockResolvedValue({ success: true, data: { echo: 'done' }, tips: [], duration: 5 });

    await handlePluginOrChainRoute(buildRequest({ mode: 'yaml' }));

    expect(mockOutputEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: { echo: 'done' } }),
      { command: 'mysite mycmd' },
      'yaml',
    );
    expect(joinedConsoleOutput(logSpy)).not.toContain('echo');
  });

  it('keeps text output as the bare data for a daemon-forwarded success', async () => {
    setupLoaderWithSites([createMockSite()]);
    mockForwardPluginExec.mockResolvedValue({ success: true, data: { echo: 'done' }, tips: [], duration: 5 });

    await handlePluginOrChainRoute(buildRequest({ mode: 'text' }));

    expect(mockOutputEnvelope).not.toHaveBeenCalled();
    expect(joinedConsoleOutput(logSpy)).toContain('done');
  });

  it('renders Tip objects as .message for daemon-forwarded results in text mode', async () => {
    setupLoaderWithSites([createMockSite()]);
    mockForwardPluginExec.mockResolvedValue({
      success: true,
      data: { echo: 'done' },
      tips: MIXED_TIPS,
      duration: 5,
    });

    const handled = await handlePluginOrChainRoute(buildRequest({ mode: 'text' }));

    expect(handled).toBe(true);
    const output = joinedConsoleOutput(logSpy);
    expect(output).toContain('tip-from-tip-object');
    expect(output).toContain('tip-from-plain-string');
    expect(output).not.toContain('[object Object]');
  });

  it('renders Tip objects as .message for locally-executed command results', async () => {
    process.env.XBROWSER_DAEMON_WORKER = '1';
    setupLoaderWithSites([createMockSite()]);
    mockCommandHandler.mockResolvedValue({
      success: true,
      data: { result: 'ok-data' },
      tips: MIXED_TIPS,
    });

    const handled = await handlePluginOrChainRoute(buildRequest({ mode: 'text' }));

    expect(handled).toBe(true);
    expect(mockCommandHandler).toHaveBeenCalledTimes(1);
    const output = joinedConsoleOutput(logSpy);
    expect(output).toContain('tip-from-tip-object');
    expect(output).toContain('tip-from-plain-string');
    expect(output).not.toContain('[object Object]');
  });

  it('renders plain string tips unchanged (regression guard)', async () => {
    setupLoaderWithSites([createMockSite()]);
    mockForwardPluginExec.mockResolvedValue({
      success: true,
      data: { echo: 'done' },
      tips: ['only-a-string-tip'],
      duration: 5,
    });

    const handled = await handlePluginOrChainRoute(buildRequest({ mode: 'text' }));

    expect(handled).toBe(true);
    const output = joinedConsoleOutput(logSpy);
    expect(output).toContain('only-a-string-tip');
    expect(output).not.toContain('[object Object]');
  });
});

// ── 链重组前的全局 flag 扫描：布尔 flag 不带值 ──
// 曾把任意全局 flag 的下一个 token 当作它的值：`--json someplugin "a && b"` 里的插件名
// 被剥掉，链重组成了 `a && b`。带值 flag 的定义与 router.ts 共用同一份。
describe('plugin-routing global flag scan (#466 sibling)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setupLoaderWithSites([]);
    mockIsChainInput.mockImplementation((input: string) => /\s&&\s/.test(input));
    mockExecuteChain.mockResolvedValue({ success: true, totalDuration: 0, steps: [] });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it.each([
    ['--json before the plugin name', ['--session', 's', '--json', 'someplugin', 'cmd1 && cmd2']],
    ['--yaml before the plugin name', ['--session', 's', '--yaml', 'someplugin', 'cmd1 && cmd2']],
    ['-h before the plugin name', ['--session', 's', '-h', 'someplugin', 'cmd1 && cmd2']],
  ])('keeps the plugin name that follows the boolean flag (%s)', async (_label, argv) => {
    const handled = await handlePluginOrChainRoute(buildRequest({
      command: 'someplugin',
      cmdArgs: ['cmd1 && cmd2'],
      argv,
      sessionName: 's',
    }));

    expect(handled).toBe(true);
    expect(mockExecuteChain).toHaveBeenCalledWith('someplugin cmd1 && cmd2', { cdpEndpoint: undefined, sessionName: 's' });
  });

  it.each([
    ['a value flag', ['--session', 's', '--output', 'out.json', 'someplugin', 'cmd1 && cmd2']],
    ['a short value flag', ['--session', 's', '-o', 'out.json', 'someplugin', 'cmd1 && cmd2']],
  ])('still skips the value of %s', async (_label, argv) => {
    await handlePluginOrChainRoute(buildRequest({
      command: 'someplugin',
      cmdArgs: ['cmd1 && cmd2'],
      argv,
      sessionName: 's',
    }));

    expect(mockExecuteChain).toHaveBeenCalledWith('someplugin cmd1 && cmd2', { cdpEndpoint: undefined, sessionName: 's' });
  });
});

// ── 链重组 ──
// 路由把 argv 重新拼成链字符串再交给链解析器。shell 已经切好词：只有自成一个
// token 的操作符（`goto a '&&' title`）才是链结构，藏在 token 里的 ` + ` / ` ; `
// 是值。所以拼回链字符串时，带空白或操作符的 token 要重新加引号，链解析器才
// 不会把它拆成多条命令（`fill '#q' 'x ; title'` 曾被拆成 `fill #q x` + `title`，
// 退出码 0 而值被截断）。
describe('plugin-routing chain reassembly', () => {
  const productionIsChainInput = (input: string): boolean =>
    /\s&&\s|\|\|\s|\s;\s|;\s|\s,\s|\s\+\s|\s->\s/.test(input);
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setupLoaderWithSites([]);
    mockIsChainInput.mockImplementation(productionIsChainInput);
    mockExecuteChain.mockResolvedValue({ success: true, totalDuration: 0, steps: [] });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('values that contain chain separators', () => {
    it.each(['x ; title', 'a + b', 'a -> b', 'p , q'])(
      'leaves "%s" inside a value token alone for a registered command',
      async (value) => {
        const handled = await handlePluginOrChainRoute(buildRequest({
          command: 'fill',
          cmdArgs: ['#q', value],
          argv: ['fill', '#q', value],
        }));

        expect(handled).toBe(false);
        expect(mockExecuteChain).not.toHaveBeenCalled();
      },
    );

    it.each(['a + b', 'p ; q', 'a -> b', 'it\'s here'])(
      're-quotes "%s" so a token-operator chain keeps it whole',
      async (value) => {
        const handled = await handlePluginOrChainRoute(buildRequest({
          command: 'fill',
          cmdArgs: ['#q', value, '&&', 'title'],
          argv: ['fill', '#q', value, '&&', 'title'],
        }));

        expect(handled).toBe(true);
        expect(mockExecuteChain).toHaveBeenCalledWith(
          `fill #q "${value}" && title`,
          { cdpEndpoint: undefined, sessionName: 'default' },
        );
      },
    );

    it('leaves a plain token and the operator token itself unquoted', async () => {
      await handlePluginOrChainRoute(buildRequest({
        command: 'goto',
        cmdArgs: ['https://a.example', '&&', 'title'],
        argv: ['goto', 'https://a.example', '&&', 'title'],
      }));

      expect(mockExecuteChain).toHaveBeenCalledWith(
        'goto https://a.example && title',
        { cdpEndpoint: undefined, sessionName: 'default' },
      );
    });

    it('treats every token after -- as a literal, operator spellings included', async () => {
      const handled = await handlePluginOrChainRoute(buildRequest({
        command: 'fill',
        cmdArgs: ['#q', '&&'],
        argv: ['fill', '#q', '--', '&&'],
      }));

      expect(handled).toBe(false);
      expect(mockExecuteChain).not.toHaveBeenCalled();
    });

    it('keeps the legacy whole-string check for an unregistered command name', async () => {
      await handlePluginOrChainRoute(buildRequest({
        command: 'someplugin',
        cmdArgs: ['cmd1 && cmd2'],
        argv: ['someplugin', 'cmd1 && cmd2'],
      }));

      expect(mockExecuteChain).toHaveBeenCalledWith(
        'someplugin cmd1 && cmd2',
        { cdpEndpoint: undefined, sessionName: 'default' },
      );
    });

    it('falls back to the plain rejoin for a value no quote can wrap', async () => {
      // 同时含单双引号且引号外有空白：链解析器没有转义，包不住（已知局限，
      // 形态极偏；只出现在「独立操作符 + 这种值」的混合写法里）
      const value = 'it\'s "a b"';

      await handlePluginOrChainRoute(buildRequest({
        command: 'fill',
        cmdArgs: ['#q', value, '&&', 'title'],
        argv: ['fill', '#q', value, '&&', 'title'],
      }));

      expect(mockExecuteChain).toHaveBeenCalledWith(
        `fill #q ${value} && title`,
        { cdpEndpoint: undefined, sessionName: 'default' },
      );
    });
  });

  describe('a quoted command string followed by token operators', () => {
    it('splices the original string and quotes the tokens around it', async () => {
      const handled = await handlePluginOrChainRoute(buildRequest({
        command: 'fill',
        cmdArgs: ['#q', 'x ; y', '&&', 'fill', '#q', 'p + q'],
        // router 重写后的 argv：命令串已拆成裸 token，链区 = [0, 2]
        argv: ['fill', '#q', 'x ; y', '&&', 'fill', '#q', 'p + q'],
        chainTokenStart: 0,
        chainTokenEnd: 2,
        chainRaw: "fill '#q' 'x ; y'",
      }));

      expect(handled).toBe(true);
      expect(mockExecuteChain).toHaveBeenCalledWith(
        `fill '#q' 'x ; y' && fill #q "p + q"`,
        { cdpEndpoint: undefined, sessionName: 'default' },
      );
    });

    it('decides on the bare tokens, so a quoted separator in the string is not a chain', async () => {
      // 这种串在 router 更早的 isChainInput(chainArg) 就已按链处理，正常到不了
      // 这里；万一到了，也不能因为原始串里的 ` ; ` 再拆一次
      const handled = await handlePluginOrChainRoute(buildRequest({
        command: 'fill',
        cmdArgs: ['#q', 'a b'],
        argv: ['fill', '#q', 'a b'],
        chainTokenStart: 0,
        chainTokenEnd: 2,
        chainRaw: "fill '#q' 'a b'",
      }));

      expect(handled).toBe(false);
      expect(mockExecuteChain).not.toHaveBeenCalled();
    });

    it('strips global flags outside the chain region', async () => {
      const handled = await handlePluginOrChainRoute(buildRequest({
        command: 'echo',
        cmdArgs: [],
        argv: ['--session', 's', '--json', 'echo', 'a', '&&', 'title'],
        chainTokenStart: 3,
        chainTokenEnd: 4,
        chainRaw: 'echo a',
        sessionName: 's',
      }));

      expect(handled).toBe(true);
      expect(mockExecuteChain).toHaveBeenCalledWith(
        'echo a && title',
        { cdpEndpoint: undefined, sessionName: 's' },
      );
    });
  });
});

describe('plugin commands follow the --bridge session switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsChainInput.mockReturnValue(false);
    mockGetPluginStorage.mockReturnValue({});
    mockAttachDetectAntiBot.mockImplementation(() => {});
    mockBuildViewerUrl.mockReturnValue(undefined);
    mockCheckPluginLoginRequired.mockResolvedValue({ ok: true });
    mockLoadHooks.mockResolvedValue([]);
  });

  it('accepts --bridge and forwards the switch so the session is created in the user’s browser', async () => {
    // 此前 --bridge 不在全局 flag 白名单里：插件命令一带它就被判 Unknown parameter，
    // 只有内置命令能把会话建到 bridge 通道
    setupLoaderWithSites([createMockSite()]);
    mockForwardPluginExec.mockResolvedValue({ success: true, data: { ok: 1 }, duration: 2 });

    const handled = await handlePluginOrChainRoute(buildRequest({
      command: 'mysite',
      cmdArgs: ['mycmd', '--session', 'work', '--bridge'],
      argv: ['mysite', 'mycmd', '--session', 'work', '--bridge'],
      options: { session: 'work', bridge: true },
      sessionName: 'work',
    }));

    expect(handled).toBe(true);
    expect(mockOutputError).not.toHaveBeenCalled();
    const call = mockForwardPluginExec.mock.calls[0] as unknown[];
    expect(call.slice(0, 4)).toEqual(['mysite.mycmd', expect.any(Object), 'work', undefined]);
    expect(call[5]).toBe(true);
  });

  it('without --bridge the switch is forwarded as false', async () => {
    setupLoaderWithSites([createMockSite()]);
    mockForwardPluginExec.mockResolvedValue({ success: true, data: { ok: 1 }, duration: 2 });

    await handlePluginOrChainRoute(buildRequest({ command: 'mysite', cmdArgs: ['mycmd'], argv: ['mysite', 'mycmd'] }));

    expect((mockForwardPluginExec.mock.calls[0] as unknown[])[5]).toBe(false);
  });

  it('still rejects flags that are neither parameters nor global options', async () => {
    setupLoaderWithSites([createMockSite()]);

    const handled = await handlePluginOrChainRoute(buildRequest({
      command: 'mysite', cmdArgs: ['mycmd', '--nope'], argv: ['mysite', 'mycmd', '--nope'],
    }));

    expect(handled).toBe(true);
    expect(mockForwardPluginExec).not.toHaveBeenCalled();
    expect(mockOutputError).toHaveBeenCalledWith(expect.stringContaining('Unknown parameter: --nope'));
  });
});
