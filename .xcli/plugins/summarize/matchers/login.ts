/**
 * login 匹配器（设计 §5）。
 *
 * 触发信号：段内存在 input[type=password]（极强信号，几乎只出现在登录）。
 * 置信度：high（password 信号独特性高）。
 * 字段：username（password 之前最近的 text input，值脱敏）、passwordInput(selector)、submitBtn(selector)。
 */
import type { IntentMatcher, MatchResult, Segment, FieldValue } from '../types.js';

export const loginMatcher: IntentMatcher = {
  intent: 'login',
  match(segment: Segment): MatchResult | null {
    const acts = segment.actions;
    // 找 password input
    const pwIdx = acts.findIndex(a =>
      a.type === 'input' && a.element?.type === 'password',
    );
    if (pwIdx === -1) return null;

    const fields: Record<string, FieldValue> = {};
    const reasoning: string[] = [`found password input at action#${acts[pwIdx].id}`];

    // username：password 之前最近的 text input
    let userIdx = -1;
    for (let i = pwIdx - 1; i >= 0; i--) {
      const a = acts[i];
      if (a.type === 'input' && (a.element?.type === 'text' || a.element?.type === undefined) && a.element?.tag === 'input') {
        userIdx = i;
        break;
      }
    }
    if (userIdx !== -1) {
      const u = acts[userIdx];
      fields.username = {
        kind: 'text',
        value: u.value ?? '',  // 账号值保留（非密码），但知识库存储时可再脱敏
        selector: u.element?.selector,
        confidence: 'high',
      };
      reasoning.push(`username from action#${u.id}`);
    }

    // passwordInput selector
    const pwAct = acts[pwIdx];
    if (pwAct.element?.selector) {
      fields.passwordInput = {
        kind: 'selector',
        selector: pwAct.element.selector,
        strategy: pwAct.element.strategy ?? 'attribute',
        text: '',  // password 不存 text
      };
    }

    // submitBtn：password 之后最近的 click button
    for (let i = pwIdx + 1; i < acts.length; i++) {
      const a = acts[i];
      if (a.type === 'click' && a.element?.tag === 'button' && a.element?.selector) {
        fields.submitBtn = {
          kind: 'selector',
          selector: a.element.selector,
          strategy: a.element.strategy ?? 'class',
          text: a.element.text ?? '',
        };
        reasoning.push(`submit button from action#${a.id}`);
        break;
      }
    }

    return { intent: 'login', confidence: 'high', fields, reasoning };
  },
};
