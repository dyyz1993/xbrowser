/**
 * 生图拒绝 / 错误文案检测（shared）
 *
 * 问题背景：4 个 AI 生图 provider（doubao/chatgpt/qwen/gemini）的 image 命令
 * 都用 while 循环轮询等图片，超时 120s。但如果 AI 直接返回文字说"我无法生成"，
 * 代码还在傻等图片出现，浪费时间。
 *
 * 方案：在轮询循环里每 tick 调用 detectRefusal(page, selectors)，如果检测到
 * 明确的拒绝/错误关键词，就提前退出（返回失败 + AI 的原话，方便排查）。
 *
 * 关键：只匹配"明确拒绝/违规/能力不足"，不匹配"正在生成/稍等"这类正常文案。
 * 避免"AI 先说一段话再出图"的正常流程被误判。
 */

// 明确拒绝关键词（中英文）。只放"AI 明确表示不画"的信号词。
// 不放"正在/稍候/让我"等模糊词，避免误伤正常流程。
const REFUSAL_PATTERNS: readonly string[] = [
  // ── 中文：明确拒绝 ──
  '无法生成',
  '无法画',
  '不能画',
  '不能生成',
  '无法为您',
  '无法创建',
  '不能创建',
  '没办法画',
  '画不了',
  '生成不了',
  '生成失败',
  '图片失败',
  '生图失败',
  '我无法',
  '我不能',
  '违反政策',
  '违反社区',
  '违反规定',
  '内容政策',
  '敏感内容',
  '涉及敏感',
  '包含敏感',
  '不适当',
  '不适合',
  '违规内容',
  '内容违规',
  '审核未通过',
  '已被拦截',
  '触发安全',
  '安全机制',
  '无法识别',
  '请更换',
  '请修改后',
  '不支持生成',
  '暂不支持',
  '当前不支持',
  '该功能暂不',
  '超出能力',
  '能力范围',
  // ── 英文：明确拒绝 ──
  "i can't generate",
  "i cannot generate",
  "i can't create",
  "i cannot create",
  "i'm unable to",
  'i am unable to',
  "i can't draw",
  "i cannot draw",
  "i can't produce",
  'against policy',
  'violates policy',
  'community guidelines',
  'content policy',
  'sensitive content',
  'inappropriate content',
  'not appropriate',
  'i cannot assist with that',
  "i can't assist with",
  'i cannot fulfill',
  "i can't fulfill",
  'generating image failed',
  'image generation failed',
  'failed to generate',
  'unable to generate',
  'generation error',
  'something went wrong',
  'try again later',
  'rate limit',
  'too many requests',
  'quota exceeded',
];

// 正常流程文案（白名单）——检测到这些说明还在正常工作，绝对不算拒绝。
const NORMAL_FLOW_POSITIVE: readonly string[] = [
  '正在生成',
  '生成中',
  '稍等',
  '请稍候',
  '正在画',
  '正在为您',
  '马上',
  '让我',
  '好的，',
  '好的，我',
  'generating',
  'creating',
  'let me',
  'sure,',
  "i'll",
  'i will',
  'of course',
];

/**
 * 从页面提取 AI 最新一条回复文本，供拒绝检测。
 * selectors: 该 provider 的 AI 回复容器 CSS 选择器列表（按优先级）。
 * 返回最长的一条匹配文本（最可能是完整回复），找不到返回空串。
 */
export async function extractAssistantText(
  page: { evaluate: <R = unknown>(fn: string | Function, ...args: unknown[]) => Promise<R> },
  selectors: readonly string[],
): Promise<string> {
  try {
    return await page.evaluate((sels: string[]) => {
      // 找所有匹配的容器，取文本最长的一条（最可能是完整回复）
      let best = '';
      for (const sel of sels) {
        const els = document.querySelectorAll(sel);
        els.forEach((el) => {
          const txt = (el.textContent || '').trim();
          // 太短的可能是 UI 文案，跳过；取 8 字符以上的
          if (txt.length > Math.max(best.length, 8)) best = txt;
        });
      }
      return best.substring(0, 1000); // 截断，避免超长回复拖慢检测
    }, selectors as string[]) as string;
  } catch {
    return '';
  }
}

/**
 * 检测 AI 回复是否包含明确拒绝/错误信号。
 *
 * @param text AI 回复文本（已提取）
 * @returns 拒绝原因（匹配到的关键词），或 null 表示未拒绝
 *
 * 逻辑：
 * 1. 先查白名单 —— 如果文本以"正在生成/好的，我..."开头（正常流程），直接返回 null。
 *    这保护"AI 先寒暄再出图"的正常流程不被误判。
 * 2. 再查拒绝词 —— 命中任意一个就返回该词。
 *
 * 注意：白名单只看开头前 50 字符（寒暄通常在开头），拒绝词全文匹配。
 */
export function detectRefusal(text: string): string | null {
  if (!text || text.length < 4) return null;

  const head = text.substring(0, 50).toLowerCase();

  // 白名单：开头是正常流程信号 → 不算拒绝（即使后面提到"政策"等词）
  // 但只在文本较短（像纯寒暄）时信任白名单；长文本可能是"寒暄+拒绝"，仍需查拒绝词
  if (text.length < 80) {
    for (const normal of NORMAL_FLOW_POSITIVE) {
      if (head.includes(normal.toLowerCase())) return null;
    }
  }

  // 拒绝词匹配（全文，大小写不敏感）
  const lower = text.toLowerCase();
  for (const pattern of REFUSAL_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }
  return null;
}

/**
 * 一站式：提取 + 检测。返回 { refused, reason, text }。
 * 在 provider 的轮询循环里每 tick 调用一次。
 */
export async function checkRefusal(
  page: { evaluate: <R = unknown>(fn: string | Function, ...args: unknown[]) => Promise<R> },
  selectors: readonly string[],
): Promise<{ refused: boolean; reason: string | null; text: string }> {
  const text = await extractAssistantText(page, selectors);
  const reason = detectRefusal(text);
  return { refused: reason !== null, reason, text };
}
