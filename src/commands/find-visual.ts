import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import { registerCommand } from './command-registry.js';
import type { BrowserCommandContext } from '../context.js';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * find-visual — 截图 + VLM 定位 + （可选）点击
 *
 * 视觉级元素定位：对 DOM 死角（canvas、closed shadow root、空壳反爬页、
 * 混合渲染 UI）用 GLM 视觉模型在截图上找元素框，转成页面坐标，
 * 可直接 --click 派发真实鼠标事件。
 */

/** Read VLM credentials from the zcode provider config (never logged). */
function loadVLMCredentials(): { apiKey: string; baseURL: string; model: string } | null {
  const candidates = [
    process.env.XBROWSER_VLM_CONFIG,
    join(homedir(), '.zcode', 'v2', 'config.json'),
  ].filter(Boolean) as string[];
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      const cfg = JSON.parse(readFileSync(file, 'utf8'));
      const provider = Object.values(cfg.provider ?? {})[0] as
        | { options?: { apiKey?: string; baseURL?: string }; models?: Record<string, unknown> }
        | undefined;
      if (provider?.options?.apiKey && provider.options.baseURL) {
        const models = Object.keys(provider.models ?? {});
        // Prefer a dedicated VL model, else flash-tier (grounded pointing),
        // else flagship. Grounded flash models locate small UI elements far
        // better than reasoning flagships, which estimate (~±300px off).
        const vl = models.find((m) => /vl|vision/i.test(m));
        const flash = models.find((m) => /flash/i.test(m) && /5\.?3/i.test(m));
        return {
          apiKey: provider.options.apiKey,
          baseURL: provider.options.baseURL.replace(/\/$/, ''),
          model: process.env.XBROWSER_VLM_MODEL || vl || flash || models.find((m) => /5\.[23]/.test(m)) || models[0],
        };
      }
    } catch { /* try next */ }
  }
  return null;
}

interface VisualHit {
  label: string;
  /** Bounding box in screenshot pixels (origin: top-left of the image) */
  box: { x: number; y: number; width: number; height: number };
  confidence: 'high' | 'medium' | 'low';
}

/** Ask the VLM to locate the target and return a bounding box in image pixels. */
async function locateByVLM(
  creds: { apiKey: string; baseURL: string; model: string },
  imageBase64: string,
  target: string,
  feedback?: string,
): Promise<VisualHit | null> {
  const prompt = `你在一张网页截图上定位 UI 元素。目标元素描述："""${target}"""

严格只输出一个 JSON 对象（无 markdown、无解释）：
{"label":"<元素名>","box":{"x":<左上x>,"y":<左上y>,"width":<宽>,"height":<高>},"confidence":"high|medium|low"}
坐标以截图左上角为原点、单位为像素。找不到元素则输出 {"label":null}。
${feedback ? `注意：${feedback}` : ''}`;

  const resp = await fetch(creds.baseURL + '/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': creds.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: creds.model,
      max_tokens: 2000, // thinking 模型的思考块也计入配额，300 会在 text 前截断
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) throw new Error(`VLM HTTP ${resp.status}`);
  const data = await resp.json() as { content?: Array<{ type: string; text?: string }> };
  const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    console.error('[find-visual] VLM raw (no JSON):', text.substring(0, 200));
    return null;
  }
  const hit = JSON.parse(m[0]) as VisualHit & { label: string | null };
  if (!hit.label || !hit.box) return null;
  return hit;
}

export const findVisualCommand = registerCommand({
  name: 'find-visual',
  description: 'Visual element location: screenshot → VLM → page coordinates (optionally click)',
  scope: 'page',
  parameters: z.object({
    element: z.string().describe('元素的自然语言描述，如 "红色的登录按钮"（注意：--target 是全局页面路由参数，此处用 --element）'),
    click: z.boolean().optional().describe('找到后立即点击（真实鼠标事件）'),
    threshold: z.coerce.number().optional().describe('置信度阈值，低于则报 not-found（默认 0）'),
    zoom: z.boolean().optional().describe('二段式放大精修（默认开）——粗框区域二次截图让 VLM 精确定位'),
  }),
  result: z.object({
    found: z.boolean(),
    element: z.string(),
    box: z.unknown().optional(),
    center: z.unknown().optional(),
    confidence: z.string().optional(),
    model: z.string().optional(),
    clicked: z.boolean().optional(),
    screenshot: z.string().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const page = ctx.page;

    const creds = loadVLMCredentials();
    if (!creds) {
      return fail('未找到 VLM 凭据：需要 ~/.zcode/v2/config.json 的 provider 配置或 XBROWSER_VLM_CONFIG 环境变量', [
        '也可用 XBROWSER_VLM_MODEL 指定模型（默认自动选 VL/旗舰模型）',
      ]);
    }

    // 1. Screenshot (viewport, PNG → base64)
    const buffer = await page.screenshot({ type: 'png' });
    const imageBase64 = buffer.toString('base64');
    // PNG IHDR dims (bytes 16-24) — needed for bounds validation before scaling
    const imgW = buffer.readUInt32BE(16);
    const imgH = buffer.readUInt32BE(20);

    // 2. VLM locate with bounds feedback loop: VLMs hallucinate coordinates
    // (real test: center x=1680 on a 1440px viewport). Re-ask with the
    // violation when the box is out of bounds or degenerate.
    let hit: VisualHit | null = null;
    let feedback = '';
    try {
      for (let attempt = 0; attempt < 3 && !hit; attempt++) {
        const candidate = await locateByVLM(creds, imageBase64, p.element, feedback);
        if (!candidate) break;
        const b = candidate.box;
        const inBounds = b.x >= 0 && b.y >= 0
          && b.x + b.width <= imgW + 2
          && b.y + b.height <= imgH + 2;
        const sane = b.width > 2 && b.height > 2;
        if (inBounds && sane) { hit = candidate; break; }
        feedback = `上次输出 box=${JSON.stringify(b)} 无效（${!inBounds ? '超出图像边界' : '尺寸过小'}）。请基于截图重新仔细定位，坐标原点在图像左上角。`;
      }
    } catch (e) {
      return fail(`VLM 调用失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!hit) {
      return ok({ found: false, element: p.element, model: creds.model }, [
        `截图中未找到: ${p.element}`,
      ]);
    }

    // 2.5 Two-stage zoom refine: re-screenshot the coarse box region via CDP
    // clip (Chromium-native crop, no image lib), ask the VLM to locate within
    // the zoomed view, map back. Small-element precision insurance.
    if (p.zoom !== false && hit) {
      try {
        const pad = Math.max(20, Math.round(Math.max(hit.box.width, hit.box.height) * 0.5));
        const clip = {
          x: Math.max(0, hit.box.x - pad),
          y: Math.max(0, hit.box.y - pad),
          width: Math.min(imgW - Math.max(0, hit.box.x - pad), hit.box.width + pad * 2),
          height: Math.min(imgH - Math.max(0, hit.box.y - pad), hit.box.height + pad * 2),
        };
        if (clip.width > 8 && clip.height > 8) {
          const zoomBuf = await page.screenshot({ type: 'png', clip });
          const zoomB64 = zoomBuf.toString('base64');
          const zoomW = zoomBuf.readUInt32BE(16);
          const zoomH = zoomBuf.readUInt32BE(20);
          const refined = await locateByVLM(creds, zoomB64, p.element);
          if (refined) {
            const rb = refined.box;
            const inZoom = rb.x >= 0 && rb.y >= 0
              && rb.x + rb.width <= zoomW + 2 && rb.y + rb.height <= zoomH + 2
              && rb.width > 2 && rb.height > 2;
            if (inZoom) {
              // Map zoom-local coords back to viewport image coords
              hit = {
                label: refined.label || hit.label,
                box: {
                  x: clip.x + rb.x,
                  y: clip.y + rb.y,
                  width: rb.width,
                  height: rb.height,
                },
                confidence: refined.confidence === 'low' ? hit.confidence : refined.confidence,
              };
            }
          }
        }
      } catch { /* zoom refine is best-effort — coarse hit stands */ }
    }

    if (p.threshold !== undefined) {
      const rank: Record<string, number> = { high: 3, medium: 2, low: 1 };
      const thresholdName = p.threshold >= 3 ? 'high' : p.threshold >= 2 ? 'medium' : 'low';
      if ((rank[hit.confidence ?? 'low'] ?? 1) < (rank[thresholdName] ?? 1)) {
        return ok({ found: false, element: p.element, confidence: hit.confidence, box: hit.box, model: creds.model }, [
          `置信度 ${hit.confidence} 低于阈值 ${p.threshold}`,
        ]);
      }
    }

    // 3. Image pixels → page coordinates. page.screenshot captures the
    // viewport at CSS-pixel scale (device pixel ratio applied by the encoder).
    // Verify scale: ask the page for innerWidth and the PNG's natural size.
    const viewport = await page.evaluate('JSON.stringify({w: window.innerWidth, h: window.innerHeight})')
      .then((v: unknown) => JSON.parse(String(v)) as { w: number; h: number })
      .catch(() => ({ w: 1280, h: 800 }));
    // PNG pixel dims: parse IHDR (bytes 16-24) — avoids a decoder dependency
    const pngW = buffer.readUInt32BE(16);
    const pngH = buffer.readUInt32BE(20);
    const scaleX = viewport.w / pngW;
    const scaleY = viewport.h / pngH;

    const center = {
      x: Math.round((hit.box.x + hit.box.width / 2) * scaleX),
      y: Math.round((hit.box.y + hit.box.height / 2) * scaleY),
    };

    // 4. Optional click via real mouse input (stealth trajectory included)
    let clicked = false;
    if (p.click) {
      await page.mouse.click(center.x, center.y, { stealth: true });
      clicked = true;
    }

    return ok({
      found: true,
      element: p.element,
      box: hit.box,
      center,
      confidence: hit.confidence,
      model: creds.model,
      clicked,
      screenshot: `data:image/png;base64,${imageBase64.substring(0, 64)}... (${Math.round(imageBase64.length / 1024)}KB)`,
    }, [
      clicked
        ? `已点击 (${center.x}, ${center.y}) — ${hit.label} [${hit.confidence}]`
        : `定位到 "${hit.label}" 中心 (${center.x}, ${center.y}) [${hit.confidence}] — 加 --click 执行点击`,
    ]);
  },
});
