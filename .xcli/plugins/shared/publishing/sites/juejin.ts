/**
 * 掘金编辑器协议。
 *
 * 实战验证（2026-10-22，post/7699027015432978482 已上线）。
 *
 * 结构
 * ----
 * - 编辑器：CodeMirror（`.CodeMirror`），正文用 `cm.CodeMirror.setValue(md)`
 * - 标题：`input[placeholder*="输入文章标题"]`
 * - 标签：`input[placeholder*="标签"]` + 下拉项
 * - 发布：`button` 文本「发布文章」→ 确认弹窗「确定并发布」
 * - `/editor/draft` 已被重定向回首页（改版），只能用 `/editor/drafts/new`
 *
 * 与其他三站的差异
 * ----------------
 * 掘金有验证码风控，因此 `publish` 走**人工确认**（原实现的
 * `ctx.waitForHuman`）。协议层拿不到 ctx，这里用 `confirmRequired`
 * 标记，由命令注册层在发布前插入人工确认。
 */

import type { PageAdapter, SitePublisher } from '../channel.js';
import { sleep, waitFor } from '../bridge.js';

export const JUEJIN_EDITOR_URL = 'https://juejin.cn/editor/drafts/new';

/** 掘金标签输入框候选 */
const TAG_INPUT_HINTS = ['标签', 'tag', '添加标签'];

export const juejinPublisher: SitePublisher = {
  site: 'juejin',

  async open(adapter: PageAdapter): Promise<void> {
    await waitFor(async () => {
      const ready = await adapter.evaluate<boolean>(`(function(){
        return !!document.querySelector('.CodeMirror') ||
          !!document.querySelector('div[contenteditable="true"][class*="editor"]') ||
          !!document.querySelector('textarea[id*="editor"]');
      })()`);
      return ready ? true : null;
    }, { timeout: 20000, interval: 500 });
  },

  async setTitle(adapter: PageAdapter, title: string): Promise<void> {
    const ok = await adapter.evaluate<boolean>(`(function(){
      var inputs = Array.prototype.slice.call(document.querySelectorAll('input'));
      var e = inputs.filter(function(i){
        var ph = i.placeholder || '';
        return ph.indexOf('输入文章标题') >= 0 || ph.indexOf('标题') >= 0 ||
               /title/i.test(i.className || '') || /title/i.test(i.name || '');
      })[0];
      if (!e) return false;
      e.focus();
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(e, ${JSON.stringify(title)});
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
      return e.value.length > 0;
    })()`);
    if (!ok) throw new Error('掘金标题输入框未找到');
  },

  async setBody(adapter: PageAdapter, markdown: string): Promise<void> {
    const stats = await adapter.evaluate<{ len: number; mode: string } | null>(`(function(){
      var cm = document.querySelector('.CodeMirror');
      if (cm && cm.CodeMirror) {
        cm.CodeMirror.setValue(${JSON.stringify(markdown)});
        return { len: (cm.CodeMirror.getValue() || '').length, mode: 'codemirror' };
      }
      var editable = Array.prototype.slice.call(document.querySelectorAll('div[contenteditable="true"], textarea[id*="editor"]'))
        .filter(function(e){ return e.getBoundingClientRect().width > 300; })[0];
      if (!editable) return null;
      editable.focus();
      editable.innerHTML = ${JSON.stringify(markdown)};
      editable.dispatchEvent(new Event('input', { bubbles: true }));
      return { len: (editable.textContent || '').length, mode: 'contenteditable' };
    })()`);
    if (!stats) throw new Error('掘金正文编辑器未找到（CodeMirror / contenteditable）');
    if (stats.len < 100) throw new Error(`掘金正文写入异常（${stats.len} 字符）`);
  },

  async publish(
    adapter: PageAdapter,
    options: { tags?: string[]; category?: string } = {},
  ): Promise<{ published: boolean; url?: string; note?: string }> {
    // 1) 标签
    for (const tag of options.tags ?? []) {
      await adapter.evaluate(`(function(){
        var hints = ${JSON.stringify(TAG_INPUT_HINTS)};
        var inputs = Array.prototype.slice.call(document.querySelectorAll('input'));
        var e = inputs.filter(function(i){
          var ph = (i.placeholder || '').toLowerCase();
          var cls = (i.className || '').toLowerCase();
          return hints.some(function(h){
            var hl = h.toLowerCase();
            return ph.indexOf(hl) >= 0 || cls.indexOf(hl) >= 0;
          });
        })[0];
        if (!e) return 'no-tag-input';
        e.focus();
        var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(e, ${JSON.stringify(tag)});
        e.dispatchEvent(new Event('input', { bubbles: true }));
        return 'typed';
      })()`);
      await sleep(1200);
      // 选中下拉项
      const picked = await adapter.clickByText({ text: tag, requireViewport: false });
      if (!picked) {
        await adapter.evaluate(`(function(){
          var opts = Array.prototype.slice.call(document.querySelectorAll(
            '[class*="tag-item"], [class*="tag-suggestion"], [role="option"], [class*="tag-wrap"]'));
          var o = opts.filter(function(x){ return (x.textContent||'').trim() === ${JSON.stringify(tag)}; })[0];
          if (o) { o.scrollIntoView({block:'center'}); }
          return 'looked';
        })()`);
        await sleep(400);
        await adapter.clickByText({ text: tag, requireViewport: false });
      }
      await sleep(600);
    }

    // 2) 分类
    if (options.category) {
      await adapter.clickByText({ text: options.category, requireViewport: false });
      await sleep(600);
    }

    // 3) 点「发布文章」
    await adapter.evaluate(`(function(){ window.scrollTo(0, 0); return 'ok'; })()`);
    await sleep(400);
    const opened = await adapter.clickByText({ text: '发布文章', requireViewport: false });
    if (!opened) throw new Error('掘金「发布文章」按钮未找到');

    // 4) 确认弹窗
    await sleep(1500);
    const confirm = await adapter.locateByText({
      text: '确定并发布',
      exact: false,
      requireViewport: false,
    });
    if (confirm) {
      await adapter.clickAt(confirm.x, confirm.y);
    }

    // 5) 等跳转到文章页
    const url = await waitFor(async () => {
      const href = await adapter.evaluate<string>('location.href');
      return href && /juejin\.cn\/post\//.test(href) ? href : null;
    }, { timeout: 25000, interval: 500 });

    return { published: true, url, note: `已发布：${url}` };
  },
};
