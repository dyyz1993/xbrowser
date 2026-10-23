import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/51cto/index.ts';
import { __setHumanizeSleeperForTests } from '../../.xcli/plugins/shared/humanize.js';

beforeEach(() => { __setHumanizeSleeperForTests(async () => {}); });
afterEach(() => { __setHumanizeSleeperForTests(); });

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

function getHandler(name: string): (params: Record<string, unknown>, ctx: unknown) => Promise<unknown> {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`${name} not registered`);
  return (call[1] as { handler: (p: Record<string, unknown>, c: unknown) => Promise<unknown> }).handler;
}

/**
 * 51CTO 发布已迁到共享发布层（`shared/publishing/`），本地通道走
 * `LocalPageAdapter`（page.evaluate / page.mouse.click）。
 */
function createMockPage(state: Record<string, unknown> = {}) {
  const s: Record<string, unknown> = {
    url: 'https://blog.51cto.com/blogger/publish?old=1&newBloger=1',
    ...state,
  };
  const evaluate = vi.fn(async (expr: string) => {
    if (expr.includes('input.editor-title')) {
      s.title = '已设置';
      return true;
    }
    if (expr.includes('contenteditable=true')) {
      return { len: 1200, imgs: 1, gt: 0 };
    }
    if (expr.includes('querySelectorAll(\'textarea\')')) return true;
    if (expr.includes('Object.getOwnPropertyDescriptor')) return true;
    if (expr === 'location.href') return s.url;
    return undefined;
  });
  const page = {
    goto: vi.fn(async () => {}),
    waitForTimeout: vi.fn(() => new Promise<void>((r) => { setTimeout(r, 5); })),
    waitForLoadState: vi.fn(async () => {}),
    url: vi.fn(() => s.url as string),
    bringToFront: vi.fn(async () => {}),
    mouse: { click: vi.fn(async () => {}) },
    keyboard: { insertText: vi.fn(async () => {}) },
    evaluate,
  };
  return { page, state: s };
}

const ctxWith = (page: unknown) => ({ page }) as unknown as Record<string, unknown>;

describe('51cto plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
  });

  // ——— 注册 ———
  it('should create site with name 51cto', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: '51cto' }));
  });

  it('should register login/draft/publish/status', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0]).sort();
    expect(names).toEqual(['draft', 'login', 'publish', 'status']);
  });

  it('each command should have description, scope, parameters, handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const meta = call[1] as Record<string, unknown>;
      expect(meta.description).toBeTruthy();
      expect(['page', 'browser']).toContain(meta.scope);
      expect(meta.parameters).toBeDefined();
      expect(meta.handler).toBeTypeOf('function');
    }
  });

  it('should register isLogin hook on site', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ isLogin: expect.any(Function) }),
    );
  });

  // ——— 通用守卫 ———
  it('draft should fail when neither content nor file provided', async () => {
    const { page } = createMockPage();
    const res = await getHandler('draft')({ title: 'T' }, ctxWith(page)) as { success: boolean };
    expect(res.success).toBe(false);
  });

  it('publish should fail when neither content nor file provided', async () => {
    const { page } = createMockPage();
    const res = await getHandler('publish')({ title: 'T' }, ctxWith(page)) as { success: boolean };
    expect(res.success).toBe(false);
  });

  // ——— draft ———
  it('draft should fill title and body, report channel=local', async () => {
    const { page } = createMockPage();
    const res = await getHandler('draft')(
      { title: '标题一', content: '正文'.repeat(100) },
      ctxWith(page),
    ) as { success: boolean; data: { channel: string; chars: number } };
    expect(res.success).toBe(true);
    expect(res.data.channel).toBe('local');
    expect(res.data.chars).toBeGreaterThan(100);
  });

  // ——— publish ———
  it('publish should return fail when editor body not written', async () => {
    const { page } = createMockPage();
    const orig = page.evaluate.getMockImplementation();
    page.evaluate.mockImplementation(async (expr: string) => {
      if (expr.includes('contenteditable=true')) return { len: 5, imgs: 0, gt: 0 };
      return orig ? orig(expr) : undefined;
    });
    const res = await getHandler('publish')(
      { title: 'T', content: '短' },
      ctxWith(page),
    ) as { success: boolean };
    expect(res.success).toBe(false);
  });

  // ——— status ———
  it('status should read counts and rejection reasons', async () => {
    const { page } = createMockPage({ url: 'https://blog.51cto.com/creative-center/manager' });
    page.evaluate.mockImplementation(async (expr: string) => {
      if (expr.includes('.common-article-list')) {
        return [{ title: '你的 CLI 工具为什么需要 MCP', reason: '含广告信息' }];
      }
      if (expr.includes('attr_type')) return { pending: 0, rejected: 1 };
      if (expr.includes('getComputedStyle')) return true;
      return undefined;
    });
    const res = await getHandler('status')({}, ctxWith(page)) as {
      success: boolean;
      data: { rejected: number; rejectReasons: Array<{ title: string; reason: string }> };
    };
    expect(res.success).toBe(true);
    expect(res.data.rejected).toBe(1);
    expect(res.data.rejectReasons[0].reason).toBe('含广告信息');
  });
});
