/**
 * editor-profile — 受控编辑器特征探测（输入保真层前置）
 *
 * 背景（S-sup 家族，知乎 Draft 事故 2026-09-13）：强受控编辑器的
 * EditorState 是唯一数据源，DOM 只是投影——不经其状态管线的改动
 * （合成 input 事件 / execCommand insertText / CDP Input.insertText）
 * 注入即时"成功"，数秒后被 React reconciliation 回流清空。唯一
 * 存活通道是完整键盘事件流（Input.dispatchKeyEvent 逐字）。
 *
 * 本模块在 fill 前探测目标元素是否受控/富文本，命中则跳过粘贴类
 * 快通道（paste/synthetic）直接走 keyboard.type，并启用 fill 后的
 * 延时存活验证（见 locator.fill 的 verifySurvival）。
 */

export interface EditorProfile {
  /** react: 目标元素挂在 React fiber 树上（受控风险） */
  react: boolean;
  /** 已知富文本编辑器家族（Draft/ProseMirror/Quill/CodeMirror/Slate/Lexical） */
  richFamily: string | null;
  /** contenteditable 宿主（非 input/textarea 的编辑面） */
  contenteditable: boolean;
  /** 综合判定：需要键盘流通道 + 延时验证 */
  controlled: boolean;
}

/**
 * 页面侧探测表达式（在目标元素上求值，returnByValue 序列化）。
 * selector 由调用方注入（locator._q 已转义形式）。
 */
export function buildEditorProbe(selector: string): string {
  return `(function() {
    const el = ${selector};
    if (!el) return { react: false, richFamily: null, contenteditable: false, controlled: false };
    const editable = el.closest('[contenteditable="true"]');
    const host = editable || el;
    // React fiber：元素自有键扫描（interaction.ts 页面级探测的元素级收窄）
    let react = false;
    try {
      for (const k of Object.keys(host)) {
        if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) { react = true; break; }
      }
      if (!react && host.parentElement) {
        for (const k of Object.keys(host.parentElement)) {
          if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) { react = true; break; }
        }
      }
    } catch (e) { /* 跨域/权限兜底 */ }
    // 已知编辑器家族（自研 Draft 系最危险——EditorState 强受控）
    const families = [
      ['.public-DraftEditor-content', 'draft'],
      ['.DraftEditor-editorContainer', 'draft'],
      ['.ProseMirror', 'prosemirror'],
      ['.ql-editor', 'quill'],
      ['.CodeMirror', 'codemirror'],
      ['.cm-editor', 'codemirror'],
      ['[data-slate-editor]', 'slate'],
      ['.jsx-lexical', 'lexical'],
      ['.contenteditable-editor', 'generic-rich'],
    ];
    let richFamily = null;
    for (const [sel, name] of families) {
      if (host.closest(sel)) { richFamily = name; break; }
    }
    const contenteditable = !!editable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA';
    return {
      react,
      richFamily,
      contenteditable,
      controlled: react || !!richFamily || contenteditable,
    };
  })()`;
}

/** Node 侧包装：evaluate 探测并归一化（失败按非受控处理，不阻塞 fill） */
export async function probeEditor(
  evaluate: (expr: string) => Promise<unknown>,
  selector: string,
): Promise<EditorProfile> {
  const fallback: EditorProfile = { react: false, richFamily: null, contenteditable: false, controlled: false };
  try {
    const r = await evaluate(buildEditorProbe(selector));
    if (r && typeof r === 'object') return r as EditorProfile;
    return fallback;
  } catch {
    return fallback;
  }
}
