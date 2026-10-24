import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  BridgePageAdapter,
  LocalPageAdapter,
  resolveChannel,
  releaseChannel,
} from '../../.xcli/plugins/shared/publishing/channel.js';
import { ctoPublisher } from '../../.xcli/plugins/shared/publishing/sites/51cto.js';
import { cnbPublisher } from '../../.xcli/plugins/shared/publishing/sites/cnblogs.js';
import { oscPublisher } from '../../.xcli/plugins/shared/publishing/sites/oschina.js';

/** 造一个可控的 PageAdapter 替身，记录所有求值表达式与点击 */
function createAdapter(initial: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = { ...initial };
  const expressions: string[] = [];
  const clicks: Array<{ x: number; y: number }> = [];
  const texts: Array<{ text: string; scope?: string; exact?: boolean }> = [];
  const locations: Array<{ text: string; scope?: string; exact?: boolean }> = [];
  const inserted: string[] = [];
  const selectors: string[] = [];
  const iframeCalls: string[] = [];

  const adapter = {
    channel: 'local' as const,
    async evaluate<T = unknown>(expression: string): Promise<T> {
      expressions.push(expression);
      // 按调用方注入的匹配器返回（先匹配更具体的）
      for (const [pattern, value] of Object.entries(state)) {
        if (expression.includes(pattern)) return value as T;
      }
      // 等待类探测（编辑器就绪 / 面板出现）默认就绪
      if (/querySelectorAll\('\[contenteditable=true\]'\)/.test(expression)) return true as T;
      if (/querySelectorAll\('textarea'\)/.test(expression)) return true as T;
      if (/\.ant-popover-inner/.test(expression)) return true as T;
      if (/getBoundingClientRect/.test(expression) && /\.tiptap/.test(expression)) return true as T;
      // 写值类表达式（setter / title / editor）默认成功
      if (/Object\.getOwnPropertyDescriptor/.test(expression)) return true as T;
      if (/input\.editor-title|#post-title|请输入文章标题/.test(expression)) return true as T;
      return undefined as T;
    },
    async clickAt(x: number, y: number): Promise<void> {
      clicks.push({ x, y });
    },
    async url(): Promise<string> {
      return (state.__url as string) ?? 'https://example.com';
    },
    async locateByText(options: { text: string | RegExp; scope?: string; exact?: boolean }) {
      locations.push({ text: String(options.text), scope: options.scope, exact: options.exact });
      // 注入 __points: { '发布': {x,y} } 形式按文本匹配
      const points = (state.__points ?? {}) as Record<string, { x: number; y: number }>;
      const key = Object.keys(points).find((k) => String(options.text).includes(k));
      if (key) return points[key];
      return (state.__point as { x: number; y: number } | null) ?? null;
    },
    async clickByText(options: { text: string | RegExp; scope?: string; exact?: boolean }) {
      texts.push({ text: String(options.text), scope: options.scope, exact: options.exact });
      return state.__clickOk !== false;
    },
    async waitReady(): Promise<boolean> {
      return true;
    },
    async insertText(text: string): Promise<void> {
      inserted.push(text);
    },
    async clickSelector(selector: string): Promise<boolean> {
      selectors.push(selector);
      return state.__clickOk !== false;
    },
    async bringToFront(): Promise<void> {
      /* 本地通道无前台概念 */
    },
    async evaluateInIframe<T>(iframeSelector: string, _expression: string): Promise<T> {
      iframeCalls.push(iframeSelector);
      return (state.__iframeResult ?? null) as T;
    },
  };
  return { adapter, state, expressions, clicks, texts, locations, inserted, selectors, iframeCalls };
}

/**
 * 测试隔离：真实机器上 chrome-bridge 可能在线，会让通道解析走 bridge 分支。
 * 每个用例结束后恢复真实 fetch。
 */
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('publishing/channel', () => {
  describe('LocalPageAdapter', () => {
    it('evaluate 透传到 page.evaluate', async () => {
      const page = { evaluate: vi.fn(async () => 42), url: vi.fn(() => 'u') };
      const adapter = new LocalPageAdapter(page as never);
      await expect(adapter.evaluate('1+1')).resolves.toBe(42);
      expect(page.evaluate).toHaveBeenCalledWith('1+1');
    });

    it('clickAt 优先用 page.mouse.click（可信事件）', async () => {
      const click = vi.fn(async () => {});
      const page = { evaluate: vi.fn(), url: vi.fn(() => 'u'), mouse: { click } };
      const adapter = new LocalPageAdapter(page as never);
      await adapter.clickAt(10, 20);
      expect(click).toHaveBeenCalledWith(10, 20);
      expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('channel 标记为 local', () => {
      const adapter = new LocalPageAdapter({ evaluate: vi.fn(), url: vi.fn() } as never);
      expect(adapter.channel).toBe('local');
    });
  });

  describe('BridgePageAdapter', () => {
    it('evaluate 走 bridge evaluate 命令并取 value', async () => {
      const call = vi.fn(async () => ({ value: 'ok' }));
      const adapter = new BridgePageAdapter({ call }, 42);
      await expect(adapter.evaluate('x')).resolves.toBe('ok');
      expect(call).toHaveBeenCalledWith('evaluate', { expression: 'x', tabId: 42 });
    });

    it('channel 标记为 bridge', () => {
      const adapter = new BridgePageAdapter({ call: vi.fn() }, 1);
      expect(adapter.channel).toBe('bridge');
    });
  });

  describe('resolveChannel', () => {

    it('bridge 不可用且无 page 时提示需要浏览器页面', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as never;
      await expect(
        resolveChannel({ taskName: 'pub-x', localUrl: 'https://x.com' }),
      ).rejects.toThrow('需要浏览器页面');
    });

    it('bridge 不可用但有 page 时回退 local 通道', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as never;
      const goto = vi.fn(async () => {});
      const page = { goto, evaluate: vi.fn(), url: vi.fn(() => 'u') };
      const res = await resolveChannel({
        page: page as never,
        taskName: 'pub-x',
        localUrl: 'https://x.com',
      });
      expect(res.channel).toBe('local');
      expect(goto).toHaveBeenCalledWith('https://x.com', expect.objectContaining({ waitUntil: 'domcontentloaded' }));
    });

    it('bridge 可用时走 bridge 通道并打开任务分组 tab', async () => {
      globalThis.fetch = vi.fn(async (_url: unknown, init: unknown) => {
        const body = JSON.parse((init as { body: string }).body) as { cmd: string };
        // evaluate 是窗口守卫（checkWindowReady）在 task-open 之后发的探针
        let data: unknown = [];
        if (body.cmd === 'task-open') data = { tabId: 999 };
        else if (body.cmd === 'evaluate') data = { value: JSON.stringify({ ow: 900, oh: 640 }) };
        return Promise.resolve({ json: async () => ({ ok: true, data }) });
      }) as never;
      const res = await resolveChannel({
        taskName: 'pub-51cto',
        localUrl: 'https://blog.51cto.com/blogger/publish',
      });
      expect(res.channel).toBe('bridge');
      expect(res.taskName).toBe('pub-51cto');
      expect(res.adapter.channel).toBe('bridge');
      await releaseChannel(res);
    });
  });
});

describe('publishing/sites 协议', () => {
  describe('51CTO', () => {
    it('setTitle 写进 input.editor-title', async () => {
      const { adapter, expressions } = createAdapter();
      await ctoPublisher.setTitle(adapter, '标题');
      const expr = expressions.join('\n');
      expect(expr).toContain('input.editor-title');
      expect(expr).toContain('标题');
    });

    it('setBody 走 innerHTML 注入且校验 &gt; 残留', async () => {
      const { adapter, expressions } = createAdapter({
        'ce.querySelectorAll': { len: 500, imgs: 1, gt: 0 },
      });
      await ctoPublisher.setBody(adapter, '# 标题\n\n正文');
      expect(expressions.join('\n')).toContain('innerHTML');
    });

    it('setBody 在正文过短时抛错', async () => {
      const { adapter } = createAdapter({ 'ce.querySelectorAll': { len: 10, imgs: 0, gt: 0 } });
      await expect(ctoPublisher.setBody(adapter, '短')).rejects.toThrow(/写入异常/);
    });

    it('setBody 在存在未转义尖括号时抛错', async () => {
      const { adapter } = createAdapter({ 'ce.querySelectorAll': { len: 500, imgs: 0, gt: 3 } });
      await expect(ctoPublisher.setBody(adapter, 'x')).rejects.toThrow(/未正确转义/);
    });

    it('publish 先点「发布文章」再选分类再填摘要', async () => {
      const { adapter, texts, expressions } = createAdapter({
        'ta = tas[0]': 120,
        'location.href': 'https://blog.51cto.com/blogger/success/15029381',
        __points: { '发布': { x: 1845, y: 862 } },
      });
      const res = await ctoPublisher.publish(adapter, {
        category: '自动化 Agent',
        summary: '摘要内容',
      });
      expect(texts[0]?.text).toContain('发布文章');
      expect(texts.some((t) => t.text.includes('自动化 Agent'))).toBe(true);
      expect(expressions.join('\n')).toContain('摘要');
      expect(res.published).toBe(true);
      expect(res.url).toContain('/blogger/success/15029381');
    });
  });

  describe('博客园', () => {
    it('setBody 写进 #md-editor（Markdown 源码模式，不需要 HTML 转换）', async () => {
      const { adapter, expressions } = createAdapter({ 'ta.value.length': 1200 });
      await cnbPublisher.setBody(adapter, '# 标题\n\n正文');
      const expr = expressions.join('\n');
      expect(expr).toContain('#md-editor');
      expect(expr).not.toContain('innerHTML');
    });

    it('setTitle 写进 #post-title', async () => {
      const { adapter, expressions } = createAdapter();
      await cnbPublisher.setTitle(adapter, '标题');
      expect(expressions.join('\n')).toContain('#post-title');
    });

    it('publish 选分类用 prototype setter（label 被 sticky 遮挡的兜底）', async () => {
      const { adapter, expressions } = createAdapter({
        'desc.set.call': true,
        'location.href': 'https://i.cnblogs.com/posts/edit-done;postId=23405420;isPublished=true',
        __points: { '发布草稿': { x: 268, y: 775 } },
      });
      const res = await cnbPublisher.publish(adapter, { category: '其他技术区', summary: '摘要' });
      const expr = expressions.join('\n');
      expect(expr).toContain('site-cate-selector');
      expect(expr).toContain('其他技术区');
      expect(res.published).toBe(true);
      expect(res.note).toContain('23405420');
    });
  });

  describe('OSChina', () => {
    it('setBody 必须用 editor.commands.clearContent + setContent', async () => {
      const { adapter, expressions } = createAdapter({
        'ce.editor': { len: 900, imgs: 1, gt: 0 },
      });
      await oscPublisher.setBody(adapter, '# 标题\n\n正文');
      const expr = expressions.join('\n');
      expect(expr).toContain('clearContent(true)');
      expect(expr).toContain('setContent');
    });

    it('setBody 在编辑器实例缺失时抛错', async () => {
      const { adapter } = createAdapter({ 'ce.editor': null });
      await expect(oscPublisher.setBody(adapter, 'x')).rejects.toThrow(/Tiptap 实例缺失/);
    });

    it('publish 选「原创」并点「确定并发布」', async () => {
      const { adapter, texts, locations, expressions } = createAdapter({
        'desc.set.call': true,
        'location.href': 'https://my.oschina.net/u/1998814/blog/19781123',
        __points: { '确定并发布': { x: 1774, y: 524 } },
      });
      const res = await oscPublisher.publish(adapter, { source: '原创' });
      expect(expressions.join('\n')).toContain('原创');
      expect(locations.some((l) => l.text.includes('确定并发布'))).toBe(true);
      expect(texts[0]?.text).toContain('发布文章');
      expect(res.published).toBe(true);
      expect(res.url).toContain('/blog/19781123');
    });
  });
});
