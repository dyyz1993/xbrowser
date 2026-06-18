/**
 * upload 匹配器（设计 §5）。
 *
 * 触发信号（任一）：
 *   - filechooser action
 *   - input[type=file] 或 action 带 files 字段
 * 置信度：high（文件选择是明确动作）。
 * 字段：files(names)、trigger(selector，上传触发按钮)。
 */
import type { IntentMatcher, MatchResult, Segment, FieldValue } from '../types.js';

export const uploadMatcher: IntentMatcher = {
  intent: 'upload',
  match(segment: Segment): MatchResult | null {
    const acts = segment.actions;

    // 找文件选择动作
    const fileAct = acts.find(a =>
      a.type === 'filechooser' ||
      (a.element?.type === 'file') ||
      (a.files && a.files.names.length > 0),
    );
    if (!fileAct) return null;

    const fields: Record<string, FieldValue> = {};
    const reasoning: string[] = [];

    if (fileAct.files && fileAct.files.names.length > 0) {
      fields.files = { kind: 'files', names: fileAct.files.names };
      reasoning.push(`${fileAct.files.names.length} file(s): ${fileAct.files.names.join(', ')}`);
    }

    // trigger：fileAct 之前最近的 click（通常是点"添加/上传"按钮触发文件选择）
    const triggerIdx = acts.indexOf(fileAct);
    for (let i = triggerIdx - 1; i >= 0; i--) {
      const a = acts[i];
      if (a.type === 'click' && a.element?.selector) {
        fields.trigger = {
          kind: 'selector',
          selector: a.element.selector,
          strategy: a.element.strategy ?? 'class',
          text: a.element.text ?? '',
        };
        reasoning.push(`trigger button at action#${a.id}`);
        break;
      }
    }

    return { intent: 'upload', confidence: 'high', fields, reasoning };
  },
};
