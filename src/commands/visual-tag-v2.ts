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
    var text = (el.textContent || '').trim();
    var cls = el.className || '';

    // 优先级1：数字/计数器——先于列表（S129 遗留问题修复）
    if (el.children.length === 0 && text.length > 0 && text.length < 20) {
      var numMatch = text.match(/^[0-9,.]+\\s*(万|亿|k|K|M|\\+|人|次|条|篇|个|评|赞|分|星)?$/);
      if (numMatch) return 'count';
    }
    // 优先级1.5：class 含 count/num/like/star/fork 的容器
    if (/count|num\b|like|star|fork|rating|badge/i.test(cls) && el.children.length <= 2) return 'count';

    // 优先级2：输入框
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        el.getAttribute('contenteditable')) return 'input';

    // 优先级3：可点击（v3 扩宽：data-target/onclick/tab/menu/nav/link class）
    if (tag === 'BUTTON' || (el.getAttribute('role') === 'button') ||
        (tag === 'A' && el.getAttribute('href')) ||
        el.hasAttribute('onclick') || el.hasAttribute('data-target') ||
        /btn|button|click|action|tab\b|menu|nav\b|link\b/i.test(cls)) return 'click';

    // 优先级4：图片（v3：含 SVG 图标）
    if (tag === 'IMG' || (tag === 'SVG') ||
        (el.querySelector && el.querySelector('img,svg') &&
         el.children.length <= 2 && !text)) return 'img';

    // 优先级5：列表（v3：加 card）
    if (tag === 'UL' || tag === 'OL' || tag === 'LI' ||
        /list|item|feed|timeline|card/i.test(cls)) return 'list';

    // 优先级6：文本
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

  var all = document.querySelectorAll('button, a[href], input, select, textarea, img, ul, ol, li, svg, [onclick], [role="button"], [contenteditable], [aria-label], [data-target], [class*="btn"], [class*="list"], [class*="item"], [class*="count"], [class*="num"], [class*="like"], [class*="comment"], [class*="stat"], [class*="card"], [class*="tab"], [class*="menu"], [class*="nav"], [class*="link"]');

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

    // v4：查父级标注 ID（嵌套关系）
    var parentId = null;
    var parentNode = el.parentElement;
    while (parentNode && parentNode !== document.body) {
      for (var pk in window.__xbTagMap) {
        if (window.__xbTagMap[pk]._el === parentNode) { parentId = pk; break; }
      }
      if (parentId) break;
      parentNode = parentNode.parentElement;
    }

    // v6：表单语义——识别 input 的关联 label
    var formLabel = null;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      var inputId = el.id;
      if (inputId) {
        var lbl = document.querySelector('label[for="' + inputId + '"]');
        if (lbl) formLabel = lbl.textContent.trim();
      }
      if (!formLabel) {
        var aria = el.getAttribute('aria-label');
        if (aria) formLabel = aria;
      }
      if (!formLabel) {
        var ph = el.getAttribute('placeholder');
        if (ph) formLabel = '(placeholder) ' + ph;
      }
      if (!formLabel) {
        var parentLbl = el.closest('label');
        if (parentLbl) formLabel = parentLbl.textContent.trim().slice(0, 30);
      }
      if (!formLabel) {
        var prev = el.previousElementSibling;
        if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV') && prev.textContent.trim()) {
          formLabel = '(adjacent) ' + prev.textContent.trim().slice(0, 30);
        }
      }
    }

    window.__xbTagMap[id] = {
      type: type,\n      parent: parentId,\n      _el: el,
      formLabel: formLabel,
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

  // v4：生成可序列化版本（去掉 _el DOM 引用）
  var serializable = {};
  for (var sk in window.__xbTagMap) {
    var item = {};
    for (var key in window.__xbTagMap[sk]) {
      if (key !== '_el') item[key] = window.__xbTagMap[sk][key];
    }
    serializable[sk] = item;
  }
  window.__xbTagSerializable = serializable;
  window.__xbTagStats = { total: Object.keys(window.__xbTagMap).length, byType: counters };
  return JSON.stringify(window.__xbTagStats);
})()
`;

export const visualTagV2Command = registerCommand({
  name: 'visual-tag-v2',
  description: '分色标注页面元素（红=可点击 蓝=输入 绿=图片 黄=列表 紫=数字 橙=文本）',
  scope: 'page',
  parameters: z.object({
    action: z.enum(['tag', 'lookup', 'clear', 'stats', 'by-type', 'find']),
    id: z.string().optional().describe('lookup 时指定要查的 ID'),
    query: z.string().optional().describe('find 时指定搜索词（如 "找有AI编程标签的卡片"）'),
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
          `(function(){var m=window.__xbTagMap;if(!m)return'{}';var out={};for(var k in m){if(!${JSON.stringify(p.type || '')}||m[k].type===${JSON.stringify(p.type || '')}){out[k]={type:m[k].type,text:m[k].text,num:m[k].num,label:m[k].formLabel}}}return JSON.stringify(out)})()`,
        );
        return ok({ action: 'by-type', element: JSON.parse(result) as Record<string, unknown> });
      }
      case 'find': {
        // v5：语义搜索——用文字描述找元素
        const query = (p as Record<string, unknown>).query as string;
        if (!query) return fail('find 需要 --query 参数（如 "找有AI编程标签的卡片"）');
        const result = await ctx.page.evaluate<string>(
          `(function(){
            var map = window.__xbTagSerializable;
            if (!map) return JSON.stringify({err:'no-map'});
            var query = ${JSON.stringify(query)};
            var results = [];
            // 1) 直接文本匹配
            for (var id in map) {
              var e = map[id];
              var text = (e.text || '').toLowerCase();
              var q = query.toLowerCase();
              if (text.includes(q)) {
                results.push({id:id, type:e.type, text:e.text, num:e.num, parent:e.parent, reason:'text-match'});
              }
            }
            // 2) 类型匹配（query 含"按钮"/"链接"/"图片"/"数字"等）
            var typeMap = {button:'click', link:'click', 按钮:'click', 链接:'click', 图片:'img', image:'img',
                          输入:'input', input:'input', 列表:'list', list:'list', 卡片:'list', card:'list',
                          数字:'count', count:'count', 计数:'count', 文本:'text'};
            for (var tk in typeMap) {
              if (query.toLowerCase().includes(tk)) {
                for (var id2 in map) {
                  if (map[id2].type === typeMap[tk]) {
                    results.push({id:id2, type:map[id2].type, text:map[id2].text, num:map[id2].num, parent:map[id2].parent, reason:'type-match:'+tk});
                  }
                }
              }
            }
            // 3) 数字匹配（query 含数字）
            var numMatch = query.match(/([0-9,.]+)/);
            if (numMatch && map) {
              var target = parseFloat(numMatch[1].replace(/,/g,''));
              for (var id3 in map) {
                if (map[id3].num && parseFloat(map[id3].num.replace(/,/g,'')) === target) {
                  results.push({id:id3, type:map[id3].type, text:map[id3].text, num:map[id3].num, parent:map[id3].parent, reason:'num-match'});
                }
              }
            }
            return JSON.stringify({total:results.length, results:results.slice(0,20)});
          })()`,
        );
        return ok({ action: 'find', query, element: JSON.parse(result) as Record<string, unknown> });
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
