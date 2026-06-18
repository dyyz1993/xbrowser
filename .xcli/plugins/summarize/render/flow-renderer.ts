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
  /** provider（如 'opencode-go'/'deepseek'/'openai'）。默认 'opencode-go'。 */
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

/**
 * 自动从 ~/.pi/agent/auth.json 加载 provider 的 API key 到环境变量。
 * pi-ai 库默认读环境变量（如 OPENCODE_API_KEY），但用户的 key 可能存在
 * pi CLI 的 auth.json 里（type=api_key）。这里做零配置自动注入：
 * 环境变量已有则跳过；没有则读 auth.json 并 set。
 *
 * provider → 环境变量名映射（同 pi-ai 的 env-api-keys 约定）
 */
const PROVIDER_ENV_VAR: Record<string, string> = {
  'opencode-go': 'OPENCODE_API_KEY',
  'opencode': 'OPENCODE_API_KEY',
  'deepseek': 'DEEPSEEK_API_KEY',
  'openai': 'OPENAI_API_KEY',
  'anthropic': 'ANTHROPIC_API_KEY',
};

let authLoaded = false;  // 只加载一次
function autoloadAuth(provider: string): void {
  if (authLoaded) return;
  authLoaded = true;
  const envVar = PROVIDER_ENV_VAR[provider];
  if (!envVar || process.env[envVar]) return;  // 环境变量已有，无需加载
  try {
    const { readFileSync } = require('node:fs');
    const { homedir } = require('node:os');
    const authPath = `${homedir()}/.pi/agent/auth.json`;
    const auth = JSON.parse(readFileSync(authPath, 'utf8'));
    const entry = auth[provider];
    if (entry && typeof entry.key === 'string') {
      process.env[envVar] = entry.key;
    }
  } catch {
    // auth.json 不存在或格式不对，静默跳过（降级模板）
  }
}

/** 尝试动态加载 pi-ai 并调用 LLM（单轮）。失败返回 null。 */
async function tryLlmRender(prompt: string, opts: RenderOptions): Promise<string | null> {
  try {
    // 动态 import，避免强制依赖
    const piAi = await import('@dyyz1993/pi-ai').catch(() => null);
    if (!piAi || typeof piAi.getModel !== 'function' || typeof piAi.complete !== 'function') return null;

    // 默认 provider/model：opencode-go 的 deepseek-v4-flash（同作者 provider，已验证可用）
    // 注意 opencode-go 的模型都是 reasoning 模型，需要足够大的 maxTokens
    // 让 reasoning 完成后还有余量生成正文（reasoning 通常消耗 500-1500 token）
    const provider = (opts.provider ?? 'opencode-go') as Parameters<typeof piAi.getModel>[0];
    autoloadAuth(provider);  // 零配置：自动从 ~/.pi/agent/auth.json 读 key
    const defaultModel = provider === 'opencode-go' ? 'deepseek-v4-flash'
      : provider === 'deepseek' ? 'deepseek-chat'
      : undefined;
    const modelId = (opts.model ?? defaultModel) as Parameters<typeof piAi.getModel>[1];
    const modelHandle = piAi.getModel(provider, modelId);
    if (!modelHandle) return null;

    const context = {
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user' as const, content: prompt }],
    };
    // complete 第三参数是 options（StreamOptions），含 maxTokens/temperature
    const result = await piAi.complete(modelHandle, context, {
      maxTokens: 2000,    // reasoning 模型需要大余量
      temperature: 0.3,   // 低温度，字段值稳定
    });

    // result.content 是 ContentBlock 数组（pi-ai 标准），提取文本块
    if (typeof result === 'string') return result;
    const r = result as {
      content?: Array<{ type: string; text?: string }>;
      text?: string;
      errorMessage?: string;
      stopReason?: string;
    };
    if (r.errorMessage || r.stopReason === 'error') return null;
    if (Array.isArray(r.content)) {
      const text = r.content
        .filter(b => b.type === 'text' && b.text)
        .map(b => b.text!)
        .join('\n');
      return text || null;
    }
    return r.text ?? null;
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
