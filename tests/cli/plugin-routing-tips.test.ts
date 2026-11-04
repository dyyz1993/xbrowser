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

    const handled = await handlePluginOrChainRoute(buildRequest({ mode: 'json' }));

    expect(handled).toBe(true);
    expect(mockForwardPluginExec).toHaveBeenCalledWith('mysite.mycmd', {}, 'default', undefined, undefined);
    const output = joinedConsoleOutput(errSpy);
    expect(output).toContain('tip-from-tip-object');
    expect(output).toContain('tip-from-plain-string');
    expect(output).not.toContain('[object Object]');
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
