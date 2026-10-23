import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import type { Mouse } from '../browser-shim.js';
import { registerCommand } from './command-registry.js';

export const mouseCommand = registerCommand({
  name: 'mouse',
  description: 'Control the mouse (move, click, wheel, etc.) (--frame <url-substring> 时在跨域 iframe 内操作，坐标为 iframe 局部坐标)',
  scope: 'page',
  parameters: z.object({
    action: z.enum(['move', 'down', 'up', 'click', 'dblclick', 'drag', 'wheel']),
    x: z.coerce.number(),
    y: z.coerce.number(),
    'delta-x': z.coerce.number().optional().describe('wheel 动作：横向滚动量（正值向右）'),
    'delta-y': z.coerce.number().optional().describe('wheel 动作：纵向滚动量（正值向下）'),
    button: z.enum(['left', 'right', 'middle']).optional(),
    steps: z.coerce.number().optional(),
    frame: z.string().optional().describe('URL 含此子串的 OOPIF——输入派发到 iframe 自己的 session（跨域 iframe 唯一可信通道），坐标用 iframe 局部坐标系'),
  }),
  result: z.object({
    action: z.enum(['move', 'down', 'up', 'click', 'dblclick', 'drag', 'wheel']),
    x: z.number(),
    y: z.number(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const button = p.button || 'left';
    // 全局 --frame 作默认值，命令级 --frame 优先
    const frame = p.frame ?? ctx.frame;
    const dispatch = async (mouse: Mouse): Promise<void> => {
      switch (p.action) {
      case 'move':
        await mouse.move(p.x, p.y, { steps: p.steps || 1 });
        break;
      case 'down':
        // A real press happens AT the coordinates — move first, otherwise the
        // dispatch goes to the stale internal position (0,0) and misses the
        // target entirely (rec-duel d08: slider grab at pointerdown 0,0).
        await mouse.move(p.x, p.y);
        await mouse.down({ button });
        break;
      case 'up':
        await mouse.move(p.x, p.y);
        await mouse.up({ button });
        break;
      case 'click':
        await mouse.click(p.x, p.y, { button });
        break;
      case 'dblclick':
        await mouse.dblclick(p.x, p.y, { button });
        break;
      case 'drag':
        // 从当前鼠标位置拖到 (x,y) —— 驱动真实 HTML5 DnD 管线（d59 实测：
        // dragstart→dragover…→drop→dragend 全 trusted）
        await mouse.drag(p.x, p.y, p.steps ? { steps: p.steps } : {});
        break;
      case 'wheel':
        // trusted 滚轮（mouseWheel 事件）——frame 路由时在 iframe 局部坐标滚动
        await mouse.wheelAt(p.x, p.y, Number(p['delta-x'] ?? 0), Number(p['delta-y'] ?? 0));
        break;
      }
    };
    if (frame) {
      // frame session 中途失效（OOPIF 重建）→ 重 attach 重做一次；
      // drag 依赖"从当前位置拖"语义，失效后位置归零，须重读坐标再拖
      try {
        await ctx.page.runFrameMouse(frame, dispatch);
      } catch (err) {
        if (p.action === 'drag' && /session/i.test(String(err))) {
          throw new Error(`frame session 在拖动中失效（iframe 可能已重建）——重新用 eval --frame 读取目标坐标后再拖`);
        }
        throw err;
      }
    } else {
      await dispatch(ctx.page.mouse);
    }
    return ok({ action: p.action, x: p.x, y: p.y });
  },
});
