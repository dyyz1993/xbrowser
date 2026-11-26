import { tipsMessages } from './_tips-helper.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import plugin from '../../.xcli/plugins/juejin/index.ts';
import { HumanWaitRequiredError } from '../../src/plugin/human-wait.js';

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

function createMockPage(options: Partial<{
  url: string;
  titleValue: string;
  titleVisible: boolean;
  titleReadOverride: string | null;
  editorMode: 'codemirror' | 'field' | 'none';
  editorVisible: boolean;
  bodyValue: string;
  writeResultLen: number | null;
  failBodyWrite: boolean;
  keystrokesDropped: boolean;
  pressError: string | null;
  publishVisible: boolean;
}> = {}) {
  // 有状态 mock（oschina.test.ts 同款思路）：标题/正文是可读写的存储，
  // pressSequentially/insertText 按真实驱动的「追加」语义写入——
  // 这样「重试叠加输入」在测试里可直接观测（ERR-20261022-002）。
  const s = {
    url: 'https://juejin.cn/editor/drafts/new',
    titleValue: '',
    titleVisible: false,
    titleReadOverride: null as string | null,
    editorMode: 'codemirror' as 'codemirror' | 'field' | 'none',
    editorVisible: true,
    bodyValue: '',
    writeResultLen: null as number | null,
    failBodyWrite: false,
    keystrokesDropped: false,
    pressError: null as string | null,
    publishVisible: false,
    ...options,
  };
  const titlePresses: string[] = [];
  const bodyInserts: string[] = [];
  const page = {
    state: s,
    titlePresses,
    bodyInserts,
    goto: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    evaluate: vi.fn((expr: unknown, _arg?: unknown): Promise<unknown> => {
      if (typeof expr === 'function') {
        // humanize 鼠标起点等 function 形式：默认返回视口中心
        return Promise.resolve({ x: 640, y: 360 });
      }
      const e = String(expr);
      // 标题当前值读取（fillInputIdempotent 的 readInputValue）
      if (e.includes('typeof el.value') && e.includes('输入文章标题')) {
        return Promise.resolve(s.titleReadOverride ?? s.titleValue);
      }
      // 标签当前值读取
      if (e.includes('typeof el.value') && e.includes('tag-input')) {
        return Promise.resolve('');
      }
      // 全选已有正文（selectAll 后 insertText 写在选区上 = 替换）——
      // 必须先于「正文状态读取」判断：两段表达式都含 contenteditable
      if (e.includes("execCommand('selectAll')")) {
        if (s.editorMode === 'field' && s.bodyValue !== '') {
          (s as { fieldSelected?: boolean }).fieldSelected = true;
        }
        return Promise.resolve('selected');
      }
      // 正文写入（CodeMirror.setValue 整体替换 + 回读长度）
      if (e.includes('CodeMirror.setValue')) {
        if (s.failBodyWrite) return Promise.reject(new Error('正文写入超时'));
        if (s.editorMode !== 'codemirror') {
          return Promise.resolve(JSON.stringify({ mode: 'none', len: 0 }));
        }
        const m = e.match(/var md = ("(?:[^"\\]|\\.)*");/);
        const md = m ? (JSON.parse(m[1]) as string) : '';
        s.bodyValue = md;
        return Promise.resolve(
          JSON.stringify({ mode: 'codemirror', len: s.writeResultLen ?? md.length }),
        );
      }
      // 正文当前状态读取（readEditorState）
      if (e.includes('CodeMirror.getValue') || e.includes('contenteditable')) {
        if (s.editorMode === 'codemirror') {
          return Promise.resolve(JSON.stringify({ mode: 'codemirror', text: s.bodyValue }));
        }
        if (s.editorMode === 'field') {
          return Promise.resolve(JSON.stringify({ mode: 'field', text: s.bodyValue }));
        }
        return Promise.resolve(JSON.stringify({ mode: 'none', text: null }));
      }
      return Promise.resolve(undefined);
    }),
    locator: vi.fn((sel: string) => ({
      first: vi.fn(() => ({
        isVisible: vi.fn((): Promise<boolean> => {
          if (sel.includes('输入文章标题') || sel.includes('title')) return Promise.resolve(s.titleVisible);
          if (sel.includes('CodeMirror') || sel.includes('editor')) return Promise.resolve(s.editorVisible);
          if (s.publishVisible && sel.includes('发布')) return Promise.resolve(true);
          return Promise.resolve(false);
        }),
        click: vi.fn(async () => undefined),
        fill: vi.fn(async (v: string) => {
          // fill 是替换语义：'' 清空（selectAll + 替换），有值则整体写入
          if (sel.includes('输入文章标题') || sel.includes('title')) {
            s.titleValue = v;
          }
        }),
        focus: vi.fn(async () => undefined),
        pressSequentially: vi.fn(async (ch: string) => {
          if (s.keystrokesDropped) {
            // bridge 输入门（扩展 ≥1.5.5）：页面不可见时第一个按键就报错，一个字都不落地
            return Promise.reject(new Error(
              '[bridge-session] cdp Input.dispatchKeyEvent 失败: [bridge-input] 页面不可见（outerWidth=0：tab 在后台，或窗口最小化 / 被完全遮挡）: Chrome drops mouse clicks and key events on this tab',
            ));
          }
          if (s.pressError) return Promise.reject(new Error(s.pressError));
          // 真实驱动语义：pressSequentially 在光标处追加
          titlePresses.push(ch);
          s.titleValue += ch;
        }),
        evaluate: vi.fn(async () => undefined),
        boundingBox: vi.fn(async () => null),
      })),
      filter: vi.fn(() => ({ count: vi.fn(async () => 0) })),
    })),
    fill: vi.fn(),
    click: vi.fn(),
    url: vi.fn(() => s.url),
    keyboard: {
      insertText: vi.fn(async (t: string) => {
        bodyInserts.push(t);
        const st = s as unknown as { fieldSelected?: boolean };
        if (st.fieldSelected) {
          s.bodyValue = t; // 选区上插入 = 替换
          st.fieldSelected = false;
        } else {
          s.bodyValue += t; // 光标处插入 = 追加（缺陷语义）
        }
      }),
      press: vi.fn(async () => undefined),
    },
    mouse: { wheel: vi.fn(() => Promise.resolve()), move: vi.fn(() => Promise.resolve()) },
    close: vi.fn(),
    $: vi.fn(),
    viewportSize: vi.fn(() => ({ width: 1280, height: 720 })),
  };
  return page;
}

function createMockCtx(page?: ReturnType<typeof createMockPage>) {
  return {
    page,
    waitForHuman: vi.fn(() => Promise.resolve({ solved: true })),
    storage: { set: vi.fn(), get: vi.fn(() => null), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() },
  };
}

const ALL_COMMANDS = ['login', 'publish', 'draft', 'upload-image', 'update-profile', 'fetch-articles'];

describe('juejin plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plugin(mockXCLI as unknown as Parameters<typeof plugin>[0]);
  });

  it('should create site with name juejin', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'juejin' })
    );
  });

  it('should create site with correct url', () => {
    expect(mockXCLI.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://juejin.cn' })
    );
  });

  it('should register 6 commands', () => {
    expect(mockSite.command).toHaveBeenCalledTimes(6);
  });

  it('should register expected command names', () => {
    const names = mockSite.command.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(names).toEqual(ALL_COMMANDS);
  });

  it('each command should have description, scope, parameters, and handler', () => {
    for (const call of mockSite.command.mock.calls) {
      const config = call[1] as Record<string, unknown>;
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('scope');
      expect(config).toHaveProperty('parameters');
      expect(config).toHaveProperty('handler');
      expect(typeof config.handler).toBe('function');
    }
  });

  it('should register login and logout handlers', () => {
    expect(mockSite.login).toHaveBeenCalledTimes(1);
    expect(mockSite.logout).toHaveBeenCalledTimes(1);
  });

  describe('login command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('login');
      await expect(handler({}, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面');
    });

    function loggedInPage() {
      const page = createMockPage();
      page.state.url = 'https://juejin.cn/';
      page.locator = vi.fn(() => ({
        first: vi.fn(() => ({
          isVisible: vi.fn(() => Promise.resolve(true)),
          click: vi.fn(() => Promise.resolve()),
          fill: vi.fn(() => Promise.resolve()),
        })),
        filter: vi.fn(() => ({ count: vi.fn(async () => 0) })),
      }));
      return page;
    }

    it('resolves without handing off when Juejin is already logged in', async () => {
      const handler = getHandler('login');
      const page = loggedInPage();
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx);
      expect(result.data).toEqual({ loggedIn: true, url: 'https://juejin.cn/' });
      expect(tipsMessages(result.tips).some((t: string) => t.includes('已是登录状态'))).toBe(true);
      expect(ctx.waitForHuman).not.toHaveBeenCalled();
      expect(page.goto).toHaveBeenCalledTimes(1);
      expect(page.goto).toHaveBeenCalledWith(
        'https://juejin.cn/',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
      expect(ctx.storage.set).toHaveBeenCalledWith(
        'juejin_login',
        expect.objectContaining({ loggedIn: true })
      );
    });

    it('opens the login page and rejects with NEEDS_HUMAN when logged out', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      ctx.waitForHuman = vi.fn(() =>
        Promise.reject(new HumanWaitRequiredError('需要人工协助', '完成掘金登录')));
      await expect(handler({}, ctx)).rejects.toBeInstanceOf(HumanWaitRequiredError);
      expect(page.goto.mock.calls.map((c: unknown[]) => c[0])).toEqual([
        'https://juejin.cn/',
        'https://juejin.cn/login',
      ]);
      expect(ctx.waitForHuman).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('掘金') })
      );
      expect(ctx.storage.set).not.toHaveBeenCalled();
    });

    it('refuses to store login state when a returned handoff still has no session', async () => {
      const handler = getHandler('login');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await expect(handler({}, ctx)).rejects.toThrow('仍未检测到登录态');
      expect(page.goto.mock.calls.map((c: unknown[]) => c[0])).toEqual([
        'https://juejin.cn/',
        'https://juejin.cn/login',
        'https://juejin.cn/',
      ]);
      expect(ctx.storage.set).not.toHaveBeenCalled();
    });

    it('should return success tip when logged in', async () => {
      const handler = getHandler('login');
      const page = loggedInPage();
      let checkCount = 0;
      page.locator = vi.fn(() => ({
        first: vi.fn(() => ({
          isVisible: vi.fn(() => Promise.resolve(++checkCount >= 2)),
          click: vi.fn(() => Promise.resolve()),
          fill: vi.fn(() => Promise.resolve()),
        })),
        filter: vi.fn(() => ({ count: vi.fn(async () => 0) })),
      }));
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx);
      expect(result.data.loggedIn).toBe(true);
      const tips = tipsMessages(result.tips);
      expect(tips.some((t: string) => t.includes('掘金登录成功'))).toBe(true);
    });
  });

  describe('publish command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('publish');
      await expect(handler({ title: 'T', content: 'C' }, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面');
    });

    it('should navigate to editor page', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'My Guide', content: '# Hello' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://juejin.cn/editor/drafts/new',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    }, 15000);

    it('should return fail when neither content nor file provided', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'T' }, ctx);
      expect(result.success).toBe(false);
      expect(result.message).toContain('必须提供');
    });

    it('should return title and tags in data on success', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'My Post', content: 'body', tags: 'webdev' }, ctx);
      expect(result.success).toBe(true);
      expect(result.data.title).toBe('My Post');
      expect(result.data.tags).toBe('webdev');
      expect(result.data.url).toBeDefined();
    }, 15000);

    it('should include publish tip on success', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'Test', content: 'body' }, ctx);
      if (result.success) {
        expect(tipsMessages(result.tips).some((t: string) => t.includes('Test') && t.includes('掘金'))).toBe(true);
      }
    }, 15000);

    it('should close page by default on success', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'T', content: 'C' }, ctx);
      if (result.success) {
        expect(page.close).toHaveBeenCalled();
      }
    }, 15000);

    it('should keep page alive when keepAlive is true', async () => {
      const handler = getHandler('publish');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'T', content: 'C', keepAlive: true }, ctx);
      if (result.success) {
        expect(page.close).not.toHaveBeenCalled();
      }
    }, 15000);
  });

  describe('draft command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('draft');
      await expect(handler({ title: 'T', content: 'C' }, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面');
    });

    it('should navigate to editor page', async () => {
      const handler = getHandler('draft');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ title: 'Draft', content: 'Content' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://juejin.cn/editor/drafts/new',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    }, 15000);

    it('should return saved as true on success', async () => {
      const handler = getHandler('draft');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'My Draft', content: 'content' }, ctx);
      if (result.success) {
        expect(result.data.saved).toBe(true);
        expect(result.data.title).toBe('My Draft');
      }
    }, 15000);

    it('should include draft saved tip on success', async () => {
      const handler = getHandler('draft');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'Draft Title', content: 'c' }, ctx);
      if (result.success) {
        expect(tipsMessages(result.tips).some((t: string) => t.includes('Draft Title') && t.includes('草稿'))).toBe(true);
      }
    }, 15000);
  });

  // ── ERR-20261022-002：draft/publish 重试不幂等（标题两股流叠加、正文 0 字、
  //    超时不上报已建草稿）──
  describe('draft/publish retry idempotency (ERR-20261022-002)', () => {
    it('draft: title typed at most once across retries and never appended', async () => {
      const handler = getHandler('draft');
      const page = createMockPage({ titleVisible: true });
      const ctx = createMockCtx(page);
      const params = { title: '跨域穿透验证', content: '# 正文' };
      await handler(params, ctx);   // 第一次尝试
      await handler(params, ctx);   // 盲目重跑（超时后的典型动作）
      expect(page.state.titleValue).toBe('跨域穿透验证');          // 没有叠成两份
      expect(page.titlePresses.length).toBe('跨域穿透验证'.length); // 只输入过一次
    }, 15000);

    it('draft: residual differing title is cleared and typed once (never appended)', async () => {
      const handler = getHandler('draft');
      const page = createMockPage({ titleVisible: true, titleValue: '旧的残留标题' });
      const result = await handler({ title: '新标题', content: '# 内容' }, createMockCtx(page));
      expect(result.success).toBe(true);
      expect(page.state.titleValue).toBe('新标题');
      expect(page.state.titleValue).not.toBe('旧的残留标题新标题');
    }, 15000);

    it('draft: body never doubles on retry (CodeMirror setValue replaces, second run skips)', async () => {
      const handler = getHandler('draft');
      const page = createMockPage({ titleVisible: true });
      const ctx = createMockCtx(page);
      const params = { title: 'T', content: '# 只写一次' };
      await handler(params, ctx);
      await handler(params, ctx);
      expect(page.state.bodyValue).toBe('# 只写一次');
      const setValueCalls = page.evaluate.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .filter((e: string) => e.includes('CodeMirror.setValue'));
      expect(setValueCalls.length).toBe(1); // 第二次读到内容已就位 → 跳过
    }, 15000);

    it('draft: 0-char body write is a hard failure, not a silent success', async () => {
      const handler = getHandler('draft');
      const page = createMockPage({ editorMode: 'none' });
      const result = await handler({ title: 'T', content: '# 内容' }, createMockCtx(page));
      expect(result.success).toBe(false);
      expect(result.message).toContain('正文编辑器未找到');
    }, 15000);

    it('draft: body read-back beyond 1.5x expected is rejected as duplicate write', async () => {
      const handler = getHandler('draft');
      const page = createMockPage({ writeResultLen: 999 });
      const result = await handler({ title: 'T', content: '# 内容' }, createMockCtx(page));
      expect(result.success).toBe(false);
      expect(result.message).toContain('重复写入');
    }, 15000);

    it('draft: contradictory title read-back (interleaved streams) is detected', async () => {
      const handler = getHandler('draft');
      const page = createMockPage({ titleVisible: true, titleReadOverride: '另一股流写入的值' });
      const result = await handler({ title: '正确标题', content: '# 内容' }, createMockCtx(page));
      expect(result.success).toBe(false);
      expect(result.message).toContain('输入校验失败');
    }, 15000);

    it('draft: when keystrokes cannot reach the page, the title is written through fill instead', async () => {
      const handler = getHandler('draft');
      const page = createMockPage({ titleVisible: true, keystrokesDropped: true });
      const result = await handler({ title: '后台草稿', content: '# 内容' }, createMockCtx(page));
      expect(result.success).toBe(true);
      expect(page.state.titleValue).toBe('后台草稿');
      expect(page.titlePresses).toEqual([]); // 没有一个按键被当作已送达
    }, 15000);

    it('draft: another typing error is not masked by the fill fallback', async () => {
      const handler = getHandler('draft');
      const page = createMockPage({ titleVisible: true, pressError: 'element is not visible' });
      const result = await handler({ title: 'T', content: '# 内容' }, createMockCtx(page));
      expect(result.success).toBe(false);
      expect(result.message).toContain('element is not visible');
    }, 15000);

    it('draft: reports the observed draft (URL/ID) when a later step fails', async () => {
      const handler = getHandler('draft');
      const page = createMockPage({
        titleVisible: true,
        url: 'https://juejin.cn/editor/drafts/7699014849130004531',
        failBodyWrite: true,
      });
      const result = await handler({ title: 'T', content: '# 内容' }, createMockCtx(page));
      expect(result.success).toBe(false);
      const tips = tipsMessages(result.tips).join('\n');
      expect(tips).toContain('7699014849130004531');
      expect(tips).toContain('https://juejin.cn/editor/drafts/7699014849130004531');
      expect(tips).toContain('勿盲目重跑');
    }, 15000);

    it('draft: success returns observed draftId/draftUrl when the URL lands on the draft', async () => {
      const handler = getHandler('draft');
      const page = createMockPage({
        titleVisible: true,
        url: 'https://juejin.cn/editor/drafts/7699014849130004531',
      });
      const result = await handler({ title: 'T', content: '# 内容' }, createMockCtx(page));
      expect(result.success).toBe(true);
      expect(result.data.draftId).toBe('7699014849130004531');
      expect(result.data.draftUrl).toBe('https://juejin.cn/editor/drafts/7699014849130004531');
    }, 15000);

    it('draft: when the save confirmation never arrives, saved stays true and no draftId is claimed', async () => {
      const handler = getHandler('draft');
      const page = createMockPage({ titleVisible: true });
      const result = await handler({ title: 'T', content: '# 内容' }, createMockCtx(page));
      expect(result.success).toBe(true);
      expect(result.data.saved).toBe(true);
      expect(result.data.draftId).toBeUndefined();
      expect(tipsMessages(result.tips).some((t: string) => t.includes('未观测到草稿 URL'))).toBe(true);
    }, 15000);

    it('publish: later-step failure reports the observed draft instead of a bare error', async () => {
      const handler = getHandler('publish');
      const page = createMockPage({
        titleVisible: true,
        url: 'https://juejin.cn/editor/drafts/7699014849130004531',
        publishVisible: true,
      });
      const ctx = createMockCtx(page);
      const result = await handler({ title: 'T', content: 'C' }, ctx);
      expect(result.success).toBe(false);
      expect(tipsMessages(result.tips).join('\n')).toContain('7699014849130004531');
    }, 15000);

    it('publish: field editor body is inserted once across retries (insertText never appends)', async () => {
      const handler = getHandler('publish');
      const page = createMockPage({ titleVisible: true, editorMode: 'field' });
      const ctx = createMockCtx(page);
      const params = { title: 'T', content: 'C'.repeat(120) };
      await handler(params, ctx);
      await handler(params, ctx);
      expect(page.state.bodyValue).toBe('C'.repeat(120));
      expect(page.keyboard.insertText).toHaveBeenCalledTimes(1);
    }, 15000);

    it('publish: residual field body is select-all replaced, not appended', async () => {
      const handler = getHandler('publish');
      const page = createMockPage({ titleVisible: true, editorMode: 'field', bodyValue: '旧的正文' });
      const result = await handler({ title: 'T', content: '# 新内容' }, createMockCtx(page));
      expect(result.success).toBe(true);
      expect(page.state.bodyValue).toBe('# 新内容');
      expect(page.state.bodyValue).not.toBe('旧的正文# 新内容');
    }, 15000);
  });

  describe('update-profile command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('update-profile');
      await expect(handler({ url: 'https://example.com' }, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面');
    });

    it('should navigate to settings page', async () => {
      const handler = getHandler('update-profile');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({ url: 'https://example.com' }, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://juejin.cn/user/settings/profile',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    }, 15000);

    it('should return url and updated in data', async () => {
      const handler = getHandler('update-profile');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ url: 'https://example.com' }, ctx);
      expect(result.data.url).toBe('https://example.com');
      expect(result.data.updated).toBe(true);
    }, 15000);

    it('should include profile update tip', async () => {
      const handler = getHandler('update-profile');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ url: 'https://example.com' }, ctx);
      expect(tipsMessages(result.tips).some((t: string) => t.includes('Profile'))).toBe(true);
    }, 15000);

    it('should handle bio parameter', async () => {
      const handler = getHandler('update-profile');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      const result = await handler({ url: 'https://example.com', bio: 'Developer' }, ctx);
      expect(result.data.updated).toBe(true);
    }, 15000);
  });

  describe('fetch-articles command', () => {
    it('should throw when no page in context', async () => {
      const handler = getHandler('fetch-articles');
      await expect(handler({}, { storage: { set: vi.fn() } })).rejects.toThrow('需要浏览器页面');
    });

    it('should navigate to user center articles page', async () => {
      const handler = getHandler('fetch-articles');
      const page = createMockPage();
      const ctx = createMockCtx(page);
      await handler({}, ctx);
      expect(page.goto).toHaveBeenCalledWith(
        'https://juejin.cn/user/center/articles',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      );
    }, 15000);

    it('should return articles array from evaluate', async () => {
      const handler = getHandler('fetch-articles');
      const page = createMockPage();
      page.evaluate = vi.fn((_fn: unknown, _arg?: unknown): Promise<unknown> => Promise.resolve([
        { title: 'Post 1', url: '/post/1', views: '100', likes: '5', comments: '2', date: '2026-01-01' },
      ]));
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data[0].title).toBe('Post 1');
    }, 15000);

    it('should return count tip with article number', async () => {
      const handler = getHandler('fetch-articles');
      const page = createMockPage();
      page.evaluate = vi.fn((_fn: unknown, _arg?: unknown): Promise<unknown> => Promise.resolve([{ title: 'P1', url: '/1', views: '10', likes: '1', comments: '0', date: '2026-01-01' }]));
      const ctx = createMockCtx(page);
      const result = await handler({}, ctx);
      expect(tipsMessages(result.tips).some((t: string) => t.includes('1 篇'))).toBe(true);
    }, 15000);
  });

  it('upload-image takes --path as the canonical argument and keeps --image as a deprecated alias', () => {
    const cfg = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === 'upload-image')![1] as {
      parameters: { safeParse: (v: unknown) => { success: boolean } };
    };
    expect(cfg.parameters.safeParse({ path: '/abs/cover.png' }).success).toBe(true);
    expect(cfg.parameters.safeParse({ image: '/abs/cover.png' }).success).toBe(true);
    expect(cfg.parameters.safeParse({}).success).toBe(false);
  });

  it('login hook should set storage', async () => {
    const loginFn = mockSite.login.mock.calls[0][0] as Function;
    const storage = { set: vi.fn(), get: vi.fn(), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() };
    const page = createMockPage();
    await loginFn({ page, storage });
    expect(storage.set).toHaveBeenCalledWith('juejin_login', expect.objectContaining({ at: expect.any(Number) }));
  });

  it('logout hook should delete login storage', async () => {
    const logoutFn = mockSite.logout.mock.calls[0][0] as Function;
    const storage = { set: vi.fn(), get: vi.fn(), delete: vi.fn(), keys: vi.fn(() => []), clear: vi.fn() };
    await logoutFn({ storage });
    expect(storage.delete).toHaveBeenCalledWith('juejin_login');
  });
});

import { randomPause } from '../../.xcli/plugins/shared/humanize.js';

describe('humanize production default (P1-4 guard)', () => {
  it('default sleeper performs a real timed delay', async () => {
    __setHumanizeSleeperForTests(); // restore production default
    const start = Date.now();
    await randomPause(30, 30);
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });
});
