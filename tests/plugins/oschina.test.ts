import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../.xcli/plugins/oschina/index.ts';
import { __setHumanizeSleeperForTests } from '../../.xcli/plugins/shared/humanize.js';

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

/**
 * 测试隔离：真实机器上 chrome-bridge 可能在线，会让通道解析走 bridge 分支，
 * 污染本地通道断言。统一 mock fetch 让 bridge 判定为不可用。
 */
const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => {
    throw new Error('ECONNREFUSED');
  }) as never;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * OSC 发布已迁到共享发布层（`shared/publishing/`），本地通道走
 * `LocalPageAdapter`：正文用 `editor.commands.setContent` 写入 Tiptap，
 * 标题用真实键盘输入（受控输入框，native setter 会被框架回滚），
 * 发布是「顶栏按钮弹 Popconfirm → 弹窗内确定并发布」两层。
 */
function createPage(options: { editorReady?: boolean; url?: string } = {}) {
  const s = {
    url: options.url ?? 'https://my.oschina.net/u/1/blog/ai-write',
    editorReady: options.editorReady ?? true,
    title: '',
    focused: false,
  };
  const page = {
    goto: vi.fn(async () => {}),
    waitForLoadState: vi.fn(async () => {}),
    waitForTimeout: vi.fn(() => new Promise<void>((r) => { setTimeout(r, 5); })),
    url: vi.fn(() => s.url),
    bringToFront: vi.fn(async () => {}),
    mouse: { click: vi.fn(async () => {}) },
    keyboard: { insertText: vi.fn(async (t: string) => { s.title += t; }) },
    evaluate: vi.fn(async (expr: string) => {
      // readyState 探测（waitReady 用）
      if (expr.includes('document.readyState')) return 'complete';
      // Tiptap 实例
      if (expr.includes('.tiptap.ProseMirror')) {
        return s.editorReady ? { len: 900, imgs: 1, gt: 0 } : null;
      }
      // 标题输入框存在性探测（querySelectorAll('input') + placeholder 含「标题」）
      if (expr.includes("querySelectorAll('input')") && expr.includes('标题')) {
        return true;
      }
      // 标题受控输入：native setter 被框架回滚 → 实际值由 keyboard.insertText 写入
      if (expr.includes('Object.getOwnPropertyDescriptor(HTMLInputElement.prototype')) {
        return true;
      }
      // 标题输入框就绪判定
      if (expr.includes('getBoundingClientRect') && expr.includes('标题')) return true;
      // 聚焦标题框
      if (expr.includes('t.focus()') && expr.includes('标题')) {
        s.focused = true;
        return 'focused';
      }
      // 标题回读
      if (expr.includes('请输入文章标题') && expr.includes('value.length')) {
        return s.title.length > 0;
      }
      // Popconfirm 弹窗出现
      if (expr.includes('.ant-popover-inner')) return true;
      // 位置与坐标
      if (expr.includes('location.pathname') && expr.includes('ai-write')) {
        return s.url.indexOf('/u/') >= 0;
      }
      if (expr.includes('location.pathname')) return s.url.indexOf('/u/') >= 0;
      // uid 探测
      if (expr.includes('querySelectorAll') && expr.includes('/u/')) return '1998814';
      if (expr.includes('Object.getOwnPropertyDescriptor')) return true;
      if (expr === 'location.href') return s.url;
      // 定位结果
      if (expr.includes('elementsFromPoint')) {
        if (expr.includes('确定并发布')) {
          return JSON.stringify({ x: 1774, y: 524, text: '确定并发布', tag: 'BUTTON' });
        }
        if (expr.includes('发布文章')) {
          return JSON.stringify({ x: 1786, y: 32, text: '发布文章', tag: 'BUTTON' });
        }
      }
      return undefined;
    }),
  };
  return { page, state: s };
}

function handlerOf(name: string): (params: unknown, ctx: unknown) => Promise<Record<string, unknown>> {
  const call = mockSite.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`command ${name} missing`);
  return (call[1] as { handler: (p: unknown, c: unknown) => Promise<Record<string, unknown>> }).handler;
}

function ctxFor(page: ReturnType<typeof createPage>['page']) {
  return {
    page,
    cdpEndpoint: 'http://localhost:9222',
    waitForHuman: vi.fn(async () => ({ solved: true })),
  };
}

describe('oschina plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setHumanizeSleeperForTests(async () => {});
    plugin(mockXCLI as never);
  });

  afterEach(() => {
    __setHumanizeSleeperForTests();
  });

  it('registers login, draft, and publish', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({
      name: 'oschina',
      requiresLogin: true,
    }));
    expect(mockSite.command.mock.calls.map((item: unknown[]) => item[0]).sort())
      .toEqual(['draft', 'login', 'publish']);
  });

  it('rejects draft without content or file', async () => {
    const result = await handlerOf('draft')({ title: 'Title' }, ctxFor(createPage().page));
    expect(result.success).toBe(false);
    expect(result.message).toBe('必须提供 --content 或 --file 参数');
  });

  it('fills TipTap editor via setContent for a draft', async () => {
    const harness = createPage();
    const result = await handlerOf('draft')(
      { title: 'Hello', content: 'World' },
      ctxFor(harness.page),
    );
    // 正文走 editor.commands.setContent，不是 insertText
    const exprs = harness.page.evaluate.mock.calls.map((c) => c[0] as string).join('\n');
    expect(exprs).toContain('setContent');
    expect(exprs).toContain('clearContent(true)');
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ title: 'Hello', channel: 'local' });
  });

  it('writes title through trusted keyboard input', async () => {
    const harness = createPage();
    await handlerOf('draft')(
      { title: 'Hello', content: 'World' },
      ctxFor(harness.page),
    );
    // 标题必须走真实键盘输入（受控输入框不认 native setter）
    expect(harness.page.keyboard.insertText).toHaveBeenCalledWith('Hello');
  });

  it('fails draft when TipTap instance missing', async () => {
    const harness = createPage({ editorReady: false });
    const result = await handlerOf('draft')(
      { title: 'Hello', content: 'World' },
      ctxFor(harness.page),
    );
    expect(result.success).toBe(false);
    expect(String(result.message)).toContain('Tiptap');
  });

  it('publish reports failure when it stays on the editor', async () => {
    const harness = createPage({ url: 'https://my.oschina.net/u/1/blog/ai-write' });
    const result = await handlerOf('publish')(
      { title: 'Hello', content: 'World' },
      ctxFor(harness.page),
    );
    expect(result.success).toBe(false);
  });

  it('publish succeeds and returns the blog URL', async () => {
    const harness = createPage({ url: 'https://my.oschina.net/u/1/blog/19781123' });
    const result = await handlerOf('publish')(
      { title: 'Hello', content: 'World' },
      ctxFor(harness.page),
    );
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      title: 'Hello',
      published: true,
      url: 'https://my.oschina.net/u/1/blog/19781123',
    });
  });
});
