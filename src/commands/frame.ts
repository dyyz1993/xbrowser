import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const framesCommand = registerCommand({
  name: 'frames',
  description: 'List all frames in the current page (含跨域 OOPIF——它们只在浏览器级 target 列表可见；附 parentUrl/depth 层级)',
  scope: 'page',
  result: z.object({
    frames: z.array(z.object({
      index: z.number(),
      name: z.string().nullable(),
      url: z.string(),
      oopif: z.boolean().optional(),
      targetId: z.string().optional(),
      parentUrl: z.string().nullable().optional(),
      depth: z.number().nullable().optional(),
    })),
    warnings: z.array(z.string()).optional(),
  }),
  handler: async (_p, ctx: BrowserCommandContext) => {
    const discover = ctx.page.discoverFrames;
    const rawFrames = discover ? await discover.call(ctx.page) : ctx.page.frames();
    const mainUrl = ctx.page.url();
    const frameList: Array<{ index: number; name: string | null; url: string; oopif?: boolean; targetId?: string; parentUrl?: string | null; depth?: number | null }> =
      rawFrames.map((frame, index) => ({
        index,
        name: frame.name(),
        url: frame.url(),
        parentUrl: null,
        depth: null,
      }));
    // 主帧：深度 0、无父级
    const norm = (u: string): string => u.replace(/\/+$/, '');
    for (const e of frameList) {
      if (norm(e.url) === norm(mainUrl)) { e.parentUrl = null; e.depth = 0; }
    }

    // 追加跨域 OOPIF target：Page.getFrameTree 看不到它们（page-runtime 实证），
    // 只有浏览器级 Target.getTargets 列得出来——验证码/支付窗都在这里
    if (typeof ctx.page.listFrameTargets === 'function') {
      const targets = await ctx.page.listFrameTargets();
      const knownUrls = new Set(frameList.map((f) => f.url));
      for (const t of targets) {
        if (knownUrls.has(t.url)) continue; // 同 URL 已在 frame 树里（同进程 frame）
        frameList.push({ index: frameList.length, name: null, url: t.url, oopif: true, targetId: t.targetId, parentUrl: null, depth: null });
      }
    }

    // 层级重建：OOPIF 不在 CDP frame 树里（实测 getFrameTree 只有主帧），
    // 但父页面的 DOM 里看得到 <iframe src> 元素——逐层 DOM 巡航重建 parent/depth
    const warnings: string[] = [];
    try {
      const CHILDREN = `JSON.stringify([...document.querySelectorAll('iframe')].map(f=>({src:f.src||'',name:f.name||''})))`;
      const matchChild = (childSrc: string, frameUrl: string): boolean => {
        const a = norm(childSrc);
        const b = norm(frameUrl);
        return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
      };
      const childrenCache = new Map<string, Array<{ src: string; name: string }>>();
      const childrenOf = async (url: string): Promise<Array<{ src: string; name: string }>> => {
        const hit = childrenCache.get(url);
        if (hit) return hit;
        let out: Array<{ src: string; name: string }> = [];
        try {
          const raw = norm(url) === norm(mainUrl)
            ? await ctx.page.evaluate(CHILDREN)
            : await ctx.page.evaluateInFrame<string>(url, CHILDREN);
          out = JSON.parse(String(raw || '[]'));
        } catch { /* 加载中/无权限——按无子帧处理 */ }
        childrenCache.set(url, out);
        return out;
      };

      let frontier: Array<{ url: string; depth: number }> =
        frameList.filter((e) => e.depth === 0).map((e) => ({ url: e.url, depth: 0 }));
      for (let depth = 0; frontier.length > 0 && frameList.some((e) => e.depth === null) && depth < 6; depth++) {
        const next: Array<{ url: string; depth: number }> = [];
        for (const node of frontier) {
          const kids = await childrenOf(node.url);
          if (kids.length === 0) continue;
          for (const e of frameList) {
            if (e.depth !== null) continue;
            if (kids.some((k) => matchChild(k.src, e.url))) {
              e.parentUrl = node.url;
              e.depth = node.depth + 1;
              next.push({ url: e.url, depth: e.depth });
            }
          }
        }
        frontier = next;
      }
    } catch { /* 层级重建失败不影响平铺列表（parentUrl/depth 保持 null） */ }

    // URL 子串歧义告警：一个子串同时命中多个 frame 时 --frame 会选错对象
    const urls = frameList.map((e) => e.url);
    for (let i = 0; i < urls.length; i++) {
      for (let j = i + 1; j < urls.length; j++) {
        const a = urls[i];
        const b = urls[j];
        if (a && b && (a.includes(b) || b.includes(a))) {
          const shorter = a.includes(b) ? b : a;
          warnings.push(`URL 子串歧义："${shorter}" 同时命中 ${a} 和 ${b}——--frame 请写更长/更精确的子串`);
        }
      }
    }
    return ok({ frames: frameList, warnings });
  },
});

export const frameCommand = registerCommand({
  name: 'frame',
  description: 'Get frame info by index or name',
  scope: 'page',
  parameters: z.object({
    index: z.number().int().min(0).optional(),
    name: z.string().optional(),
  }),
  result: z.object({
    name: z.string().nullable(),
    url: z.string(),
    error: z.string().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const discover = ctx.page.discoverFrames;
    const rawFrames = discover ? await discover.call(ctx.page) : ctx.page.frames();
    let targetFrame;

    if (p.index !== undefined) {
      targetFrame = rawFrames[p.index];
    } else if (p.name !== undefined) {
      targetFrame = rawFrames.find((f) => f.name() === p.name);
    } else {
      return fail('Must provide index or name');
    }

    if (!targetFrame) {
      return fail('Frame not found');
    }

    return ok({
      name: targetFrame.name(),
      url: targetFrame.url(),
    });
  },
});
