/**
 * chat 匹配器（发消息/AI 对话）。
 *
 * 触发信号：textarea/input 填充消息 + 后续点击发送按钮 或 按 Enter。
 * 置信度：medium（聊天是常见但非唯一的 input+click 组合）。
 * 字段：message(发送的内容)、inputBox(selector)、sendBtn(selector)。
 *
 * 优先级低于 login/upload（那些有 password/filechooser 强信号），
 * 排在 form-submit 之前（chat 比 form-submit 更具体：有发送按钮/Enter）。
 *
 * 适用：ChatGPT/DeepSeek/豆包/通义等所有 AI 聊天站的核心场景。
 */
import type { IntentMatcher, MatchResult, Segment, FieldValue } from '../types.js';

/** 判断 selector/text 是否像"发送"按钮。 */
function looksLikeSendButton(text: string, selector: string): boolean {
  const t = text.toLowerCase();
  const s = selector.toLowerCase();
  return t.includes('发送') || t.includes('send') || t.includes('submit')
    || s.includes('submit') || s.includes('send');
}

export const chatMatcher: IntentMatcher = {
  intent: 'chat',
  match(segment: Segment): MatchResult | null {
    const acts = segment.actions;

    // 找输入消息的 action（textarea 或 input，且非 password/file）
    const msgAct = acts.find(a =>
      a.type === 'input' &&
      a.element?.tag === 'textarea' || (a.element?.tag === 'input' && a.element?.type !== 'password' && a.element?.type !== 'file'),
    );
    if (!msgAct || !msgAct.value) return null;

    // 找后续的发送动作（发送按钮 click 或 Enter keydown）
    const msgIdx = acts.indexOf(msgAct);
    let sendAction: typeof acts[number] | undefined;
    let sendKind: 'button' | 'enter' | null = null;

    for (let i = msgIdx + 1; i < acts.length && i < msgIdx + 5; i++) {
      const a = acts[i];
      if (a.type === 'click' && a.element) {
        if (looksLikeSendButton(a.element.text ?? '', a.element.selector ?? '')) {
          sendAction = a; sendKind = 'button'; break;
        }
        // 点击紧邻的按钮（非明确发送文案）也可能是发送（ChatGPT 的 submit button）
        if (a.element.selector?.includes('submit') || a.element.selector?.includes('send')) {
          sendAction = a; sendKind = 'button'; break;
        }
      }
      if (a.type === 'keydown' && a.key === 'Enter') {
        sendAction = a; sendKind = 'enter'; break;
      }
    }

    if (!sendAction) return null;

    const fields: Record<string, FieldValue> = {
      message: {
        kind: 'text',
        value: msgAct.value,
        selector: msgAct.element?.selector,
        confidence: 'high',
      },
    };
    const reasoning: string[] = [`message "${msgAct.value.slice(0, 20)}..." at action#${msgAct.id}`];

    if (msgAct.element?.selector) {
      fields.inputBox = {
        kind: 'selector',
        selector: msgAct.element.selector,
        strategy: msgAct.element.strategy ?? 'attribute',
        text: msgAct.element.text ?? '',
      };
    }
    if (sendKind === 'button' && sendAction.element?.selector) {
      fields.sendBtn = {
        kind: 'selector',
        selector: sendAction.element.selector,
        strategy: sendAction.element.strategy ?? 'id',
        text: sendAction.element.text ?? '',
      };
      reasoning.push(`sent via button at action#${sendAction.id}`);
    } else if (sendKind === 'enter') {
      fields.sendMethod = { kind: 'text', value: 'Enter', confidence: 'high' };
      reasoning.push(`sent via Enter at action#${sendAction.id}`);
    }

    return { intent: 'chat', confidence: 'medium', fields, reasoning };
  },
};
