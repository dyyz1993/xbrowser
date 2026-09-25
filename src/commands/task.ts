import { z } from 'zod';
import { ok, fail, normalizeTips } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { observePage, actOnPage } from '../runtime/agent-runtime.js';
import { registerCommand } from './command-registry.js';
import { loadVLMCredentials, vlmAskRetry } from './vision-task.js';

/**
 * task — 快思考自治循环（jev-ultrafast 同构，跑在本项目硬执行层上）
 *
 * observe（ref 索引化动作清单）→ LLM 单往返决策（文本，无截图）→ actOnPage 执行 → 循环。
 * 与 jev 对齐的约束：动作空间固定、决策绑定当前 observe（消费一次，stale 不重发）、
 * MAX_STEPS 预算、连续 N 步页面无变化判死循环。决策模型走 vision-task 同款可插拔
 * 凭证（XBROWSER_VLM_CONFIG / ~/.zcode/v2/config.json，env XBROWSER_TASK_MODEL 可覆盖）。
 */

type StepRecord = {
  step: number;
  thought?: string;
  action: string;
  ref?: string;
  value?: string;
  ok: boolean;
  stale?: boolean;
  error?: string;
  screenHash?: string;
};

const DECISION_SYSTEM = `你是浏览器任务决策器。根据目标、当前页面元素清单（每项带 @eN 编号）和已执行历史，输出下一步动作。

可用动作（只能输出一个 JSON 对象，不要输出任何其他文字）：
{"action":"click","ref":"@eN","thought":"为什么"}
{"action":"fill","ref":"@eN","value":"文本","thought":"为什么"}
{"action":"select","ref":"@eN","value":"选项值","thought":"为什么"}
{"action":"press","value":"Enter","thought":"为什么"}
{"action":"scroll","value":"down 或 up","thought":"为什么"}
{"action":"done","value":"完成摘要","thought":"为什么"}
{"action":"back","thought":"点错了/跳转错了，返回上一页重试"}
{"action":"blocked","value":"卡住原因","thought":"为什么"}

规则：
1. ref 必须原样来自本次元素清单；清单里没有能推进目标的元素就输出 blocked。
2. 目标已完成（页面上能确认结果）就输出 done，value 写完成摘要。
3. 不要重复刚失败过的同一动作；动作后页面跳到了意料之外的地方就输出 back 返回重试；连续失败换思路或 blocked。`;

function extractDecision(raw: string): Record<string, unknown> | null {
  // 容错解析：剥 ```json 围栏、取首个 {...} 平衡块
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)) as Record<string, unknown>; } catch { return null; }
      }
    }
  }
  return null;
}

export const taskCommand = registerCommand({
  name: 'task',
  description: 'Autonomous goal loop: observe refs → LLM decides → act, until done/blocked (budget-capped)',
  scope: 'page',
  parameters: z.object({
    goal: z.string().describe('Natural-language goal'),
    maxSteps: z.number().int().positive().max(50).optional().default(15).describe('Hard action budget'),
    timeout: z.number().optional().default(180000).describe('Wall clock budget in ms'),
    limit: z.number().int().positive().max(300).optional().default(80).describe('Max targets per observe'),
  }),
  result: z.object({
    status: z.enum(['done', 'blocked', 'max_steps', 'error']),
    summary: z.string().optional(),
    steps: z.array(z.record(z.unknown())),
    finalUrl: z.string().optional(),
    usage: z.object({ llmCalls: z.number(), steps: z.number() }).passthrough().optional(),
  }).passthrough(),
  handler: async (p, ctx: BrowserCommandContext) => {
    const creds = loadVLMCredentials();
    if (!creds) {
      return fail('task 需要决策模型凭证：设置 XBROWSER_VLM_CONFIG 或 ~/.zcode/v2/config.json');
    }
    const model = process.env.XBROWSER_TASK_MODEL || creds.model;
    const started = Date.now();
    const steps: StepRecord[] = [];
    const history: string[] = [];
    let llmCalls = 0;
    let status: 'done' | 'blocked' | 'max_steps' | 'error' = 'max_steps';
    let summary = '';
    let lastError = '';
    let emptyReplies = 0;

    for (let step = 1; step <= p.maxSteps; step++) {
      if (Date.now() - started > p.timeout) { status = 'blocked'; summary = `timeout after ${step - 1} steps`; break; }

      // 1. observe —— 决策绑定本次快照（消费一次）
      const obs = await observePage(ctx.page, ctx.sessionId, { limit: p.limit, includeHidden: false });
      const compact = obs.compact
        ?? obs.targets.map((t, i) => `@e${i + 1} [${(t as { tag?: string }).tag ?? ''}] ${(t as { name?: string }).name ?? ''}`).join('\n');
      const screenHash = (obs as { screenHash?: string }).screenHash;

      // 2. LLM 单往返决策（纯文本，无截图）
      const userPayload = [
        `目标：${p.goal}`,
        `当前页面（URL: ${(obs as { url?: string }).url ?? ''}）：`,
        compact,
        history.length ? `\n已执行（勿重复失败动作）：\n${history.slice(-6).join('\n')}` : '',
      ].filter(Boolean).join('\n');

      let raw = '';
      try {
        raw = await vlmAskRetry({ ...creds, model }, [{ type: 'text', text: `${DECISION_SYSTEM}\n\n---\n\n${userPayload}` }], 900);
        llmCalls++;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        status = 'error'; summary = `LLM call failed: ${lastError}`; break;
      }
      const decision = extractDecision(raw);
      if (!decision || typeof decision.action !== 'string') {
        // 空回复（过渡页/加载中常见）：重 observe 一次形成自然间隔再决策，连续 2 次空才放弃
        if (!raw.trim() && emptyReplies < 2) {
          emptyReplies++;
          steps.push({ step, action: '(empty reply, re-observe)', ok: false, screenHash: (obs as { screenHash?: string }).screenHash });
          history.push(`step${step}: (empty reply, retrying)`);
          continue;
        }
        status = 'blocked'; summary = `LLM returned unparsable decision: ${raw.slice(0, 120)}`; break;
      }
      const action = decision.action as string;
      const ref = typeof decision.ref === 'string' ? decision.ref : undefined;
      const value = typeof decision.value === 'string' ? decision.value : undefined;
      const thought = typeof decision.thought === 'string' ? decision.thought : undefined;

      // 3. 终止动作
      if (action === 'done') {
        status = 'done'; summary = value || thought || 'task done';
        steps.push({ step, thought, action: 'done', ok: true, screenHash });
        break;
      }
      if (action === 'back') {
        await ctx.page?.goBack?.().catch?.(() => {});
        steps.push({ step, thought, action: 'back', ok: true, screenHash });
        history.push(`step${step}: back (返回上一页)`);
        continue;
      }
      if (action === 'blocked') {
        status = 'blocked'; summary = value || thought || 'LLM judged blocked';
        steps.push({ step, thought, action: 'blocked', ok: true, screenHash });
        break;
      }

      // 4. 执行（决策消费一次：失败/stale 不重发同一决策，直接进入下一轮重观察）
      const legalRefs = new Set((obs.targets as Array<{ ref?: string }>).map((t, i) => t.ref ?? `e${i + 1}`));
      const normalizedRef = ref ? (legalRefs.has(ref.replace('@', '')) || legalRefs.has(ref) ? ref : undefined) : undefined;
      if (ref && !normalizedRef && action !== 'scroll' && action !== 'press') {
        history.push(`step${step}: ${action} ${ref} REJECTED (ref not in current list)`);
        steps.push({ step, thought, action, ref, ok: false, error: 'ref not in current list', screenHash });
        continue;
      }
      const res = await actOnPage(ctx.page, ctx.sessionId, {
        action: action as 'click' | 'fill' | 'type' | 'press' | 'select' | 'check' | 'hover',
        ref: normalizedRef, value, selector: undefined, force: false, timeout: 10000,
      });
      const record: StepRecord = {
        step, thought, action, ref: normalizedRef, value,
        ok: res.success === true, stale: (res as { stale?: boolean }).stale,
        error: res.success ? undefined : (res.message || res.reason),
        screenHash,
      };
      steps.push(record);
      history.push(`step${step}: ${action} ${normalizedRef ?? ''} ${value ?? ''} -> ${res.success ? 'ok' : `failed(${res.reason || res.message})`}`);

      // 5. 死循环检测：同一动作（action+ref+value）连续重复 ≥3 次视为无效循环。
      // 不用 screenHash——表单填写/内部状态变更类页面（如本地靶场）视觉零变化，
      // 像素哈希会误杀有效序列（09-22 实测：fill/select/click 全 ok 却被判死）。
      const sig = (s: StepRecord) => `${s.action}|${s.ref ?? ''}|${s.value ?? ''}`;
      const last3 = steps.slice(-3);
      if (last3.length === 3 && new Set(last3.map(sig)).size === 1) {
        status = 'blocked'; summary = 'dead loop: identical action repeated 3 times';
        break;
      }
    }

    if (status === 'max_steps') summary = summary || `hit maxSteps=${p.maxSteps}`;
    const finalUrl = ctx.page ? ctx.page.url() : undefined;
    const data = { status, summary, steps, finalUrl, usage: { llmCalls, steps: steps.length } };
    if (status === 'error') return fail(summary || lastError, normalizeTips([`completed steps: ${steps.length}`]));
    return ok(data, normalizeTips([
      status === 'done' ? `✅ task done (${steps.length} steps, ${llmCalls} LLM calls)` : `⚠️ task ${status}: ${summary.slice(0, 80)}`,
    ]));
  },
});
