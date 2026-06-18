/**
 * render/flow-renderer — flow 正文渲染（设计 §7）。
 *
 * 双模式：
 *   - LLM 模式：用 @dyyz1993/pi-ai 把 Topic 渲染成自然语言（自然、流畅）
 *   - 模板模式：renderTopicTemplate（生硬但准确，安全网）
 *
 * LLM 模式带字段回校验：输出必须包含所有输入字段值，否则重试（≤3 次），仍失败则降级。
 * LLM 不可用（包没装/无 API key/超时）时直接降级到模板。
 *
 * 切换由 opts.useLlm 控制（summarize 命令的 --no-llm 参数）。
 */
import type { Topic } from '../types.js';
import { renderTopicTemplate } from './template.js';

/** 渲染选项。 */
export interface RenderOptions {
  /** 是否尝试用 LLM 渲染（false 则强制模板）。默认 true。 */
  useLlm?: boolean;
  /** provider（如 'deepseek'/'openai'/'anthropic'）。默认 'deepseek'。 */
  provider?: string;
  /** model id。默认按 provider 取一个便宜的。 */
  model?: string;
}

/** LLM 渲染的系统提示（字段约束，设计 §7 prompt 纪律）。 */
const SYSTEM_PROMPT = `你收到的是已识别好的结构化意图段。你的任务仅是"翻译"：
- 字段值（username/files/url/selector 等）必须原样保留，禁止改写、禁止省略、禁止编造
- 意图标签必须保留
- 只负责：把结构化数据写成流畅的中文段落 + 整理步骤
- 不确定的地方写"（未识别）"，不要猜
输出 markdown，以二级标题(## )开头。`;

/** 把 Topic 序列化成 LLM 的 user prompt。 */
function buildPrompt(topic: Topic): string {
  const fields = Object.entries(topic.fields).map(([k, v]) => {
    const val = v.kind === 'files' ? v.names.join(',') : (v as { value?: string }).value ?? (v as { selector?: string }).selector ?? '';
    return `- ${k}: ${val}`;
  });
  const actions = topic.segments.flatMap(s => s.actions).slice(0, 20).map(a => ({
    type: a.type, text: a.element?.text ?? '', selector: a.element?.selector ?? '',
    value: a.value ?? '', url: a.url, key: a.key ?? '',
  }));
  return [
    `意图：${topic.intent}`,
    `置信度：${topic.confidence}`,
    `站点：${topic.site}`,
    `字段：`,
    ...fields,
    `操作（前20个）：${JSON.stringify(actions)}`,
    topic.resultHint ? `结果提示：${topic.resultHint}` : '',
    `请渲染成中文操作手册正文（markdown）。`,
  ].filter(Boolean).join('\n');
}

/** 字段回校验：LLM 输出里是否包含所有"关键字段值"。 */
function validateFields(topic: Topic, output: string): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const [key, val] of Object.entries(topic.fields)) {
    let expected = '';
    if (val.kind === 'text') expected = val.value;
    else if (val.kind === 'selector') expected = val.selector;
    else if (val.kind === 'url') expected = val.value;
    else if (val.kind === 'files') expected = val.names[0] ?? '';
    if (expected && expected.length > 1 && !output.includes(expected)) {
      // 短值（如单字符）跳过校验，避免误报
      missing.push(`${key}="${expected}"`);
    }
  }
  return { ok: missing.length === 0, missing };
}

/** 尝试动态加载 pi-ai 并调用 LLM（单轮）。失败返回 null。 */
async function tryLlmRender(prompt: string, opts: RenderOptions): Promise<string | null> {
  try {
    // 动态 import，避免强制依赖
    const piAi = await import('@dyyz1993/pi-ai').catch(() => null);
    if (!piAi || typeof piAi.getModel !== 'function') return null;
    const provider = (opts.provider ?? 'deepseek') as Parameters<typeof piAi.getModel>[0];
    const model = (opts.model ?? undefined) as Parameters<typeof piAi.getModel>[1];
    const modelHandle = piAi.getModel(provider, model);
    const context = {
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user' as const, content: prompt }],
    };
    const result = await piAi.complete(modelHandle, context);
    // result 可能是消息对象或字符串
    if (typeof result === 'string') return result;
    const r = result as { content?: string; message?: { content?: string }; text?: string };
    return r.content ?? r.message?.content ?? r.text ?? null;
  } catch {
    return null;
  }
}

/**
 * 渲染一个 Topic 为 flow 正文。
 * 优先 LLM（带校验+重试），失败降级模板。
 */
export async function renderTopic(topic: Topic, opts: RenderOptions = {}): Promise<{
  body: string;
  mode: 'llm' | 'template';
  warnings: string[];
}> {
  const warnings: string[] = [];

  if (opts.useLlm === false) {
    return { body: renderTopicTemplate(topic), mode: 'template', warnings };
  }

  const prompt = buildPrompt(topic);
  // 最多重试 3 次
  for (let attempt = 1; attempt <= 3; attempt++) {
    const out = await tryLlmRender(prompt, opts);
    if (out && out.trim().length > 0) {
      const { ok, missing } = validateFields(topic, out);
      if (ok) {
        return { body: out.trim(), mode: 'llm', warnings };
      }
      warnings.push(`attempt ${attempt}: 字段校验失败，缺失 ${missing.join(', ')}`);
    } else if (out === null) {
      // pi-ai 不可用，直接降级，不重试
      warnings.push('LLM 不可用（@dyyz1993/pi-ai 未安装或无 API key），降级模板');
      break;
    }
  }

  return { body: renderTopicTemplate(topic), mode: 'template', warnings };
}
