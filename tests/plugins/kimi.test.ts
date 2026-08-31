import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/kimi/index.js';

// mock xcli：createSite 返回 mockSite，捕获 command 注册
const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXcli = { createSite: vi.fn(() => mockSite) };

// mock page 工厂：按表达式内容分支返回
function createMockPage(opts: { editorFound?: boolean; noReply?: boolean } = {}) {
  const editorFound = opts.editorFound !== false;
  const page = {
    url: vi.fn(() => 'https://www.kimi.com'),
    goto: vi.fn(),
    waitForSelector: vi.fn(() =>
      editorFound ? Promise.resolve({}) : Promise.reject(new Error('timeout')),
    ),
    waitForTimeout: vi.fn(),
    keyboard: { press: vi.fn() },
    evaluate: vi.fn((expr: string) => {
      // 轮询回复（含 innerText 读取）：稳定返回固定文本
      if (expr.includes('innerText')) {
        return opts.noReply ? Promise.resolve('') : Promise.resolve('这是 Kimi 的回复');
      }
      // 回复块计数（before 与轮询共用）
      if (expr.includes("querySelectorAll('[class*=message], article')")) {
        return Promise.resolve(0); // before=0；blocks(0) <= before(0) → 轮询返回 ''
      }
      // paste
      if (expr.includes('ClipboardEvent')) return Promise.resolve('pasted');
      return Promise.resolve(undefined);
    }),
  };
  return page;
}

function getHandler(): { parameters: unknown; handler: (p: any, c: any) => Promise<any> } {
  // plugin() 已在 beforeEach 注册；从 mockSite 捕获 chat 命令
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'chat');
  if (!call) throw new Error('chat command not registered');
  return call[1] as any;
}

describe('kimi plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXcli as any);
  });

  describe('注册', () => {
    it('createSite 参数正确（kimi/www.kimi.com/requiresLogin）', () => {
      expect(mockXcli.createSite).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'kimi',
          url: 'https://www.kimi.com',
          requiresLogin: true,
        }),
      );
    });

    it('注册 chat 命令，含 description/parameters/handler', () => {
      const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'chat');
      expect(call).toBeDefined();
      const def = call![1] as any;
      expect(def.description).toContain('Kimi');
      expect(def.parameters).toBeDefined();
      expect(typeof def.handler).toBe('function');
    });
  });

  describe('chat handler', () => {
    it('无 page 时抛错', async () => {
      const h = getHandler();
      await expect(h.handler({ message: 'hi' }, {})).rejects.toThrow('需要浏览器页面');
    });

    it('编辑器未找到时抛错（站点改版/未登录场景）', async () => {
      const h = getHandler();
      const page = createMockPage({ editorFound: false });
      await expect(h.handler({ message: 'hi' }, { page })).rejects.toThrow('kimi 编辑器未找到');
    });

    it('正常流：paste 输入 → Enter → 捕获稳定回复', async () => {
      const h = getHandler();
      const page = createMockPage();
      const result = await h.handler({ message: '你好 kimi', timeout: 15 }, { page });
      expect(result.response).toContain('Kimi');
      expect(result.durationMs).toBeGreaterThanOrEqual(0); // mock 无真实延迟
      // paste evaluate 被调用（消息内容注入）
      const pasteCall = page.evaluate.mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('ClipboardEvent'),
      );
      expect(pasteCall).toBeDefined();
      expect(String(pasteCall![0])).toContain('你好 kimi');
      // Enter 发送
      expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
    });

    it('超时无回复时抛错', async () => {
      const h = getHandler();
      const page = createMockPage({ noReply: true });
      await expect(h.handler({ message: 'hi', timeout: 1 }, { page })).rejects.toThrow(
        '未捕获到回复',
      );
    });

    it('非 kimi 页面时先导航', async () => {
      const h = getHandler();
      const page = createMockPage();
      page.url.mockReturnValue('https://example.com');
      await h.handler({ message: 'hi', timeout: 15 }, { page });
      expect(page.goto).toHaveBeenCalledWith('https://www.kimi.com');
    });
  });
});
