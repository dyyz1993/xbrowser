import { describe, it, expect, vi, beforeEach } from 'vitest';

// 路由层对「值」的处理：负数、`--` 之后的字面量、值里的链分隔符、命令串里
// 不带空格的 `;`。这里故意不 mock @dyyz1993/xcli-core —— `-10` 被真实
// parseArgs 当短旗标组（'1','0'）吃掉正是缺陷本体，tests/router.test.ts 里
// 的简化 parseArgs mock 会把 -10 放进 positional，掩盖这个 bug。
// 全部下游只用 mock，不启动任何浏览器。

vi.mock('../src/executor.js', () => ({
  executeChain: vi.fn().mockResolvedValue({ success: true, steps: [], totalDuration: 0 }),
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

vi.mock('../src/plugin/loader.js', () => {
  const mockLoader = {
    getCore: () => ({
      loader: {
        getSite: vi.fn(() => null),
      },
    }),
    scanAndLoad: vi.fn(),
    resolveSiteName: vi.fn(() => undefined),
  };
  return {
    XBrowserPluginLoader: vi.fn(() => mockLoader),
  };
});

vi.mock('../src/client/daemon-client.js', () => ({
  forwardExec: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/browser.js', () => ({
  findSession: vi.fn(() => null),
  createSession: vi.fn(),
  destroyBrowser: vi.fn(),
}));

import { routeCommand } from '../src/router.js';
import { executeChain } from '../src/executor.js';
import { handleBrowserCommand } from '../src/cli/index.js';

const mockHandleBrowserCommand = vi.mocked(handleBrowserCommand);
const mockExecuteChain = vi.mocked(executeChain);

/** 路由交给内置命令处理器的参数：[command, args, options, session, mode, cdp, literal] */
function browserCall(): unknown[] {
  expect(mockHandleBrowserCommand).toHaveBeenCalled();
  return mockHandleBrowserCommand.mock.calls[0];
}

describe('router argument values (real parseArgs)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe('negative coordinates', () => {
    it('passes positional negative coordinates through to the mouse command', async () => {
      await routeCommand(['mouse', 'move', '-10', '-20']);

      expect(browserCall().slice(0, 2)).toEqual(['mouse', ['move', '-10', '-20']]);
    });

    it('passes --x/--y negative values through in the space-separated flag form', async () => {
      await routeCommand(['mouse', '--action', 'move', '--x', '-10', '--y', '-20']);

      const options = browserCall()[2] as Record<string, unknown>;
      expect(options.action).toBe('move');
      expect(options.x).toBe('-10');
      expect(options.y).toBe('-20');
    });

    it('keeps positive coordinates unchanged', async () => {
      await routeCommand(['mouse', 'move', '100', '200']);

      expect(browserCall().slice(0, 2)).toEqual(['mouse', ['move', '100', '200']]);
    });

    it('keeps the --x=-10 equals form working', async () => {
      await routeCommand(['mouse', '--action', 'move', '--x=-10', '--y=-20']);

      const options = browserCall()[2] as Record<string, unknown>;
      expect(options.x).toBe('-10');
      expect(options.y).toBe('-20');
    });
  });

  describe('values after --', () => {
    it('hands everything after -- to the command as literal positionals', async () => {
      await routeCommand(['fill', '#q', '--', '- item']);

      const call = browserCall();
      expect(call[1]).toEqual(['#q', '- item']);
      expect(call[6]).toBe(true);
    });

    it('accepts -- right after the command name', async () => {
      await routeCommand(['fill', '--', '#q', '- item', '--flag']);

      const call = browserCall();
      expect(call[1]).toEqual(['#q', '- item', '--flag']);
      expect(call[6]).toBe(true);
    });

    it('without -- a dash-leading value is still read as a flag (why -- exists)', async () => {
      await routeCommand(['fill', '#q', '- item']);

      const call = browserCall();
      expect(call[1]).toEqual(['#q']);
      // 没有 `--` 就不传字面量标记：调用形状与改动前一致
      expect(call[6]).toBeUndefined();
    });

    it('stops option parsing at --, global flags included', async () => {
      await routeCommand(['--session', 'before', 'fill', '#q', '--', '--session', 'after']);

      const call = browserCall();
      expect(call[1]).toEqual(['#q', '--session', 'after']);
      expect(call[2]).toEqual({ session: 'before' });
    });

    it('does not read an output-mode flag out of the literals', async () => {
      // `--` 之后的 `--yaml` 是值：输出模式仍由前面的 --json 决定
      await routeCommand(['fill', '#q', '--json', '--', '--yaml']);

      const call = browserCall();
      expect(call[1]).toEqual(['#q', '--yaml']);
      expect(call[2]).toEqual({ json: true });
      expect(call[4]).toBe('json');
    });

    it('keeps a negative number after -- as a plain value', async () => {
      await routeCommand(['fill', '#q', '--', '-5']);

      expect(browserCall()[1]).toEqual(['#q', '-5']);
    });
  });

  describe('values that hold chain separators', () => {
    it.each(['x ; title', 'a + b', 'a -> b'])(
      'keeps "%s" as the value of a registered command',
      async (value) => {
        await routeCommand(['fill', '#q', value]);

        expect(browserCall().slice(0, 2)).toEqual(['fill', ['#q', value]]);
        expect(mockExecuteChain).not.toHaveBeenCalled();
      },
    );

    it('still runs a chain spelled with a token operator, value intact', async () => {
      await routeCommand(['fill', '#q', 'a + b', '&&', 'title']);

      expect(mockHandleBrowserCommand).not.toHaveBeenCalled();
      expect(mockExecuteChain).toHaveBeenCalledWith(
        'fill #q "a + b" && title',
        { cdpEndpoint: undefined, sessionName: 'default' },
      );
    });

    it('keeps the chain spelling for plain tokens byte for byte', async () => {
      await routeCommand(['goto', 'https://a.example', '&&', 'title']);

      expect(mockExecuteChain).toHaveBeenCalledWith(
        'goto https://a.example && title',
        { cdpEndpoint: undefined, sessionName: 'default' },
      );
    });

    it('never builds a chain out of literals that follow --', async () => {
      await routeCommand(['fill', '#q', '--', '&&']);

      expect(browserCall().slice(0, 2)).toEqual(['fill', ['#q', '&&']]);
      expect(mockExecuteChain).not.toHaveBeenCalled();
    });

    it('keeps the legacy whole-string check for an unregistered command name', async () => {
      await routeCommand(['someplugin', 'cmd1 && cmd2']);

      expect(mockExecuteChain).toHaveBeenCalledWith(
        'someplugin cmd1 && cmd2',
        { cdpEndpoint: undefined, sessionName: 'default' },
      );
    });
  });

  describe('a semicolon with no space after it inside a command string', () => {
    it('runs the chain when the text after ; starts with a registered command', async () => {
      await routeCommand(['goto https://a.example;title']);

      expect(mockHandleBrowserCommand).not.toHaveBeenCalled();
      expect(mockExecuteChain).toHaveBeenCalledWith(
        'goto https://a.example ; title',
        expect.objectContaining({ sessionName: 'default' }),
      );
    });

    it('leaves the string alone when what follows ; is not a command', async () => {
      await routeCommand(['goto https://x.example/a;jsessionid=1']);

      expect(mockExecuteChain).not.toHaveBeenCalled();
      expect(browserCall().slice(0, 2)).toEqual(['goto', ['https://x.example/a;jsessionid=1']]);
    });

    it('leaves a semicolon inside quotes alone', async () => {
      await routeCommand(["fill '#q' 'a;b'"]);

      expect(mockExecuteChain).not.toHaveBeenCalled();
      expect(browserCall().slice(0, 2)).toEqual(['fill', ['#q', 'a;b']]);
    });

    it('does not change a chain that already reads as one', async () => {
      await routeCommand(['goto https://a.example ; title']);

      expect(mockExecuteChain).toHaveBeenCalledWith(
        'goto https://a.example ; title',
        expect.objectContaining({ sessionName: 'default' }),
      );
    });
  });
});
