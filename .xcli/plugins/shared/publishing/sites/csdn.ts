/**
 * CSDN 编辑器协议。
 *
 * 实战验证（2026-10-22，articleId 168773369 已发布）。
 *
 * 结构
 * ----
 * - MD 编辑器：`https://editor.csdn.net/md/?not_checkout=1`
 * - 正文：`<pre class="editor__inner">` —— **必须走 ClipboardEvent paste**
 *   （`pre` 是 CodeMirror 的只读渲染层，直接写 innerText 会被 reconciliation
 *   回流清空）
 * - 标题：`.article-bar__title`
 * - 发布：`button` 文本「发布文章」→ 弹窗（标签 / 摘要 / 原创声明）→ 确认
 */

import type { PageAdapter, SitePublisher } from '../channel.js';
import { sleep, waitFor } from '../bridge.js';

export const CSDN_EDITOR_URL = 'https://editor.csdn.net/md/?not_checkout=1';

export const csdnPublisher: SitePublisher = {
  site: 'csdn',

  async open(adapter: PageAdapter): Promise<void> {
    await waitFor(async () => {
      const ready = await adapter.evaluate<boolean>(`(function(){
        return !!document.querySelector('pre.editor__inner');
      })()`);
      return ready ? true : null;
    }, { timeout: 20000, interval: 500 });
  },

  async setTitle(adapter: PageAdapter, title: string): Promise<void> {
    const ok = await adapter.evaluate<boolean>(`(function(){
      var e = document.querySelector('.article-bar__title') ||
        Array.prototype.slice.call(document.querySelectorAll('input'))
          .filter(function(i){ return (i.placeholder||'').indexOf('标题') >= 0; })[0];
      if (!e) return false;
      e.focus();
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(e, ${JSON.stringify(title)});
      e.dispatchEvent(new Event('input', { bubbles: true }));
      return e.value.length > 0;
    })()`);
    if (!ok) throw new Error('CSDN 标题输入框未找到');
  },

  async setBody(adapter: PageAdapter, markdown: string): Promise<void> {
    // PRE paste 管线：CodeMirror 只接受 paste 事件，写 innerText 会被清空
    const len = await adapter.evaluate<number | null>(`(async function(){
      var pre = document.querySelector('pre.editor__inner');
      if (!pre) return null;
      pre.focus();
      var dt = new DataTransfer();
      dt.setData('text/plain', ${JSON.stringify(markdown)});
      pre.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await new Promise(function(r){ setTimeout(r, 1500); });
      return (pre.textContent || '').length;
    })()`);
    if (len === null) throw new Error('CSDN MD 编辑器未找到（pre.editor__inner）');
    if (len < 100) throw new Error(`CSDN 正文写入异常（${len} 字符）——paste 未被 CodeMirror 接收`);
  },

  async publish(
    adapter: PageAdapter,
    options: { summary?: string; tags?: string[]; original?: boolean } = {},
  ): Promise<{ published: boolean; url?: string; note?: string }> {
    // 1) 点「发布文章」→ 弹窗
    await adapter.evaluate(`(function(){ window.scrollTo(0, 0); return 'ok'; })()`);
    await sleep(400);
    const opened = await adapter.clickByText({ text: '发布文章', requireViewport: false });
    if (!opened) throw new Error('CSDN「发布文章」按钮未找到');

    await sleep(1500);

    // 2) 摘要（弹窗内的 textarea）
    if (options.summary) {
      await adapter.evaluate(`(function(){
        var tas = Array.prototype.slice.call(document.querySelectorAll('textarea')).filter(function(e){
          var r = e.getBoundingClientRect();
          return r.width > 200 && r.height > 30;
        });
        if (!tas.length) return 'no-summary';
        var ta = tas[0];
        ta.focus();
        var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, ${JSON.stringify(options.summary)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        return 'summary-set';
      })()`);
      await sleep(500);
    }

    // 3) 原创声明
    if (options.original) {
      await adapter.clickByText({ text: '原创', requireViewport: false });
      await sleep(400);
    }

    // 4) 确认发布
    const confirm = await adapter.locateByText({
      text: '发布文章',
      exact: true,
      requireViewport: false,
    });
    if (confirm) {
      await adapter.clickAt(confirm.x, confirm.y);
    }

    const url = await waitFor(async () => {
      const href = await adapter.evaluate<string>('location.href');
      return href && /csdn\.net\/.*article\/details\//.test(href) ? href : null;
    }, { timeout: 25000, interval: 500 });

    const articleId = url.match(/details\/(\d+)/)?.[1];
    return { published: true, url, note: articleId ? `文章 ID ${articleId}（审核中）` : undefined };
  },
};
