import { execSync } from 'child_process';
import type { Page } from '../types.js';

/**
 * 智能回复提取兜底：当插件的 selector-based 回复提取失败（改版导致 selector 失效），
 * 拿页面文本 snapshot 给大模型（deepseek）分析，让它找出 AI 的回复内容。
 *
 * 「用 AI 修 AI 的 bug」——AI 聊天插件改版后 selector 失效，用另一个 AI 看页面快照找出回复。
 *
 * @param page       当前页面对象（用于拿 snapshot）
 * @param userMsg    用户发送的消息（让大模型区分用户消息和 AI 回复）
 * @param intent     当前意图描述（如 "doubao 聊天页，用户发了图片问'这是什么'，等 AI 回复"）
 * @param cdp        CDP endpoint（默认 http://localhost:9221）
 * @returns 提取到的回复文本，或 null（失败时）
 */
export async function smartExtractReply(
  page: Page,
  userMsg: string,
  intent: string,
  cdp = 'http://localhost:9221',
): Promise<string | null> {
  // 1. 拿页面文本 snapshot（只取对话区域，避免太长）
  const snapshot = await page.evaluate(() => {
    // 取 body 文本，截断到合理长度
    const txt = (document.body.textContent || '').replace(/\s+/g, ' ').trim();
    return txt.slice(0, 3000);
  }).catch(() => '');

  if (!snapshot || snapshot.length < 20) return null;

  // 2. 构造 prompt，让 deepseek 从 snapshot 中提取 AI 回复
  const prompt = [
    `我在操作一个 AI 聊天网站，用户发了消息"${userMsg.slice(0, 100)}"，正在等 AI 回复。`,
    `但页面改版了，我的代码提取不到回复内容。`,
    `意图：${intent}`,
    ``,
    `以下是页面文本快照（可能包含侧栏、输入框、历史对话等干扰内容）：`,
    `---`,
    snapshot.slice(0, 2000),
    `---`,
    ``,
    `请找出 AI 对用户消息"${userMsg.slice(0, 50)}"的回复内容。`,
    `只输出回复正文，不要解释。如果没有找到回复，输出"NO_REPLY"。`,
  ].join('\n');

  // 3. 调 deepseek chat 分析（用 CLI execSync，带 CDP 复用登录态）
  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const cmd = `node dist/cli.js --cdp ${cdp} deepseek chat '${escaped}' --json 2>/dev/null`;
    const output = execSync(cmd, {
      cwd: process.cwd(),
      timeout: 30000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });
    // 从 JSON 输出里提取 response 字段
    try {
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.includes('"response"')) {
          const m = line.match(/"response"\s*:\s*"(.+?)"/);
          if (m) {
            const reply = m[1].trim();
            if (reply && reply !== 'NO_REPLY') return reply;
          }
        }
      }
    } catch { /* parse fail */ }
    // 兜底：从非 JSON 输出里找 response 行
    const m = output.match(/response[:\s]+(.+)/i);
    if (m && m[1].trim() !== 'NO_REPLY') return m[1].trim();
  } catch {
    // execSync 失败（超时/错误），返回 null
  }
  return null;
}
