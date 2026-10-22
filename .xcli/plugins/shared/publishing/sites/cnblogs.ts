/**
 * 博客园（cnblogs）编辑器协议。
 *
 * 实战验证（2026-10-23，postId 23405420）：
 * - 编辑器：`#md-editor` 是原生 textarea（Markdown 源码模式），不需要转 HTML
 * - 标题：`#post-title`
 * - 摘要：`#summary`（textarea）
 * - Tag：Ant Select（宽度 200~500 的 `.ant-select`），输入后回车选中
 * - 网站分类：`input[name=site-cate-selector]`（单选 radio），label 被 sticky 底栏
 *   遮挡时 `elementFromPoint` 返回 `cnb-panel-header`，需改用 radio 自身坐标 +
 *   prototype setter（Angular 绑定）
 * - 发布按钮：`button` 文本「发布草稿」——**单层，点击即最终提交**
 * - 发布后跳 `posts/edit-done;postId=<id>;isPublished=true`
 */

import type { PageAdapter, SitePublisher } from '../channel.js';
import { sleep, waitFor } from '../bridge.js';

export const CNB_EDITOR_URL = 'https://i.cnblogs.com/posts/edit';

/** 博客园网站分类候选 */
export const CNB_CATEGORIES = [
  '其他技术区',
  '软件测试',
  '代码与软件发布',
  '程序人生',
  '架构设计',
  '网络安全',
  '开源研究',
  '云计算',
  '前端开发',
  '后端开发',
  '人工智能',
  'Agentic',
  '大模型',
  'MCP',
] as const;

export const cnbPublisher: SitePublisher = {
  site: 'cnblogs',

  async open(adapter: PageAdapter): Promise<void> {
    await waitFor(async () => {
      const ready = await adapter.evaluate<boolean>(`(function(){
        return !!document.querySelector('#md-editor') && !!document.querySelector('#post-title');
      })()`);
      return ready ? true : null;
    }, { timeout: 20000, interval: 500 });
  },

  async setTitle(adapter: PageAdapter, title: string): Promise<void> {
    const ok = await adapter.evaluate<boolean>(`(function(){
      var t = document.querySelector('#post-title');
      if (!t) return false;
      t.focus();
      var s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      s.call(t, ${JSON.stringify(title)});
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return t.value.length > 0;
    })()`);
    if (!ok) throw new Error('博客园标题输入框未找到');
  },

  async setBody(adapter: PageAdapter, markdown: string): Promise<void> {
    const len = await adapter.evaluate<number | null>(`(function(){
      var ta = document.querySelector('#md-editor');
      if (!ta) return null;
      ta.focus();
      var s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      s.call(ta, ${JSON.stringify(markdown)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      return ta.value.length;
    })()`);
    if (len === null) throw new Error('博客园 Markdown 编辑器未找到');
    if (len < 100) throw new Error(`博客园正文写入异常（${len} 字符）`);
  },

  async publish(
    adapter: PageAdapter,
    options: { category?: string; summary?: string; tags?: string[] } = {},
  ): Promise<{ published: boolean; url?: string; note?: string }> {
    const category = options.category;
    const summary = options.summary ?? '';
    const tags = options.tags ?? [];

    // 1) 填摘要
    if (summary) {
      const filled = await adapter.evaluate<number | null>(`(function(){
        var ta = document.getElementById('summary');
        if (!ta) return null;
        ta.focus();
        var s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        s.call(ta, ${JSON.stringify(summary)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        return ta.value.length;
      })()`);
      if (filled === null) throw new Error('博客园摘要输入框未找到');
    }

    // 2) 选网站分类（radio：label 常被 sticky 底栏遮挡，直接点 input 自身坐标）
    if (category) {
      const picked = await adapter.evaluate<boolean>(`(function(){
        var radios = Array.prototype.slice.call(document.querySelectorAll('input[name=site-cate-selector]'));
        var target = radios.filter(function(r){ return r.id === ${JSON.stringify(category)}; })[0];
        if (!target) return false;
        target.scrollIntoView({ block: 'center' });
        var proto = Object.getPrototypeOf(target);
        var desc = Object.getOwnPropertyDescriptor(proto, 'checked');
        desc.set.call(target, true);
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return target.checked;
      })()`);
      if (!picked) throw new Error(`博客园分类「${category}」未找到`);
    }

    // 3) Tag（Ant Select：定位宽度 200~500 的那个）
    for (const tag of tags) {
      await adapter.evaluate(`(function(){
        var sels = Array.prototype.slice.call(document.querySelectorAll('.ant-select')).filter(function(s){
          var r = s.getBoundingClientRect();
          return r.width > 200 && r.width < 500;
        });
        if (!sels.length) return 'no-select';
        var inp = sels[0].querySelector('input.ant-select-selection-search-input');
        if (!inp) return 'no-input';
        inp.scrollIntoView({ block: 'center' });
        inp.focus();
        return 'ok';
      })()`);
      await sleep(400);
      await adapter.evaluate(`(function(){
        var sels = Array.prototype.slice.call(document.querySelectorAll('.ant-select')).filter(function(s){
          var r = s.getBoundingClientRect();
          return r.width > 200 && r.width < 500;
        });
        var inp = sels[0] && sels[0].querySelector('input.ant-select-selection-search-input');
        if (!inp) return 'no-input';
        var s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        s.call(inp, ${JSON.stringify(tag)});
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        return 'typed';
      })()`);
      await sleep(1200);
      // 回车选中
      await adapter.evaluate(`(function(){
        var sels = Array.prototype.slice.call(document.querySelectorAll('.ant-select')).filter(function(s){
          var r = s.getBoundingClientRect();
          return r.width > 200 && r.width < 500;
        });
        var inp = sels[0] && sels[0].querySelector('input.ant-select-selection-search-input');
        if (!inp) return 'no-input';
        inp.focus();
        return 'focused';
      })()`);
      await adapter.evaluate(`(function(){
        var sels = Array.prototype.slice.call(document.querySelectorAll('.ant-select')).filter(function(s){
          var r = s.getBoundingClientRect();
          return r.width > 200 && r.width < 500;
        });
        var inp = sels[0] && sels[0].querySelector('input.ant-select-selection-search-input');
        if (!inp) return 'no-input';
        var opts = Array.prototype.slice.call(document.querySelectorAll('.ant-select-dropdown .ant-select-item-option'));
        var target = opts.filter(function(o){ return (o.textContent||'').indexOf(${JSON.stringify(tag)}) >= 0; })[0];
        if (target) {
          target.scrollIntoView({ block: 'center' });
          var r = target.getBoundingClientRect();
          window.__cnbtap = { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
          return 'option-found';
        }
        return 'no-option';
      })()`);
      const tap = await adapter.evaluate<{ x: number; y: number } | null>('window.__cnbtap || null');
      if (tap) {
        await adapter.clickAt(tap.x, tap.y);
      } else {
        await adapter.clickByText({ text: tag, requireViewport: false });
      }
      await sleep(800);
    }

    // 4) 滚到底部找「发布草稿」
    await adapter.evaluate(`(function(){ window.scrollTo(0, document.body.scrollHeight); return 'ok'; })()`);
    await sleep(800);
    const btn = await adapter.locateByText({ text: '发布草稿', exact: true });
    if (!btn) throw new Error('博客园「发布草稿」按钮未找到');
    await adapter.clickAt(btn.x, btn.y);

    // 5) 等发布完成
    const url = await waitFor(async () => {
      const href = await adapter.evaluate<string>('location.href');
      return href && href.includes('postId=') ? href : null;
    }, { timeout: 25000, interval: 500 });

    const published = /isPublished=true/.test(url);
    const postId = url.match(/postId=(\d+)/)?.[1];
    return {
      published,
      url,
      note: published ? `文章 ID ${postId}（已发布）` : `文章 ID ${postId}（仍是草稿）`,
    };
  },
};
