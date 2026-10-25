import { describe, it, expect, vi } from 'vitest';
import { bloggerPublisher, BLOGGER_BODY_IFRAME } from '../../.xcli/plugins/shared/publishing/sites/blogger.js';
import type { PageAdapter } from '../../.xcli/plugins/shared/publishing/channel.js';

/**
 * Blogger 协议的契约测试。
 *
 * 重点钉住三处实战踩过的坑：
 * 1. 「新建博文」必须点 `role=button` 那一层（外层包裹点了没反应）
 * 2. 正文在 `iframe.editable` 的同源 iframe 里，不在宿主文档
 * 3. 正文写入后要过双份粘贴防护（ERR-20261024-001）
 */

interface AdapterStub {
  adapter: PageAdapter;
  evaluate: ReturnType<typeof vi.fn>;
  evaluateInIframe: ReturnType<typeof vi.fn>;
  clickAt: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
  insertText: ReturnType<typeof vi.fn>;
  bringToFront: ReturnType<typeof vi.fn>;
}

function createAdapter(opts: {
  url?: string;
  evaluateResults?: Array<string | null>;
  iframeResults?: Array<string | null>;
}): AdapterStub {
  const url = vi.fn(async () => opts.url ?? 'https://www.blogger.com/blog/posts/853616507140647199');
  const evaluate = vi.fn();
  for (const r of opts.evaluateResults ?? []) evaluate.mockResolvedValueOnce(r);
  const evaluateInIframe = vi.fn();
  for (const r of opts.iframeResults ?? []) evaluateInIframe.mockResolvedValueOnce(r);
  const clickAt = vi.fn(async () => undefined);
  const insertText = vi.fn(async () => undefined);
  const bringToFront = vi.fn(async () => undefined);

  const adapter = {
    channel: 'bridge' as const,
    evaluate,
    evaluateInIframe,
    clickAt,
    url,
    insertText,
    locateByText: vi.fn(),
    clickByText: vi.fn(),
    waitReady: vi.fn(async () => true),
    clickSelector: vi.fn(),
    bringToFront,
  } as unknown as PageAdapter;

  return { adapter, evaluate, evaluateInIframe, clickAt, url, insertText, bringToFront };
}

describe('bloggerPublisher', () => {
  it('declares site = blogger', () => {
    expect(bloggerPublisher.site).toBe('blogger');
  });

  it('uses iframe.editable as the body iframe', () => {
    expect(BLOGGER_BODY_IFRAME).toBe('iframe.editable');
  });

  describe('open', () => {
    it('skips creating a post when already in the editor', async () => {
      const { adapter, clickAt, evaluateInIframe } = createAdapter({
        url: 'https://www.blogger.com/blog/post/edit/853616507140647199/123',
        iframeResults: ['true'],
      });
      await bloggerPublisher.open(adapter);
      // 已在编辑器里 → 不该再点「新建博文」
      expect(clickAt).not.toHaveBeenCalled();
      expect(evaluateInIframe).toHaveBeenCalled();
    });

    it('throws when no blogId can be determined', async () => {
      const { adapter } = createAdapter({ url: 'https://www.blogger.com/home' });
      await expect(bloggerPublisher.open(adapter)).rejects.toThrow(/blogId/);
    });

    it('throws when the new-post button is missing', async () => {
      const { adapter } = createAdapter({
        url: 'https://www.blogger.com/blog/posts/853616507140647199',
        evaluateResults: [null],
      });
      await expect(bloggerPublisher.open(adapter)).rejects.toThrow(/新建博文/);
    });

    it('clicks the role=button layer (not the jsname wrapper)', async () => {
      // 点击前是列表页，点击后变编辑器——按"已点过"切换，不按调用次数
      let clicked = false;
      const stub = createAdapter({
        url: 'https://www.blogger.com/blog/posts/853616507140647199',
        evaluateResults: [JSON.stringify({ x: 81, y: 152 })],
      });
      stub.adapter.url = vi.fn(async () => (
        clicked
          ? 'https://www.blogger.com/blog/post/edit/853616507140647199/9'
          : 'https://www.blogger.com/blog/posts/853616507140647199'
      ));
      const origClick = stub.clickAt.getMockImplementation()!;
      stub.clickAt.mockImplementation(async (x: number, y: number) => {
        clicked = true;
        return origClick(x, y);
      });
      // 点击后进入编辑器：编辑器特征探测返回体/标题命中
      const origEval = stub.evaluate.getMockImplementation()!;
      stub.evaluate.mockImplementation(async (expr: string) => {
        // open() 的「进入编辑器」探测：查 iframe.editable + 标题 input
        if (expr.includes('iframe.editable') && expr.includes('aria-label')) {
          return JSON.stringify({ url: clicked, body: clicked, title: clicked });
        }
        return origEval(expr);
      });
      (stub.adapter as unknown as { evaluateInIframe: unknown }).evaluateInIframe = vi.fn(async () => 'true');

      await bloggerPublisher.open(stub.adapter);

      expect(stub.clickAt).toHaveBeenCalledWith(81, 152);
      const expr = String(stub.evaluate.mock.calls[0][0]);
      // 选择器必须带 aria-label，且要求 role=button
      expect(expr).toContain('div[role=button][aria-label="新建博文"]');
      // 必须过滤可见性（抽屉里那份 x 为负）
      expect(expr).toContain('r.x < 0');
      // 必须逐点做命中校验——只按 rect 中心点会点到 z-index 覆盖层
      expect(expr).toContain('elementFromPoint');
      expect(expr).toContain('e.contains(hit)');
    });
  });

  describe('setTitle', () => {
    it('writes via trusted insertText and verifies the value', async () => {
      const { adapter, evaluate, clickAt, insertText } = createAdapter({
        evaluateResults: [
          JSON.stringify({ x: 960, y: 485 }), // 定位
          '我的标题', // 回读
        ],
      });
      await bloggerPublisher.setTitle(adapter, '我的标题');
      expect(clickAt).toHaveBeenCalledWith(960, 485);
      expect(insertText).toHaveBeenCalledWith('我的标题');
      expect(String(evaluate.mock.calls[0][0])).toContain('aria-label') ;
    });

    it('throws when the written value does not match', async () => {
      const { adapter } = createAdapter({
        evaluateResults: [JSON.stringify({ x: 960, y: 485 }), ''],
      });
      await expect(bloggerPublisher.setTitle(adapter, '期望标题')).rejects.toThrow(/标题写入失败/);
    });
  });

  describe('setBody', () => {
    it('writes markdown into the iframe body and checks survival', async () => {
      const { adapter, evaluateInIframe } = createAdapter({
        iframeResults: [
          JSON.stringify({ chars: 120, tables: 0 }), // 写入
          JSON.stringify({ chars: 120, tables: 0 }), // 存活校验
        ],
      });
      await bloggerPublisher.setBody(adapter, '## 小标题\n\n正文内容');
      expect(evaluateInIframe).toHaveBeenCalledTimes(2);
      const firstExpr = String(evaluateInIframe.mock.calls[0][1]);
      // 原子三步：先清空再写，不能追加
      expect(firstExpr).toContain("b.innerHTML = ''");
      expect(firstExpr).toContain('dispatchEvent(new Event');
      // markdown 已被转换成 HTML
      expect(firstExpr).toContain('<h2>');
    });

    it('rejects when the content doubles (ERR-20261024-001 regression)', async () => {
      const { adapter } = createAdapter({
        iframeResults: [
          JSON.stringify({ chars: 100, tables: 0 }),
          JSON.stringify({ chars: 200, tables: 0 }), // 2 倍 → 触发防护
        ],
      });
      await expect(bloggerPublisher.setBody(adapter, '正文')).rejects.toThrow(/重复粘贴/);
    });

    it('rejects when the iframe content got wiped', async () => {
      const { adapter } = createAdapter({
        iframeResults: [
          JSON.stringify({ chars: 100, tables: 0 }),
          JSON.stringify({ chars: 3, tables: 0 }), // 被清空
        ],
      });
      await expect(bloggerPublisher.setBody(adapter, '正文')).rejects.toThrow(/被清空/);
    });

    it('rejects when the iframe is not accessible', async () => {
      const { adapter } = createAdapter({ iframeResults: [null] });
      await expect(bloggerPublisher.setBody(adapter, '正文')).rejects.toThrow(/iframe/);
    });

    it('rejects when the body is empty after write', async () => {
      const { adapter } = createAdapter({
        iframeResults: [JSON.stringify({ chars: 0, tables: 0 })],
      });
      await expect(bloggerPublisher.setBody(adapter, '正文')).rejects.toThrow(/内容为空/);
    });
  });

  describe('publish', () => {
    it('dry-run stops before clicking publish', async () => {
      const { adapter, clickAt } = createAdapter({
        url: 'https://www.blogger.com/blog/post/edit/1/2',
      });
      const result = await bloggerPublisher.publish(adapter, { dryRun: true });
      expect(result.published).toBe(false);
      expect(result.note).toContain('dry-run');
      expect(clickAt).not.toHaveBeenCalled();
    });

    it('throws when the publish button is missing', async () => {
      const { adapter } = createAdapter({ evaluateResults: [null] });
      await expect(bloggerPublisher.publish(adapter)).rejects.toThrow(/发布/);
    });

    it('clicks publish and reports success when the URL leaves the editor', async () => {
      const { adapter, clickAt } = createAdapter({
        evaluateResults: [JSON.stringify({ x: 1857, y: 473 })],
      });
      let calls = 0;
      adapter.url = vi.fn(async () => {
        calls++;
        return calls === 1
          ? 'https://www.blogger.com/blog/post/edit/1/2'
          : 'https://www.blogger.com/blog/posts/853616507140647199';
      });
      const result = await bloggerPublisher.publish(adapter);
      expect(clickAt).toHaveBeenCalledWith(1857, 473);
      expect(result.published).toBe(true);
    });
  });
});
