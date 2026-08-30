import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

/**
 * visual-tag — 视觉标注定位系统（S127）
 *
 * 在页面上给每个可交互元素叠加一个防混淆短 ID 标签（Canvas 绘制），
 * 截图后 VLM 读 ID → ID→DOM 映射 → 像素级精确交互。
 *
 * 字符集设计（用户要求）：去掉视觉易混淆字符（I/l/1、O/0、B/8、S/5、
 * Z/2、G/6、D/Q 等），只留模糊截图也能区分的字符。
 */

// 防混淆字符集：23 个字符，两两视觉无歧义
// 明确排除的：i(像l)、l(像1)、o(像0)、q(像p/g)、i、b(像6/8)、d(像cl)、
// e(在低分辨率下像c)、g(像9)、t(在低分辨率下像+)、u(像v)、v(像u)、w(像vv)、
// x(像×)、y(像v)、z(像2)、s(像5)、c(像o)、f(像t)、r(像n)
// 实际我们保留的就是最安全的核心集
const SAFE_SET = 'ahjkmnprtw3479'.split(''); // 15 个最安全字符

// 注入页面的标注脚本
const TAG_SCRIPT = `
(function() {
  // 清除旧标注
  var old = document.getElementById('__xb-tag-overlay');
  if (old) old.remove();
  window.__xbTagMap = {};

  var SAFE_SET = ${JSON.stringify(SAFE_SET)};
  function genId(idx) {
    var base = SAFE_SET.length;
    if (idx < base * base) return SAFE_SET[Math.floor(idx / base)] + SAFE_SET[idx % base];
    var i = idx - base * base;
    return SAFE_SET[Math.floor(i / (base * base))] + SAFE_SET[Math.floor(i / base) % base] + SAFE_SET[i % base];
  }

  // 找所有可交互元素
  var els = [];
  var all = document.querySelectorAll('button, a[href], input, select, textarea, [onclick], [role="button"], [contenteditable], [class*="btn"], [class*="button"], [class*="link"]');
  for (var i = 0; i < all.length && els.length < 200; i++) {
    var el = all[i];
    var r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) continue;
    if (r.x < 0 || r.y < 0 || r.x + r.width > window.innerWidth || r.y + r.height > window.innerHeight + 100) continue;
    var style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
    els.push({ el: el, rect: r });
  }

  // 创建叠加 Canvas
  var canvas = document.createElement('canvas');
  canvas.id = '__xb-tag-overlay';
  canvas.width = window.innerWidth;
  canvas.height = Math.max(window.innerHeight, document.documentElement.scrollHeight);
  canvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:999999;';
  document.body.appendChild(canvas);
  var ctx = canvas.getContext('2d');

  // 绘制标签
  for (var j = 0; j < els.length; j++) {
    var item = els[j];
    var id = genId(j);
    var x = item.rect.x;
    var y = item.rect.y;

    // 标签框：高对比（黄底黑字）
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(x - 2, y - 16, id.length * 8 + 8, 16);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 2, y - 16, id.length * 8 + 8, 16);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(id, x + 2, y - 5);

    // 元素轮廓
    ctx.strokeStyle = '#FF0000';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, item.rect.width, item.rect.height);

    // 存储 ID → 元素映射
    window.__xbTagMap[id] = {
      tagName: item.el.tagName,
      text: (item.el.textContent || '').trim().slice(0, 50),
      rect: { x: x, y: y, w: item.rect.width, h: item.rect.height },
      selector: (function(e) {
        if (e.id) return '#' + e.id;
        if (e.getAttribute('data-testid')) return '[data-testid="' + e.getAttribute('data-testid') + '"]';
        // 生成 nth-child 选择器
        var path = [];
        var node = e;
        while (node && node !== document.body) {
          var idx = 1;
          var sib = node.previousElementSibling;
          while (sib) { if (sib.tagName === node.tagName) idx++; sib = sib.previousElementSibling; }
          path.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + idx + ')');
          node = node.parentElement;
        }
        return path.join(' > ');
      })(item.el)
    };
  }

  return JSON.stringify({ tagged: els.length, overlay: true });
})()
`;

export const visualTagCommand = registerCommand({
  name: 'visual-tag',
  description: '在页面上给可交互元素叠加防混淆短 ID 标签（视觉定位用）',
  scope: 'page',
  parameters: z.object({
    action: z.enum(['tag', 'lookup', 'clear', 'list']),
    id: z.string().optional().describe('lookup 时指定要查的 ID'),
  }),
  result: z.object({
    action: z.string(),
    tagged: z.number().optional(),
    id: z.string().optional(),
    element: z.record(z.unknown()).optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    switch (p.action) {
      case 'tag': {
        const result = await ctx.page.evaluate<string>(TAG_SCRIPT);
        const parsed = JSON.parse(result) as { tagged: number };
        return ok({ action: 'tag', tagged: parsed.tagged });
      }
      case 'lookup': {
        if (!p.id) return fail('lookup 需要 --id 参数');
        const result = await ctx.page.evaluate<string>(
          `(function() { var m = window.__xbTagMap; if (!m) return JSON.stringify({err:'no-map'}); var e = m[${JSON.stringify(p.id)}]; return e ? JSON.stringify(e) : JSON.stringify({err:'not-found'}); })()`,
        );
        const parsed = JSON.parse(result) as Record<string, unknown>;
        if (parsed.err) return fail(`ID ${p.id}: ${parsed.err}`);
        return ok({ action: 'lookup', id: p.id, element: parsed });
      }
      case 'list': {
        const result = await ctx.page.evaluate<string>(
          `(function() { var m = window.__xbTagMap; if (!m) return '{}'; var out = {}; for (var k in m) { out[k] = m[k].text || m[k].tagName; } return JSON.stringify(out); })()`,
        );
        return ok({ action: 'list', element: JSON.parse(result) as Record<string, unknown> });
      }
      case 'clear': {
        await ctx.page.evaluate(`(function(){var o=document.getElementById('__xb-tag-overlay');if(o)o.remove();window.__xbTagMap=null;return 'cleared'})()`);
        return ok({ action: 'clear' });
      }
    }
  },
});
