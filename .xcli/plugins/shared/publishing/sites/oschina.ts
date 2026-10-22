/**
 * 开源中国（OSChina）智写平台协议。
 *
 * 实战验证（2026-10-23，blog/19781123）：
 * - 编辑器：Tiptap / ProseMirror（`.tiptap.ProseMirror`），DOM 上挂 `editor` 实例
 * - **必须用 `editor.commands.clearContent(true)` 清空**——`execCommand('delete')`
 *   删不干净不可编辑包裹节点（`.aie-resize-wrapper` / `.aie-codeblock-wrapper`），
 *   会导致文章内容重复堆叠
 * - 填正文用 `editor.commands.setContent(html, true)`——`paste` 事件被 ProseMirror
 *   忽略（实测 paste 后内容为空）
 * - 标题：`input[placeholder*=标题]`
 * - 发布链：**两层**——顶栏 `button.publish-btn` 只负责弹出 Popconfirm，
 *   真正的提交是弹窗内「确定并发布」
 * - 弹窗必填：文章来源（原创/转载）、博客分类、权限设置（默认公开）
 * - 发布后跳 `my.oschina.net/u/<id>/blog/<blogId>`
 */

import type { PageAdapter, SitePublisher } from '../channel.js';
import { sleep, waitFor } from '../bridge.js';
import { markdownToHtml } from '../md-to-html.js';

export const OSC_EDITOR_URL = 'https://my.oschina.net/blog/ai-write';

/** OSChina 博客分类候选（账号已有分类） */
export const OSC_CATEGORIES = ['工作日志', '日常记录', '转贴的文章'] as const;

export const oscPublisher: SitePublisher = {
  site: 'oschina',

  async open(adapter: PageAdapter): Promise<void> {
    // 先快速探测一次：编辑器不存在时立刻失败，不等 20s 超时
    const immediate = await adapter.evaluate<boolean>(`(function(){
      var ce = document.querySelector('.tiptap.ProseMirror');
      return !!(ce && ce.editor);
    })()`);
    if (immediate) return;
    try {
      await waitFor(async () => {
        const ready = await adapter.evaluate<boolean>(`(function(){
          var ce = document.querySelector('.tiptap.ProseMirror');
          return !!ce && !!ce.editor;
        })()`);
        return ready ? true : null;
      }, { timeout: 15000, interval: 500 });
    } catch {
      throw new Error('OSChina 编辑器未挂载（Tiptap 实例缺失）——智写平台可能改了编辑器实现');
    }
  },

  async setTitle(adapter: PageAdapter, title: string): Promise<void> {
    const ok = await adapter.evaluate<boolean>(`(function(){
      var t = Array.prototype.slice.call(document.querySelectorAll('input'))
        .filter(function(e){ return e.placeholder && e.placeholder.indexOf('标题') >= 0; })[0];
      if (!t) return false;
      t.focus();
      var s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      s.call(t, ${JSON.stringify(title)});
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return t.value.length > 0;
    })()`);
    if (!ok) throw new Error('OSChina 标题输入框未找到');
  },

  async setBody(adapter: PageAdapter, markdown: string): Promise<void> {
    // 编辑器实例缺失时立刻失败（open() 的 waitFor 会先超时 20s，这里给明确诊断）
    const hasEditor = await adapter.evaluate<boolean>(`(function(){
      var ce = document.querySelector('.tiptap.ProseMirror');
      return !!(ce && ce.editor);
    })()`);
    if (!hasEditor) throw new Error('OSChina 编辑器未挂载（Tiptap 实例缺失）');

    const html = markdownToHtml(markdown);
    const stats = await adapter.evaluate<{ len: number; imgs: number; gt: number } | null>(`(function(){
      var ce = document.querySelector('.tiptap.ProseMirror');
      if (!ce || !ce.editor) return null;
      ce.editor.commands.clearContent(true);
      ce.editor.commands.setContent(${JSON.stringify(html)}, true);
      return {
        len: (ce.textContent || '').length,
        imgs: ce.querySelectorAll('img').length,
        gt: (ce.innerHTML.match(/&gt;/g) || []).length
      };
    })()`);
    if (!stats) throw new Error('OSChina 编辑器未挂载（Tiptap 实例缺失）');
    if (stats.len < 100) throw new Error(`OSChina 正文写入异常（${stats.len} 字符）`);
    if (stats.gt > 0) throw new Error(`OSChina 正文含 ${stats.gt} 处未正确转义的尖括号`);
  },

  async publish(
    adapter: PageAdapter,
    options: { source?: '原创' | '转载'; category?: string } = {},
  ): Promise<{ published: boolean; url?: string; note?: string }> {
    const source = options.source ?? '原创';

    // 1) 点顶栏「发布文章」→ 弹出 Popconfirm
    await adapter.evaluate(`(function(){ window.scrollTo(0, 0); return 'ok'; })()`);
    await sleep(400);
    const opened = await adapter.clickByText({ text: '发布文章', exact: true });
    if (!opened) throw new Error('OSChina「发布文章」按钮未找到');

    // 2) 等弹窗
    await waitFor(async () => {
      const ready = await adapter.evaluate<boolean>(`(function(){
        return !!document.querySelector('.ant-popover-inner');
      })()`);
      return ready ? true : null;
    }, { timeout: 15000, interval: 400 });

    // 3) 选「文章来源」
    const picked = await adapter.evaluate<boolean>(`(function(){
      var pop = document.querySelector('.ant-popover-inner');
      if (!pop) return false;
      var labs = Array.prototype.slice.call(pop.querySelectorAll('.ant-radio-wrapper'))
        .filter(function(l){ return (l.textContent || '').trim() === ${JSON.stringify(source)}; });
      if (!labs.length) return false;
      var input = labs[0].querySelector('input[type=radio]');
      if (!input) return false;
      var proto = Object.getPrototypeOf(input);
      var desc = Object.getOwnPropertyDescriptor(proto, 'checked');
      desc.set.call(input, true);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.checked;
    })()`);
    if (!picked) throw new Error(`OSChina「文章来源：${source}」未选中`);

    // 4) 博客分类（面板里已是标签形式，默认已选，可选补充）
    const category = options.category;
    if (category) {
      await adapter.clickByText({ text: category, exact: true, requireViewport: false });
      await sleep(400);
    }

    // 5) 点「确定并发布」
    const btn = await adapter.locateByText({ text: '确定并发布', exact: true, scope: '.ant-popover-inner' });
    if (!btn) throw new Error('OSChina「确定并发布」按钮未找到');
    await adapter.clickAt(btn.x, btn.y);

    // 6) 等跳转
    const url = await waitFor(async () => {
      const href = await adapter.evaluate<string>('location.href');
      return href && /\/blog\/\d+/.test(href) && !href.includes('/ai-write') ? href : null;
    }, { timeout: 25000, interval: 500 });

    const blogId = url.match(/\/blog\/(\d+)/)?.[1];
    return { published: true, url, note: blogId ? `文章 ID ${blogId}（待审核）` : undefined };
  },
};
