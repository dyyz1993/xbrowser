/**
 * 51CTO 编辑器协议。
 *
 * 实战验证（2026-10-23，articleId 15029381）：
 * - 编辑器：wukong 富文本（`[contenteditable=true]` 且宽度 > 300）
 * - 标题：`input.editor-title`
 * - 发布链：`button.edit-submit` → 右侧「基础信息」面板 → 选文章分类 →
 *   填文章摘要（必填，否则发布失败）→ `button.release`
 * - 分类可选项含「自动化 Agent」（对应 `自动化` 技术栈）
 * - 面板按钮在视口右侧（x ≈ 1845），需滚动到可视区再点
 */

import type { PageAdapter, SitePublisher } from '../channel.js';
import { sleep, waitFor } from '../bridge.js';
import { markdownToHtml } from '../md-to-html.js';

export const CTO_EDITOR_URL = 'https://blog.51cto.com/blogger/publish?old=1&newBloger=1';

/** 51CTO 文章分类候选（面板里的可选项文本） */
export const CTO_CATEGORIES = [
  '后端开发',
  '前端开发',
  '数据库',
  '移动开发',
  '人工智能',
  '服务器',
  '大数据',
  '云计算',
  '游戏开发',
  '软件测试',
  '软件研发',
  '物联网',
  '开源',
  '运维',
  '网络安全',
  '考试认证',
  '数字化转型',
  '音视频',
  '低代码',
  '办公效率',
  '代码人生',
  'AIGC',
  'AI 办公',
  'AI 智能体',
  'AI 助手',
  'AI 编程',
  'AI 开发平台',
  '大模型',
  '模型工具',
  '办公 Agent',
  '编程 Agent',
  '自动化 Agent',
] as const;

/** 从 markdown 自动摘一段作为摘要（≤500 字） */
export function deriveSummary(markdown: string, max = 200): string {
  const lines = markdown
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('![') && !l.startsWith('>') && !l.startsWith('```'));
  const picked: string[] = [];
  let len = 0;
  for (const line of lines) {
    const plain = line.replace(/[*`>#]/g, '').trim();
    if (!plain) continue;
    if (len + plain.length > max) break;
    picked.push(plain);
    len += plain.length;
  }
  return picked.join(' ').slice(0, max);
}

export const ctoPublisher: SitePublisher = {
  site: '51cto',

  async open(adapter: PageAdapter): Promise<void> {
    // task-open 是异步导航——返回时目标页可能还在加载，先等 ready
    await adapter.waitReady();
    // 等编辑器挂载（wukong 异步 boot）
    await waitFor(async () => {
      const ready = await adapter.evaluate<boolean>(`(function(){
        var ce = Array.prototype.slice.call(document.querySelectorAll('[contenteditable=true]'))
          .filter(function(x){ return x.getBoundingClientRect().width > 300; })[0];
        return !!ce && !!document.querySelector('input.editor-title');
      })()`);
      return ready ? true : null;
    }, { timeout: 20000, interval: 500 });
    // 编辑器挂载 ≠ 页面加载完——wukong 后续还会重渲染一次。
    // 太早注入会被那次重渲染清空（实测注入后 1s 内模型才有内容）。
    await sleep(1500);
    await adapter.evaluate(`(function(){
      window.scrollTo(0, 0);
      return 'ok';
    })()`);
  },

  async setTitle(adapter: PageAdapter, title: string): Promise<void> {
    const ok = await adapter.evaluate<boolean>(`(function(){
      var e = document.querySelector('input.editor-title') || document.querySelector('input[placeholder*=标题]');
      if (!e) return false;
      e.focus();
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(e, ${JSON.stringify(title)});
      e.dispatchEvent(new Event('input', { bubbles: true }));
      return e.value.length > 0;
    })()`);
    if (!ok) throw new Error('51CTO 标题输入框未找到');
  },

  async setBody(adapter: PageAdapter, markdown: string): Promise<void> {
    const html = markdownToHtml(markdown);
    const stats = await adapter.evaluate<{ len: number; imgs: number; gt: number } | null>(`(function(){
      var ce = Array.prototype.slice.call(document.querySelectorAll('[contenteditable=true]'))
        .filter(function(x){ return x.getBoundingClientRect().width > 300; })[0];
      if (!ce) return null;
      ce.focus();
      ce.innerHTML = ${JSON.stringify(html)};
      ce.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        len: (ce.textContent || '').length,
        imgs: ce.querySelectorAll('img').length,
        gt: (Array.prototype.slice.call(ce.querySelectorAll('blockquote, p'))
          .filter(function(el){ return el.querySelector('code') === null; })
          .map(function(el){ return el.textContent || ''; }).join('')
          .match(/&gt;/g) || []).length
      };
    })()`);
    if (!stats) throw new Error('51CTO 编辑器未挂载');
    if (stats.len < 100) throw new Error(`51CTO 正文写入异常（${stats.len} 字符）`);
    if (stats.gt > 0) throw new Error(`51CTO 正文含 ${stats.gt} 处未正确转义的尖括号`);
  },

  async publish(
    adapter: PageAdapter,
    options: { category?: string; summary?: string } = {},
  ): Promise<{ published: boolean; url?: string; note?: string }> {
    const category = options.category ?? '自动化 Agent';
    const summary = options.summary ?? '';

    // 1) 点「发布文章」→ 打开右侧「基础信息」面板
    await adapter.evaluate(`(function(){ window.scrollTo(0, 0); return 'ok'; })()`);
    await sleep(400);
    const opened = await adapter.clickByText({ text: '发布文章', exact: true });
    if (!opened) throw new Error('51CTO「发布文章」按钮未找到');

    // 2) 等面板（分类区 + 摘要框）出现
    await waitFor(async () => {
      const ready = await adapter.evaluate<boolean>(`(function(){
        var tas = Array.prototype.slice.call(document.querySelectorAll('textarea')).filter(function(e){
          var r = e.getBoundingClientRect();
          return r.width > 200 && r.height > 40 && r.x > 900;
        });
        return tas.length > 0;
      })()`);
      return ready ? true : null;
    }, { timeout: 15000, interval: 400 });

    // 3) 选文章分类（面板内文本按钮）
    const catPicked = await adapter.clickByText({ text: category, exact: true, requireViewport: false });
    if (!catPicked) {
      // 分类可能需要展开更多，先尝试"展开"再试
      await adapter.clickByText({ text: '更多', exact: true, requireViewport: false }).catch(() => false);
      await sleep(600);
      const retry = await adapter.clickByText({ text: category, exact: true, requireViewport: false });
      if (!retry) throw new Error(`51CTO 分类「${category}」未找到`);
    }

    // 4) 填文章摘要（必填）
    const filled = await adapter.evaluate<number | null>(`(function(){
      var tas = Array.prototype.slice.call(document.querySelectorAll('textarea')).filter(function(e){
        var r = e.getBoundingClientRect();
        return r.width > 200 && r.height > 40 && r.x > 900;
      });
      if (!tas.length) return null;
      var ta = tas[0];
      ta.focus();
      var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(summary)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      return ta.value.length;
    })()`);
    if (filled === null) throw new Error('51CTO 摘要输入框未找到');
    if (summary && filled < 10) throw new Error('51CTO 摘要写入失败');

    // 5) 点「发布」
    const releasePoint = await adapter.locateByText({ text: '发布', exact: true, scope: 'button' });
    if (!releasePoint) throw new Error('51CTO「发布」按钮未找到');
    await adapter.clickAt(releasePoint.x, releasePoint.y);

    // 6) 等成功页
    const url = await waitFor(async () => {
      const href = await adapter.evaluate<string>('location.href');
      return href && href.includes('/blogger/success/') ? href : null;
    }, { timeout: 20000, interval: 500 });

    const articleId = url.split('/blogger/success/')[1]?.split('?')[0];
    return { published: true, url, note: articleId ? `文章 ID ${articleId}（待审核）` : undefined };
  },
};
