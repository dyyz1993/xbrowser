import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import { registerCommand } from './command-registry.js';
import type { BrowserCommandContext } from '../context.js';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * vision-task — 视觉循环 Agent
 *
 * observe（截图）→ decide（VLM 决策下一步）→ act（CDP 执行）→ verify（变化确认）
 * 循环直到 VLM 判定任务完成或步数/超时上限。全程纯视觉感知，不依赖 DOM
 * 选择器 —— 面向 DOM 死角页面（canvas/closed shadow/空壳反爬页）。
 *
 * 复用 find-visual 的凭据发现与坐标幻觉防御。
 */

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

type VLMImage = { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } };
type VLMText = { type: 'text'; text: string };
type VLMContent = Array<VLMImage | VLMText>;

async function vlmAsk(
  creds: { apiKey: string; baseURL: string; model: string },
  content: VLMContent,
  maxTokens = 2000,
): Promise<string> {
  const resp = await fetch(creds.baseURL + '/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': creds.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: creds.model, max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!resp.ok) throw new Error(`VLM HTTP ${resp.status}`);
  const data = await resp.json() as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
}

/** vlmAsk with empty-reply retry: transitional pages (nav spinner) can elicit
 *  empty text blocks from the model — one blind retry usually resolves it. */
async function vlmAskRetry(
  creds: { apiKey: string; baseURL: string; model: string },
  content: VLMContent,
  maxTokens = 2000,
): Promise<string> {
  let last = '';
  for (let i = 0; i < 2; i++) {
    last = await vlmAsk(creds, content, maxTokens);
    if (last.trim()) return last;
    await new Promise((r) => setTimeout(r, 1200));
  }
  return last;
}

function pngDims(b64: string): { w: number; h: number } {
  const buf = Buffer.from(b64, 'base64');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

interface AgentDecision {
  thought: string;
  action:
    | { type: 'click'; x: number; y: number }
    | { type: 'type'; text: string }
    | { type: 'key'; key: string }
    | { type: 'scroll'; direction: 'up' | 'down'; amount: number }
    | { type: 'done'; summary: string }
    | { type: 'stuck'; reason: string };
}

/** Parse a decision JSON out of the VLM reply (tolerates prose/thinking noise). */
function parseDecision(text: string): AgentDecision | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as AgentDecision;
    if (!j.action || !j.action.type) return null;
    return j;
  } catch { return null; }
}

const SYSTEM_PROMPT = `你是浏览器视觉操作 Agent。根据截图和任务历史，决定下一个动作。

严格只输出一个 JSON（无 markdown）：
{"thought":"<简短推理>","action":{"type":"click","x":<int>,"y":<int>}
  或 {"type":"type","text":"<要输入的文字>"}（输入前须已点击聚焦输入框）
  或 {"type":"key","key":"Enter"}（key 名：Enter/Tab/Escape/ArrowDown…）
  或 {"type":"scroll","direction":"down","amount":<px>}
  或 {"type":"done","summary":"<任务完成摘要>"}
  或 {"type":"stuck","reason":"<无法继续的原因>"}}

坐标以截图左上角为原点、像素为单位。规则：
1. 每次只做一个动作；输入文字前确认输入框已聚焦（上一步是 click 输入框）
2. 页面无明显变化时换策略，不要重复同一动作超过 2 次
3. 任务目标达成立即输出 done；5 步无进展输出 stuck`;

export const visionTaskCommand = registerCommand({
  name: 'vision-task',
  description: 'Vision-loop agent: screenshot → VLM decide → CDP act → verify, until done',
  scope: 'page',
  parameters: z.object({
    task: z.string().describe('自然语言任务，如 "搜索 xbrowser 并打开第一篇文章"'),
    maxSteps: z.coerce.number().optional().describe('最大步数（默认 12）'),
    settleMs: z.coerce.number().optional().describe('每步后等待页面稳定的毫秒数（默认 1500）'),
  }),
  result: z.object({
    done: z.boolean(),
    steps: z.unknown().optional(),
    summary: z.string().optional(),
    model: z.string().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    let page = ctx.page;
    const creds = loadVLMCredentials();
    if (!creds) {
      return fail('未找到 VLM 凭据：需要 ~/.zcode/v2/config.json 或 XBROWSER_VLM_CONFIG');
    }

    const maxSteps = p.maxSteps ?? 12;
    const settleMs = p.settleMs ?? 1500;
    const steps: Array<{ n: number; thought: string; action: string; ts: number }> = [];
    const history: string[] = [];
    let lastUrl = page.url();

    for (let step = 1; step <= maxSteps; step++) {
      // ── Observe (guard: never screenshot a blank strayed tab) ──
      if (page.url() === 'about:blank') {
        try {
          const ctxObj = (page as unknown as { context?: () => { pages?: () => unknown[] } }).context?.();
          const pages = (ctxObj?.pages?.() || []) as Array<typeof page>;
          let real: typeof page | undefined;
          for (let i = pages.length - 1; i >= 0; i--) {
            const u = pages[i]?.url?.() ?? '';
            if (u && u !== 'about:blank') { real = pages[i]; break; }
          }
          if (real) { await real.bringToFront().catch(() => {}); page = real; }
        } catch { /* keep current */ }
      }
      const buffer = await page.screenshot({ type: 'png' });
      const b64 = buffer.toString('base64');
      const { w, h } = pngDims(b64);

      // ── Decide ──
      const obsText = [
        `任务：${p.task}`,
        `截图尺寸：${w}x${h}（坐标原点：左上角）`,
        `当前 URL：${page.url()}`,
        history.length ? `已执行动作：\n${history.slice(-6).join('\n')}` : '尚无动作。',
      ].join('\n');
      const reply = await vlmAskRetry(creds, [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
        { type: 'text', text: `${SYSTEM_PROMPT}\n\n${obsText}` },
      ]);
      const decision = parseDecision(reply);
      if (!decision) {
        steps.push({ n: step, thought: '(unparseable)', action: 'stop', ts: Date.now() });
        return ok({ done: false, steps, summary: `第 ${step} 步 VLM 输出无法解析: ${reply.substring(0, 120)}`, model: creds.model });
      }

      // ── Act ──
      const a = decision.action;
      let acted = '';
      try {
        if (a.type === 'done') {
          steps.push({ n: step, thought: decision.thought, action: 'done', ts: Date.now() });
          return ok({ done: true, steps, summary: a.summary, model: creds.model });
        }
        if (a.type === 'stuck') {
          steps.push({ n: step, thought: decision.thought, action: 'stuck', ts: Date.now() });
          return ok({ done: false, steps, summary: `stuck: ${a.reason}`, model: creds.model });
        }
        if (a.type === 'click') {
          // Bounds guard (hallucination fuse): clamp into viewport
          const cx = Math.max(2, Math.min(w - 2, Math.round(a.x)));
          const cy = Math.max(2, Math.min(h - 2, Math.round(a.y)));
          await page.mouse.click(cx, cy, { stealth: true });
          acted = `click(${cx},${cy})`;
        } else if (a.type === 'type') {
          await page.keyboard.type(a.text, { stealth: true });
          acted = `type("${a.text.substring(0, 30)}")`;
        } else if (a.type === 'key') {
          await page.keyboard.press(a.key);
          acted = `key(${a.key})`;
        } else if (a.type === 'scroll') {
          await page.mouse.wheel(0, a.direction === 'down' ? a.amount : -a.amount);
          acted = `scroll(${a.direction},${a.amount})`;
        }
      } catch (e) {
        acted = `${a.type} FAILED: ${e instanceof Error ? e.message : String(e).substring(0, 80)}`;
      }

      steps.push({ n: step, thought: decision.thought, action: acted, ts: Date.now() });
      history.push(`${step}. ${acted} — ${decision.thought.substring(0, 60)}`);

      // ── Verify (settle + URL change note + new-tab follow) ──
      await new Promise((r) => setTimeout(r, settleMs));
      // Article/search clicks often open target=_blank tabs — follow the
      // last non-blank page that differs from the current one. Never follow
      // about:blank: transitional targets appear blank and would strand the
      // loop (observed: whole session drifted to about:blank).
      if (a.type === 'click') {
        try {
          const ctxObj = (page as unknown as { context?: () => { pages?: () => unknown[] } }).context?.();
          const pages = (ctxObj?.pages?.() || []) as Array<typeof page>;
          for (let i = pages.length - 1; i >= 0; i--) {
            const cand = pages[i];
            if (!cand || cand === page) continue;
            const u = cand.url?.() ?? '';
            if (!u || u === 'about:blank') continue;
            if (u === page.url()) break; // already on the newest real page
            await cand.bringToFront().catch(() => {});
            page = cand;
            break;
          }
        } catch { /* best-effort follow */ }
      }
      const urlNow = page.url();
      if (urlNow !== lastUrl) {
        history.push(`   [页面跳转 → ${urlNow.substring(0, 80)}]`);
        lastUrl = urlNow;
      }
    }

    return ok({ done: false, steps, summary: `已达最大步数 ${maxSteps}`, model: creds.model });
  },
});
