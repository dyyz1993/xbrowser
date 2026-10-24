/**
 * Blogger（blogspot.com）编辑器协议。
 *
 * 实战验证（2026-10-24，博客 Aurora Notes / blogId 853616507140647199）。
 *
 * 结构
 * ----
 * - 博客后台：`https://www.blogger.com/blog/posts/<blogId>`
 * - **新建博文**：侧边栏 `div[role=button][aria-label="新建博文"]`——点**这一层**，
 *   外面那层 `div[jsname=VdueEf]` 只是包裹，点它没有任何反应。
 *   点成功后会跳到 `blog/post/edit/<blogId>/<postId>`。
 *   直接 `goto blog/post/edit/<blogId>/new` **无效**，会被弹回列表页。
 * - 标题：`input[type=text][aria-label=标题]`，用可信 `insertText`
 * - 正文：**同源 iframe** `iframe.editable` 里的 `body`，内容是 `contenteditable`
 * - 发布：`div[role=button][aria-label=发布]`，右上角
 * - 保存：Blogger 自动保存（状态栏显示「正在保存」），无独立存草稿按钮
 *
 * 坑
 * --
 * - 侧边栏有**两份**同名「创建博客」/「新建博文」节点，未展开那份 `x` 为负数；
 *   必须按 `getBoundingClientRect()` 过滤出视口内可见的那个。
 * - 正文 iframe 是 `iframe.editable`，不是 `[contenteditable=true]`——
 *   后者在宿主文档里根本不存在。
 * - 弹窗里 `document.querySelector('[role=dialog]')` 会先命中侧边栏抽屉，
 *   找弹窗内容必须再按文字过滤（如含「选择一个名称」）。
 */

import type { PageAdapter, SitePublisher } from '../channel.js';
import { sleep, waitFor } from '../bridge.js';
import { markdownToHtml } from '../md-to-html.js';

export const BLOGGER_HOME = 'https://www.blogger.com/home';
export const BLOGGER_BODY_IFRAME = 'iframe.editable';

/** 正文 iframe 的 body（contenteditable） */
const BODY_SELECTOR = BLOGGER_BODY_IFRAME;

export interface BloggerOptions {
  /** 博客 id（`blog/posts/<blogId>` 里的数字）。不传则从 home 页自动发现 */
  blogId?: string;
}

/** 从当前页面 URL 提取 blogId */
async function currentBlogId(adapter: PageAdapter): Promise<string | null> {
  const url = await adapter.url();
  return url.match(/blog\/posts\/(\d+)/)?.[1] ?? url.match(/blog\/post\/edit\/(\d+)/)?.[1] ?? null;
}

/**
 * 点击「新建博文」。
 *
 * 只点带 `role=button` + `aria-label` 的那一层；外层包裹点不动。
 */
async function clickNewPost(adapter: PageAdapter): Promise<boolean> {
  const point = await adapter.evaluate<string | null>(`(function(){
    var els = Array.prototype.slice.call(document.querySelectorAll('div[role=button][aria-label="新建博文"], [role=button][aria-label="新建博文"]'));
    // 同一个按钮在不同窗口尺寸下可能被覆盖层压住一部分——必须逐点做命中校验，
    // 只按 getBoundingClientRect 取中心点会点到 z-index:4000 的浮层上（实测踩坑）。
    var out = null;
    for (var i = 0; i < els.length && !out; i++) {
      var e = els[i];
      var r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.x < 0 || r.y < 0 || r.y > window.innerHeight) continue;
      var candidates = [
        { x: r.x + r.width / 2, y: r.y + r.height / 2 },
        { x: r.x + 10, y: r.y + r.height / 2 },
        { x: r.x + r.width - 10, y: r.y + r.height / 2 },
        { x: r.x + r.width / 2, y: r.y + 8 },
        { x: r.x + r.width / 2, y: r.y + r.height - 8 }
      ];
      for (var j = 0; j < candidates.length; j++) {
        var cx = Math.round(candidates[j].x), cy = Math.round(candidates[j].y);
        var hit = document.elementFromPoint(cx, cy);
        if (hit && (hit === e || e.contains(hit))) { out = { x: cx, y: cy }; break; }
      }
    }
    return out ? JSON.stringify(out) : null;
  })()`);
  if (!point) return false;
  const p = JSON.parse(point) as { x: number; y: number };
  await adapter.clickAt(p.x, p.y);
  return true;
}

export const bloggerPublisher: SitePublisher = {
  site: 'blogger',

  async open(adapter: PageAdapter, options?: Record<string, unknown>): Promise<void> {
    await adapter.waitReady();
    const blogId = (options as BloggerOptions | undefined)?.blogId ?? (await currentBlogId(adapter));

    // 已在编辑器里（URL 命中 post/edit）就直接用
    const url = await adapter.url();
    if (/blog\/post\/edit\//.test(url)) {
      await waitForBody(adapter);
      return;
    }

    if (!blogId) {
      throw new Error('Blogger：未找到 blogId（请先创建博客，或用 --blogId 指定）');
    }

    // 点「新建博文」进入编辑器
    const clicked = await clickNewPost(adapter);
    if (!clicked) {
      throw new Error('Blogger：找不到「新建博文」按钮（页面可能还在加载，或侧边栏处于收起状态）');
    }
    // waitFor 超时会 throw，这里显式接住以给出可诊断的错误
    const beforeClickUrl = url;
    try {
      await waitFor(async () => /blog\/post\/edit\//.test(await adapter.url()), { timeout: 25000 });
    } catch {
      const now = await adapter.url().catch(() => '(读取失败)');
      throw new Error(
        `Blogger：点击「新建博文」后未进入编辑器（点击前 ${beforeClickUrl} → 现在 ${now}）`,
      );
    }
    await waitForBody(adapter);
  },

  async setTitle(adapter: PageAdapter, title: string): Promise<void> {
    const found = await waitFor(async () => {
      const raw = await adapter.evaluate<string | null>(`(function(){
        var i = Array.prototype.slice.call(document.querySelectorAll('input[type=text]')).filter(function(e){
          var r = e.getBoundingClientRect();
          return r.width > 400 && r.x >= 0 && e.getAttribute('aria-label') === '标题';
        })[0];
        if (!i) return null;
        var r = i.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) });
      })()`);
      return raw;
    }, { timeout: 20000 });
    if (!found) throw new Error('Blogger：找不到标题输入框');
    const p = JSON.parse(found) as { x: number; y: number };

    await adapter.clickAt(p.x, p.y);
    await sleep(400);
    await adapter.insertText(title);
    await sleep(1200);

    // 回读校验——Blogger 的标题是受控 input，写失败会静默变空
    const actual = await adapter.evaluate<string>(`(function(){
      var i = Array.prototype.slice.call(document.querySelectorAll('input[type=text]')).filter(function(e){
        return e.getAttribute('aria-label') === '标题';
      })[0];
      return i ? i.value : '';
    })()`);
    if (actual !== title) {
      throw new Error(`Blogger：标题写入失败（期望 ${title.length} 字，实际 ${(actual || '').length} 字）`);
    }
  },

  async setBody(adapter: PageAdapter, markdown: string): Promise<void> {
    const html = markdownToHtml(markdown);

    // 原子三步：清空 → 单次写入 → 触发 input（防双份粘贴，ERR-20261024-001）
    const result = await adapter.evaluateInIframe<string>(BODY_SELECTOR, `
      var b = document.body;
      if (!b) return JSON.stringify({ err: 'no-body' });
      b.innerHTML = '';
      b.innerHTML = ${JSON.stringify(html)};
      b.dispatchEvent(new Event('input', { bubbles: true }));
      return JSON.stringify({
        chars: (b.innerText || '').length,
        tables: b.querySelectorAll('table').length
      });
    `);
    if (!result) throw new Error('Blogger：正文 iframe 不可访问（可能跨源或尚未加载）');
    const parsed = JSON.parse(result) as { err?: string; chars?: number; tables?: number };
    if (parsed.err) throw new Error(`Blogger：正文写入失败（${parsed.err}）`);
    if (!parsed.chars) throw new Error('Blogger：正文写入后内容为空');

    await sleep(3000);

    // 存活校验 + 双份粘贴防护
    //
    // 写入后 Blogger 会重渲染正文 iframe（React 换掉 contentDocument），
    // 立刻读会拿到 null。重试几次让新文档挂载。
    let after: string | null = null;
    for (let i = 0; i < 10 && !after; i++) {
      await sleep(500);
      after = await adapter.evaluateInIframe<string>(BODY_SELECTOR, `
        var b = document.body;
        if (!b) return null;
        return JSON.stringify({ chars: (b.innerText || '').length, tables: b.querySelectorAll('table').length });
      `);
    }
    if (!after) throw new Error('Blogger：正文校验失败（写入后正文 iframe 不可读）');
    const a = JSON.parse(after) as { chars: number };
    const ratio = parsed.chars > 0 ? a.chars / parsed.chars : 1;
    if (ratio > 1.5) {
      throw new Error(
        `Blogger：正文疑似重复粘贴（${a.chars} 字符 > 写入时 ${parsed.chars} 的 1.5 倍）——已中止`,
      );
    }
    if (a.chars < parsed.chars * 0.5) {
      throw new Error(`Blogger：正文被清空（写入 ${parsed.chars} 字符，现存 ${a.chars} 字符）`);
    }
  },

  async publish(
    adapter: PageAdapter,
    options?: Record<string, unknown>,
  ): Promise<{ published: boolean; url?: string; note?: string }> {
    const dryRun = (options as { dryRun?: boolean } | undefined)?.dryRun === true;

    if (dryRun) {
      const url = await adapter.url();
      return { published: false, url, note: 'dry-run：已停在发布前（草稿已自动保存）' };
    }

    const point = await adapter.evaluate<string | null>(`(function(){
      var els = Array.prototype.slice.call(document.querySelectorAll('[role=button][aria-label="发布"], button[aria-label="发布"]'));
      var vis = els.filter(function(e){
        var r = e.getBoundingClientRect();
        return r.width > 0 && r.x >= 0 && r.y >= 0;
      });
      if (!vis.length) return null;
      var e = vis[0];
      var r = e.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) });
    })()`);
    if (!point) throw new Error('Blogger：找不到「发布」按钮');
    const p = JSON.parse(point) as { x: number; y: number };

    await adapter.clickAt(p.x, p.y);
    await sleep(4000);

    // Blogger 偶尔弹「发布」二次确认对话框
    const confirmPoint = await adapter.evaluate<string | null>(`(function(){
      var dlgs = Array.prototype.slice.call(document.querySelectorAll('[role=dialog]'));
      for (var i = 0; i < dlgs.length; i++) {
        var d = dlgs[i];
        if (!/发布|确定/.test(d.innerText || '')) continue;
        var btns = Array.prototype.slice.call(d.querySelectorAll('[role=button],button'));
        var hit = btns.filter(function(x){ return /^发布$|^确定$/.test(String(x.textContent || '').trim()); })[0];
        if (!hit) continue;
        var r = hit.getBoundingClientRect();
        if (r.width <= 0 || r.x < 0) continue;
        return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) });
      }
      return null;
    })()`);
    if (confirmPoint) {
      const cp = JSON.parse(confirmPoint) as { x: number; y: number };
      await adapter.clickAt(cp.x, cp.y);
    }

    const published = await waitFor(async () => {
      const url = await adapter.url();
      // 发布成功后 Blogger 跳回博文列表或跳到文章页
      return /blog\/posts\/|\.blogspot\.com\/\d{4}\//.test(url) && !/post\/edit/.test(url);
    }, { timeout: 30000 });

    const finalUrl = await adapter.url();
    if (published) {
      return { published: true, url: finalUrl, note: '已发布' };
    }
    return { published: false, url: finalUrl, note: '发布后未检测到跳转，请到后台确认' };
  },
};

/** 等正文 iframe 的 body 可写 */
async function waitForBody(adapter: PageAdapter, timeout = 25000): Promise<void> {
  let lastError = '(未取到值)';
  const ok = await waitFor(async () => {
    // 返回值经 JSON 序列化，布尔可能变成 true 或 'true'——两种都认
    try {
      const raw = await adapter.evaluateInIframe<unknown>(BODY_SELECTOR, `return !!document.body;`);
      if (raw === true || raw === 'true') return true;
      lastError = `返回 ${JSON.stringify(raw)}`;
      return false;
    } catch (e) {
      lastError = String(e instanceof Error ? e.message : e).slice(0, 150);
      return false;
    }
  }, { timeout });
  if (!ok) throw new Error(`Blogger：正文 iframe 未就绪（${lastError}）`);
}
