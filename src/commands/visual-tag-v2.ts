import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { TAG_V2_SCRIPT } from './visual-tag-v2-script.js';

export { TAG_V2_SCRIPT } from './visual-tag-v2-script.js';

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

registerCommand({
  name: 'visual-tag-v2',
  description: '分色标注页面元素（红=可点击 蓝=输入 绿=图片 黄=列表 紫=数字 橙=文本）',
  scope: 'page',
  parameters: z.object({
    action: z.enum(['tag', 'lookup', 'clear', 'stats', 'by-type', 'find', 'export', 'interact']),
    id: z.string().optional().describe('lookup 时指定要查的 ID'),
    query: z.string().optional().describe('find 时指定搜索词（如 "找有AI编程标签的卡片"）'),
    type: z.string().optional().describe('by-type 时过滤类型：click/input/img/list/count/text'),
    'interact-action': z.enum(['click', 'fill', 'read']).optional().describe('interact 动作类型'),
    value: z.string().optional().describe('fill 时的填充值'),
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
      case 'interact': {
        // v10：自然语言直达交互——find + click/fill/read 一体化
        const query = (p as Record<string, unknown>).query as string;
        const pAny = p as Record<string, unknown>; const action = (pAny['interact-action'] || pAny.interactAction || pAny.interact_action) as string;
        const value = pAny.value as string;
        if (!query) return fail('interact 需要 --query 参数');
        if (!action) return fail('interact 需要 --interact-action 参数（click/fill/read）');

        // 1) find：用 query 找元素
        const findResult = await ctx.page.evaluate<string>(
          `(function(){
            var map = window.__xbTagSerializable;
            if (!map) return JSON.stringify({err:'no-map'});
            var query = ${JSON.stringify(query)};
            var results = [];
            for (var id in map) {
              var e = map[id];
              var text = (e.text || '').toLowerCase();
              if (text.includes(query.toLowerCase())) {
                results.push({id:id, type:e.type, text:e.text, num:e.num, label:e.formLabel});
              }
            }
            // 类型匹配
            var typeMap = {button:'click', link:'click', 按钮:'click', 图片:'img', image:'img',
                          输入:'input', input:'input', 列表:'list', 数字:'count', count:'count'};
            for (var tk in typeMap) {
              if (query.toLowerCase().includes(tk)) {
                for (var id2 in map) {
                  if (map[id2].type === typeMap[tk]) {
                    results.push({id:id2, type:map[id2].type, text:map[id2].text, num:map[id2].num, label:map[id2].formLabel});
                  }
                }
              }
            }
            return JSON.stringify({total:results.length, results:results.slice(0,10)});
          })()`,
        );
        const parsed = JSON.parse(findResult) as { err?: string; total?: number; results?: Array<{id:string; type:string; text:string; label?:string}> };
        if (parsed.err) return fail(parsed.err);
        if (!parsed.total || !parsed.results?.length) return fail(`未找到匹配 "${query}" 的元素`);

        // 取第一个匹配
        const target = parsed.results[0];

        // 2) 根据 action 执行
        if (action === 'read') {
          return ok({ action: 'interact', query, target, result: { read: target.text || target.label } });
        }

        if (action === 'click') {
          // 用 trustedClick 或 CDP click
          const el = await ctx.page.evaluate<{ x:number; y:number } | null>(
            `(function(){
              var map = window.__xbTagMap;
              if (!map) return null;
              var entry = map[${JSON.stringify(target.id)}];
              if (!entry || !entry._el) return null;
              var r = entry._el.getBoundingClientRect();
              return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)};
            })()`,
          );
          if (!el) return fail(`元素 ${target.id} 不可交互`);
          await ctx.page.mouse.click(el.x, el.y, { stealth: true });
          return ok({ action: 'interact', query, target, result: { clicked: true, x: el.x, y: el.y } });
        }

        if (action === 'fill') {
          if (!value) return fail('fill 需要 --value 参数');
          const el = await ctx.page.evaluate<{ x:number; y:number } | null>(
            `(function(){
              var map = window.__xbTagMap;
              if (!map) return null;
              var entry = map[${JSON.stringify(target.id)}];
              if (!entry || !entry._el) return null;
              var r = entry._el.getBoundingClientRect();
              return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)};
            })()`,
          );
          if (!el) return fail(`元素 ${target.id} 不可交互`);
          // click 聚焦 + 键盘输入
          await ctx.page.mouse.click(el.x, el.y, { stealth: true });
          await ctx.page.keyboard.type(value, { stealth: true });
          return ok({ action: 'interact', query, target, result: { filled: true, value } });
        }

        return fail(`未知 action: ${action}`);
      }
      case 'export': {
        const result = await ctx.page.evaluate<string>(
          `(function(){
            var map = window.__xbTagSerializable;
            if (!map) return JSON.stringify({err:'no-map'});
            // 按 type 分组统计
            var byType = {};
            for (var id in map) {
              var t = map[id].type || 'unknown';
              byType[t] = (byType[t] || 0) + 1;
            }
            // 构建层级树（parent → children）
            var tree = {};
            var roots = [];
            for (var id2 in map) {
              var parent = map[id2].parent;
              if (parent && map[parent]) {
                if (!tree[parent]) tree[parent] = [];
                tree[parent].push(id2);
              } else {
                roots.push(id2);
              }
            }
            // elements 导出摘要（完整 DOM 映射太大，只导核心字段）
            var elementsOut = {};
            for (var id3 in map) {
              elementsOut[id3] = {
                type: map[id3].type,
                text: (map[id3].text || '').slice(0, 20),
                num: map[id3].num,
                label: map[id3].formLabel,
                frame: map[id3].frame,
                parent: map[id3].parent,
                table: map[id3].table ? {col: map[id3].table.col, row: map[id3].table.rowIndex} : null
              };
            }
            return JSON.stringify({
              total: Object.keys(map).length,
              byType: byType,
              rootIds: roots.slice(0, 20),
              hierarchy: Object.keys(tree).slice(0, 50).reduce(function(acc, k) { acc[k] = tree[k]; return acc; }, {}),
              elements: elementsOut
            });
          })()`,
        );
        const parsed = JSON.parse(result) as Record<string, unknown>;
        if (parsed.err) return fail(String(parsed.err));
        return ok({ action: 'export', element: parsed });
      }
      case 'clear': {
        await ctx.page.evaluate(`(function(){var o=document.getElementById('__xb-tag-overlay');if(o)o.remove();window.__xbTagMap=null;window.__xbTagStats=null;return 'ok'})()`);
        return ok({ action: 'clear' });
      }
    }
  },
});
