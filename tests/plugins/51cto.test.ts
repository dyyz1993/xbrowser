import { tipsText } from './_tips-helper.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/51cto/index.ts';

import { __setHumanizeSleeperForTests } from '../../.xcli/plugins/shared/humanize.js';

// P1-4: instant sleeper so humanized pacing doesn't burn wall-clock in unit tests.
beforeEach(() => { __setHumanizeSleeperForTests(async () => {}); });
afterEach(() => { __setHumanizeSleeperForTests(); });

const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

function getHandler(name: string): Function {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1].handler;
}

interface CtoState {
  url: string;
  successUrl: string;
  modelBytes: number;
  visible: Set<string>;
  categories: Set<string>;
  lastCenter: string;
  onClick?: (sel: string) => void;
}

function createSelectorFromExpr(expr: string): string | null {
  const m = expr.match(/querySelector\("(.+?)"\)/);
  return m ? m[1] : null;
}

function createMockPage() {
  const state: CtoState = {
    url: 'https://blog.51cto.com/blogger/publish?old=1&newBloger=1',
    successUrl: 'https://blog.51cto.com/blogger/success/14933248',
    modelBytes: 3414,
    visible: new Set(['input.editor-title', '.am-engine', '.edit-submit', '#submitForm']),
    categories: new Set(['后端开发', '架构']),
    lastCenter: '',
  };
  const page = {
    goto: vi.fn(async () => {}),
    // 25ms 真实延时：让 waitForVisible/waitForUrl 的 Date.now() deadline 能真实推进（否则 20s 空转）
    waitForTimeout: vi.fn(() => new Promise<void>((r) => { setTimeout(r, 25); })),
    waitForLoadState: vi.fn(async () => {}),
    url: vi.fn(() => state.url),
    bringToFront: vi.fn(async () => {}),
    mouse: {
      click: vi.fn(async () => {
        if (state.onClick) { state.onClick(state.lastCenter); return; }
        if (state.lastCenter === '#submitForm') state.url = state.successUrl;
      }),
    },
    keyboard: {
      insertText: vi.fn(async () => {}),
      press: vi.fn(async () => {}),
      down: vi.fn(async () => {}),
      up: vi.fn(async () => {}),
      pressCombo: vi.fn(async () => {}),
    },
    evaluate: vi.fn(async (expr: string) => {
      if (expr.includes('typeof $VM')) return state.modelBytes;
      if (expr.includes('.common-article-list')) {
        return [{ title: '你的 CLI 工具为什么需要 MCP', reason: '含广告信息' }];
      }
      if (expr.includes("querySelectorAll('strong')")) {
        return { pending: 0, rejected: 1 };
      }
      if (expr.includes('getComputedStyle')) {
        const sel = createSelectorFromExpr(expr);
        return sel ? state.visible.has(sel) : false;
      }
      if (expr.includes('querySelectorAll')) {
        // clickTextItem：rootSel + 精确文字匹配 + elementFromPoint 自校验（ok 字段）
        const tm = expr.match(/trim\(\) === "([^"]*)"/);
        return tm && state.categories.has(tm[1]) ? { x: 50, y: 50, ok: true } : null;
      }
      // centerOf
      const sel = createSelectorFromExpr(expr);
      if (!sel) return null;
      state.lastCenter = sel;
      return state.visible.has(sel) ? { x: 100, y: 100 } : null;
    }),
  };
  return { page, state };
}

const ctxWith = (page: unknown) => ({ page }) as unknown as Record<string, unknown>;

describe('51cto plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as never);
  });

  // ——— 注册测试 ———
  it('should create site with name 51cto', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: '51cto' }));
  });

  it('should register 4 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(4);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0]);
    expect(names).toEqual(['login', 'draft', 'publish', 'status']);
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
    expect(mockXCLI.createSite).toHaveBeenCalledWith(expect.objectContaining({ isLogin: expect.any(Function) }));
  });

  // ——— 通用守卫 ———
  it('handler should throw when no page', async () => {
    const handler = getHandler('draft');
    await expect(handler({ title: 'T', content: 'C' }, ctxWith(undefined))).rejects.toThrow('需要浏览器页面');
  });

  it('draft should fail when neither content nor file', async () => {
    const { page } = createMockPage();
    const handler = getHandler('draft');
    const res = await handler({ title: 'T' }, ctxWith(page)) as { success: boolean };
    expect(res.success).toBe(false);
  });

  it('should fail when not logged in (redirect to home.51cto.com)', async () => {
    const { page, state } = createMockPage();
    state.url = 'https://home.51cto.com/index/login';
    const handler = getHandler('draft');
    const res = await handler({ title: 'T', content: 'C', category1: '后端开发', category2: '架构' }, ctxWith(page)) as { success: boolean };
    expect(res.success).toBe(false);
  });

  // ——— draft ———
  it('draft should bringToFront and insert title + body via keyboard.insertText', async () => {
    const { page, state } = createMockPage();
    const handler = getHandler('draft');
    const res = await handler({ title: '标题一', content: '正文'.repeat(50) }, ctxWith(page)) as { success: boolean; data: { modelBytes: number } };
    expect(res.success).toBe(true);
    expect(page.bringToFront).toHaveBeenCalled();
    expect(page.keyboard.insertText).toHaveBeenCalledWith('标题一');
    const bodyCall = (page.keyboard.insertText as ReturnType<typeof vi.fn>).mock.calls
      .map(c => c[0] as string).find(t => t.includes('正文'));
    expect(bodyCall).toBeTruthy();
    expect(res.data.modelBytes).toBe(3414);
    expect(state.lastCenter).toBe('.am-engine');
  });

  it('draft should fail when editor model not synced', async () => {
    const { page, state } = createMockPage();
    state.modelBytes = 0;
    const handler = getHandler('draft');
    const res = await handler({ title: 'T', content: 'C', category1: '后端开发', category2: '架构' }, ctxWith(page)) as { success: boolean };
    expect(res.success).toBe(false);
  });

  // ——— publish ———
  it('publish should walk the sensitive-word dialog path and return articleId', async () => {
    const { page, state } = createMockPage();
    state.visible.add('.dialog.prohi_words');
    state.visible.add('.continue_pub');
    state.visible.add('.editor-dialog__wrapper');
    const handler = getHandler('publish');
    const res = await handler({ title: 'T', content: 'C', category1: '后端开发', category2: '架构' }, ctxWith(page)) as {
      success: boolean; data: { published: boolean; articleId: string; sensitiveReview: boolean };
    };
    expect(res.success).toBe(true);
    expect(res.data.published).toBe(true);
    expect(res.data.articleId).toBe('14933248');
    expect(res.data.sensitiveReview).toBe(true);
    // 敏感词确认按钮被点击
    expect(state.lastCenter).toBe('#submitForm');
    expect(page.mouse.click).toHaveBeenCalledWith(100, 100);
  });

  it('publish should skip sensitive dialog when clean (settings panel directly)', async () => {
    const { page, state } = createMockPage();
    state.visible.add('.editor-dialog__wrapper');
    const handler = getHandler('publish');
    const res = await handler({ title: 'T', content: 'C', category1: '后端开发', category2: '架构' }, ctxWith(page)) as {
      success: boolean; data: { sensitiveReview: boolean | undefined };
    };
    expect(res.success).toBe(true);
    expect(res.data.sensitiveReview).toBeFalsy();
  });

  it('publish should fail before clicking publish when model not synced', async () => {
    const { page, state } = createMockPage();
    state.modelBytes = 0;
    const handler = getHandler('publish');
    const res = await handler({ title: 'T', content: 'C', category1: '后端开发', category2: '架构' }, ctxWith(page)) as { success: boolean };
    expect(res.success).toBe(false);
    // 只允许标题/正文聚焦两次点击，不得点发布
    expect(page.mouse.click).toHaveBeenCalledTimes(2);
  });

  it('publish should fail when no success redirect after submit', async () => {
    const { page, state } = createMockPage();
    state.visible.add('.editor-dialog__wrapper');
    state.onClick = () => {}; // 提交后 URL 不变
    const handler = getHandler('publish');
    const res = await handler({ title: 'T', content: 'C', category1: '后端开发', category2: '架构' }, ctxWith(page)) as { success: boolean };
    expect(res.success).toBe(false);
  });

  it('publish should fail when category item not found', async () => {
    const { page, state } = createMockPage();
    state.visible.add('.editor-dialog__wrapper');
    state.categories.clear();
    const handler = getHandler('publish');
    const res = await handler({ title: 'T', content: 'C', category1: '后端开发', category2: '架构' }, ctxWith(page)) as { success: boolean };
    expect(res.success).toBe(false);
  });

  // ——— status ———
  it('status should read counts and rejection reasons', async () => {
    const { page, state } = createMockPage();
    state.url = 'https://blog.51cto.com/creative-center/manager';
    state.visible.add('strong[attr_type]');
    state.visible.add('strong[attr_type="6"]');
    const handler = getHandler('status');
    const res = await handler({}, ctxWith(page)) as {
      success: boolean; data: { pending: number; rejected: number; rejectReasons: Array<{ title: string; reason: string }> };
    };
    expect(res.success).toBe(true);
    expect(res.data.rejected).toBe(1);
    expect(res.data.rejectReasons[0].reason).toBe('含广告信息');
  });

  // ——— tips ———
  it('publish tips should mention review follow-up on sensitive path', async () => {
    const { page, state } = createMockPage();
    state.visible.add('.dialog.prohi_words');
    state.visible.add('.continue_pub');
    state.visible.add('.editor-dialog__wrapper');
    const handler = getHandler('publish');
    const res = await handler({ title: 'T', content: 'C', category1: '后端开发', category2: '架构' }, ctxWith(page)) as { success: boolean; tips: unknown[] };
    expect(tipsText(res.tips)).toContain('人工审核');
  });
});
