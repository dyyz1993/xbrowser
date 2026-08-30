import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

/**
 * visual-tag v2 — 分色标注系统（S129）
 *
 * 按元素类型分色标记，让 VLM 一眼区分页面结构：
 * - 🔴 红框：可点击（按钮/链接）
 * - 🔵 蓝框：输入框（input/textarea/select）
 * - 🟢 绿框：图片
 * - 🟡 黄框：列表容器（ul/ol/列表项）
 * - 🟣 紫框：数字/计数器（点赞数/评论数/金额）
 * - 🟠 橙框：文本内容区域
 *
 * 每个 ID 仍然是防混淆字符集（ahjkmnprtw3479），但前缀字母对应类型。
 */

const SAFE_SET = 'ahjkmnprtw3479'.split('');
// 类型前缀映射嵌入在 TAG_V2_SCRIPT 中

const TAG_V2_SCRIPT = `
(function() {
  var old = document.getElementById('__xb-tag-overlay');
  if (old) old.remove();
  window.__xbTagMap = {};
  window.__xbTagStats = {};

  var SAFE_SET = ${JSON.stringify(SAFE_SET)};
  var TYPE_PREFIX = { click:'k', input:'n', img:'m', list:'h', count:'p', text:'t' };
  function genId(prefix, idx) {
    var base = SAFE_SET.length;
    var suffix = SAFE_SET[Math.floor(idx / base) % base] + SAFE_SET[idx % base];
    return prefix + suffix;
  }

  var counters = { click: 0, input: 0, img: 0, list: 0, count: 0, text: 0 };

  var canvas = document.createElement('canvas');
  canvas.id = '__xb-tag-overlay';
  canvas.width = window.innerWidth;
  canvas.height = Math.max(window.innerHeight, document.documentElement.scrollHeight);
  canvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:999999;';
  document.body.appendChild(canvas);
  var ctx = canvas.getContext('2d');

  function classifyElement(el) {
    var tag = el.tagName;
    if (tag === 'BUTTON' || (el.getAttribute('role') === 'button') ||
        el.tagName === 'A' && el.getAttribute('href') ||
        /btn|button|click|action/i.test(el.className || '')) return 'click';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        el.getAttribute('contenteditable')) return 'input';
    if (tag === 'IMG' || el.querySelector && el.querySelector('img') &&
        el.children.length <= 2 && !el.textContent.trim()) return 'img';
    if (tag === 'UL' || tag === 'OL' || tag === 'LI' ||
        /list|item|feed|timeline/i.test(el.className || '')) return 'list';
    // 数字/计数器检测：纯数字文本 或 数字+单位
    var text = (el.textContent || '').trim();
    if (el.children.length === 0 && text.length > 0 && text.length < 15) {
      if (/^[\\d,.]+\\s*(万|亿|k|K|M|\\+|人|次|条|篇|个|评|赞)?$/.test(text) ||
          /^[\\d,.]+$/.test(text.replace(/[^\\d,.]/g, '')) && text.replace(/[^\\d,.]/g, '').length > text.length * 0.5) {
        return 'count';
      }
    }
    if (text.length > 20) return 'text';
    return null;
  }

  var COLORS = {
    click: { stroke: '#FF0000', fill: '#FFD700' },  // 红+黄
    input: { stroke: '#0000FF', fill: '#ADD8E6' },  // 蓝
    img:   { stroke: '#00AA00', fill: '#90EE90' },  // 绿
    list:  { stroke: '#FFAA00', fill: '#FFE4B5' },  // 橙黄
    count: { stroke: '#9900CC', fill: '#E0B0FF' },  // 紫
    text:  { stroke: '#FF8C00', fill: '#FFECD2' },  // 橙
  };

  var all = document.querySelectorAll('button, a[href], input, select, textarea, img, ul, ol, li, [onclick], [role="button"], [contenteditable], [class*="btn"], [class*="list"], [class*="item"], [class*="count"], [class*="num"], [class*="like"], [class*="comment"], [class*="stat"]');

  for (var i = 0; i < all.length && i < 300; i++) {
    var el = all[i];
    var r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.x < -50 || r.y < -50 || r.x > window.innerWidth || r.y > window.innerHeight + 200) continue;
    var style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

    var type = classifyElement(el);
    if (!type) continue;

    var id = genId(TYPE_PREFIX[type] || 't', counters[type]);
    counters[type]++;
    var colors = COLORS[type];

    // 标签
    ctx.fillStyle = colors.fill;
    ctx.fillRect(r.x - 2, r.y - 14, id.length * 7 + 6, 14);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x - 2, r.y - 14, id.length * 7 + 6, 14);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(id, r.x + 1, r.y - 4);

    // 元素框（分色）
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x, r.y, r.width, r.height);

    window.__xbTagMap[id] = {
      type: type,
      tagName: el.tagName,
      text: (el.textContent || '').trim().slice(0, 40),
      num: (el.textContent || '').trim().match(/[\\d,.]+/)?.[0] || null,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      selector: (function(e) {
        if (e.id) return '#' + e.id;
        if (e.getAttribute('data-testid')) return '[data-testid="' + e.getAttribute('data-testid') + '"]';
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
      })(el)
    };
  }

  window.__xbTagStats = { total: Object.keys(window.__xbTagMap).length, byType: counters };
  return JSON.stringify(window.__xbTagStats);
})()
`;

export const visualTagV2Command = registerCommand({
  name: 'visual-tag-v2',
  description: '分色标注页面元素（红=可点击 蓝=输入 绿=图片 黄=列表 紫=数字 橙=文本）',
  scope: 'page',
  parameters: z.object({
    action: z.enum(['tag', 'lookup', 'clear', 'stats', 'by-type']),
    id: z.string().optional(),
    type: z.string().optional().describe('by-type 时过滤类型：click/input/img/list/count/text'),
  }),
  result: z.object({
    action: z.string(),
    total: z.number().optional(),
    byType: z.record(z.number()).optional(),
    element: z.record(z.unknown()).optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    switch (p.action) {
      case 'tag': {
        const result = await ctx.page.evaluate<string>(TAG_V2_SCRIPT);
        const parsed = JSON.parse(result) as { total: number; byType: Record<string, number> };
        return ok({ action: 'tag', total: parsed.total, byType: parsed.byType });
      }
      case 'lookup': {
        if (!p.id) return fail('lookup 需要 --id');
        const result = await ctx.page.evaluate<string>(
          `(function(){var m=window.__xbTagMap;if(!m)return JSON.stringify({err:'no-map'});var e=m[${JSON.stringify(p.id)}];return e?JSON.stringify(e):JSON.stringify({err:'not-found'})})()`,
        );
        const parsed = JSON.parse(result) as Record<string, unknown>;
        if (parsed.err) return fail(`ID ${p.id}: ${parsed.err}`);
        return ok({ action: 'lookup', id: p.id, element: parsed });
      }
      case 'by-type': {
        const result = await ctx.page.evaluate<string>(
          `(function(){var m=window.__xbTagMap;if(!m)return'{}';var out={};for(var k in m){if(!${JSON.stringify(p.type || '')}||m[k].type===${JSON.stringify(p.type || '')}){out[k]={type:m[k].type,text:m[k].text,num:m[k].num}}}return JSON.stringify(out)})()`,
        );
        return ok({ action: 'by-type', element: JSON.parse(result) as Record<string, unknown> });
      }
      case 'stats': {
        const result = await ctx.page.evaluate<string>(
          `(function(){return JSON.stringify(window.__xbTagStats||{})})()`,
        );
        return ok({ action: 'stats', element: JSON.parse(result) as Record<string, unknown> });
      }
      case 'clear': {
        await ctx.page.evaluate(`(function(){var o=document.getElementById('__xb-tag-overlay');if(o)o.remove();window.__xbTagMap=null;window.__xbTagStats=null;return 'ok'})()`);
        return ok({ action: 'clear' });
      }
    }
  },
});
