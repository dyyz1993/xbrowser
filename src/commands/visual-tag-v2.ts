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
    var hasOnlySvgChildren = true;
    for (var ci = 0; ci < el.children.length; ci++) {
      if (el.children[ci].tagName.toUpperCase() !== 'SVG' && el.children[ci].tagName.toUpperCase() !== 'PATH' && el.children[ci].tagName.toUpperCase() !== 'SPAN') { hasOnlySvgChildren = false; break; }
    }
    if ((el.children.length === 0 || hasOnlySvgChildren) && text.length > 0 && text.length < 25) {
      var numMatch = /^[0-9]/.test(text) && text.length < 20;
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

    // 优先级4.5：表格单元格
    if (tag === 'TD' || tag === 'TH') return 'list';

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

  var all = document.querySelectorAll('button, a[href], td, th, input, select, textarea, img, ul, ol, li, svg, [onclick], [role="button"], [contenteditable], [aria-label], [data-target], [class*="btn"], [class*="list"], [class*="item"], [class*="count"], [class*="num"], [class*="like"], [class*="comment"], [class*="stat"], [class*="card"], [class*="tab"], [class*="menu"], [class*="nav"], [class*="link"], [class*="Link"], [class*="Card"]');

  for (var i = 0; i < all.length && i < 3000; i++) {
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

    // v7：表格语义——单元格 → 列名 + 行号
    var tableInfo = null;
    if (el.tagName === 'TD' || el.tagName === 'TH') {
      var table = el.closest('table');
      if (table) {
        var row = el.closest('tr');
        var cellIndex = el.cellIndex;
        var rowIndex = row ? row.rowIndex : -1;
        // 找表头（thead 的 th 或第一行的 th）
        var header = table.querySelector('thead th:nth-child(' + (cellIndex + 1) + ')') ||
                     table.querySelector('tr:first-child th:nth-child(' + (cellIndex + 1) + ')');
        var colName = header ? header.textContent.trim() : 'col-' + (cellIndex + 1);
        tableInfo = { col: colName, colIndex: cellIndex, rowIndex: rowIndex, value: el.textContent.trim().slice(0, 20) };
      }
    }

    window.__xbTagMap[id] = {
      type: type,\n      parent: parentId,\n      _el: el,
      formLabel: formLabel,\n      table: tableInfo,
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

  // v9：跨 frame 标注——递归处理同源 iframe 内的元素
  function tagFrame(doc, offsetX, offsetY) {
    var frameAll = doc.querySelectorAll('button, a[href], input, select, textarea, img, [onclick], [role=button], [contenteditable], [aria-label]');
    for (var fi = 0; fi < frameAll.length && fi < 100; fi++) {
      var fel = frameAll[fi];
      var fr = fel.getBoundingClientRect();
      if (fr.width < 8 || fr.height < 8) continue;
      var fType = classifyElement(fel);
      if (!fType) continue;
      var fId = genId(TYPE_PREFIX[fType] || 't', counters[fType]);
      counters[fType]++;
      var fColors = COLORS[fType];
      // 坐标偏移到主文档 Canvas（iframe 在主文档中的位置 + 元素在 iframe 中的位置）
      var fx = fr.x + offsetX, fy = fr.y + offsetY;
      ctx.fillStyle = fColors.fill;
      ctx.fillRect(fx - 2, fy - 14, fId.length * 7 + 6, 14);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.strokeRect(fx - 2, fy - 14, fId.length * 7 + 6, 14);
      ctx.fillStyle = '#000'; ctx.font = 'bold 11px monospace';
      ctx.fillText(fId, fx + 1, fy - 4);
      ctx.strokeStyle = fColors.stroke; ctx.lineWidth = 1.5;
      ctx.strokeRect(fx, fy, fr.width, fr.height);
      window.__xbTagMap[fId] = {
        type: fType, tagName: fel.tagName,
        text: (fel.textContent||'').trim().slice(0,40),
        num: (fel.textContent||'').trim().match(/[0-9,.]+/)?.[0] || null,
        formLabel: (fel.getAttribute('aria-label')||fel.getAttribute('placeholder')||'').slice(0,30) || null,
        frame: 'iframe',
        _el: fel,
        rect: {x:Math.round(fx),y:Math.round(fy),w:Math.round(fr.width),h:Math.round(fr.height)},
        selector: (function(e){return e.id?'#'+e.id:e.tagName.toLowerCase()}) (fel)
      };
    }
    // 递归处理嵌套 iframe
    var nestedFrames = doc.querySelectorAll('iframe');
    for (var nf = 0; nf < nestedFrames.length; nf++) {
      try {
        var nestedDoc = nestedFrames[nf].contentDocument;
        if (!nestedDoc) continue;
        var nestedRect = nestedFrames[nf].getBoundingClientRect();
        tagFrame(nestedDoc, nestedRect.x, nestedRect.y);
      } catch(e) { /* 跨域 iframe 跳过 */ }
    }
  }
  // 遍历主文档的所有同源 iframe
  var mainFrames = document.querySelectorAll('iframe');
  for (var mf = 0; mf < mainFrames.length; mf++) {
    try {
      var mDoc = mainFrames[mf].contentDocument;
      if (!mDoc) continue;
      var mRect = mainFrames[mf].getBoundingClientRect();
      tagFrame(mDoc, mRect.x, mRect.y);
    } catch(e) { /* 跨域跳过 */ }
  }

  // v8：动态标注——MutationObserver 监听新元素，自动补充标注
  if (window.__xbTagObserver) { window.__xbTagObserver.disconnect(); }
  window.__xbTagObserver = new MutationObserver(function(mutations) {
    var needsRetag = false;
    for (var mi = 0; mi < mutations.length; mi++) {
      if (mutations[mi].addedNodes.length > 0) { needsRetag = true; break; }
    }
    if (!needsRetag) return;
    // v8.1：清理被移除元素的标注（死标注会留在 Canvas 上）
    for (var ri = 0; ri < mutations.length; ri++) {
      var removed = mutations[ri].removedNodes;
      for (var rj = 0; rj < removed.length; rj++) {
        var removedNode = removed[rj];
        if (!removedNode.tagName) continue;
        for (var rk in window.__xbTagMap) {
          var entry = window.__xbTagMap[rk];
          if (entry._el === removedNode || (entry._el && removedNode.contains && removedNode.contains(entry._el))) {
            delete window.__xbTagMap[rk];
            window.__xbTagStats.total--;
          }
        }
      }
    }
    // 防抖：300ms 内的连续变化只触发一次重标注
    clearTimeout(window.__xbTagRetagTimer);
    window.__xbTagRetagTimer = setTimeout(function() {
      // 只标注新增的可见元素（不重画整个 Canvas）
      var ctx2 = document.getElementById('__xb-tag-overlay');
      if (!ctx2) return;
      var canvas2 = ctx2.getContext('2d');
      for (var ni = 0; ni < mutations.length; ni++) {
        var nodes = mutations[ni].addedNodes;
        for (var nj = 0; nj < nodes.length; nj++) {
          var node = nodes[nj];
          if (!node.getBoundingClientRect) continue;
          var r = node.getBoundingClientRect();
          if (r.width < 8 || r.height < 8) continue;
          // 分类并标注
          var newType = classifyElement(node);
          if (!newType) continue;
          var newId = genId(TYPE_PREFIX[newType] || 't', counters[newType]);
          counters[newType]++;
          var colors = COLORS[newType];
          canvas2.fillStyle = colors.fill;
          canvas2.fillRect(r.x - 2, r.y - 14, newId.length * 7 + 6, 14);
          canvas2.strokeStyle = '#000';
          canvas2.lineWidth = 1;
          canvas2.strokeRect(r.x - 2, r.y - 14, newId.length * 7 + 6, 14);
          canvas2.fillStyle = '#000';
          canvas2.font = 'bold 11px monospace';
          canvas2.fillText(newId, r.x + 1, r.y - 4);
          canvas2.strokeStyle = colors.stroke;
          canvas2.lineWidth = 1.5;
          canvas2.strokeRect(r.x, r.y, r.width, r.height);
          // 存映射
          var parentId = null;
          var parentNode = node.parentElement;
          while (parentNode && parentNode !== document.body) {
            for (var pk in window.__xbTagMap) {
              if (window.__xbTagMap[pk]._el === parentNode) { parentId = pk; break; }
            }
            if (parentId) break;
            parentNode = parentNode.parentElement;
          }
          window.__xbTagMap[newId] = { type: newType, tagName: node.tagName, text: (node.textContent||'').trim().slice(0,40), parent: parentId, _el: node, rect: {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)} };
          window.__xbTagStats.total++;
        }
      }
      // 更新 serializable
      var ser = {};
      for (var sk2 in window.__xbTagMap) {
        var item = {};
        for (var key in window.__xbTagMap[sk2]) { if (key !== '_el') item[key] = window.__xbTagMap[sk2][key]; }
        ser[sk2] = item;
      }
      window.__xbTagSerializable = ser;
    }, 300);
  });
  window.__xbTagObserver.observe(document.body, { childList: true, subtree: true });

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
