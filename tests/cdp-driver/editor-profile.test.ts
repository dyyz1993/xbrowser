/**
 * editor-profile 单测：受控编辑器探测（输入保真层前置）
 */
import { describe, it, expect } from 'vitest';
import { buildEditorProbe, probeEditor, type EditorProfile } from '../../src/cdp-driver/editor-profile.js';

describe('editor-profile', () => {
  it('buildEditorProbe 生成含家族选择器与 fiber 键扫描的自包含表达式', () => {
    const expr = buildEditorProbe(`document.querySelector('#x')`);
    expect(expr).toContain('__reactFiber$');
    expect(expr).toContain('__reactInternalInstance$');
    expect(expr).toContain('.public-DraftEditor-content');
    expect(expr).toContain('.ProseMirror');
    expect(expr).toContain('.ql-editor');
    expect(expr).toContain('[contenteditable="true"]');
    expect(expr).toContain('controlled');
    // 表达式以 IIFE 包裹，可直接 evaluate
    expect(expr.startsWith('(function() {')).toBe(true);
  });

  it('probeEditor 归一化 evaluate 结果对象', async () => {
    const fake: EditorProfile = { react: true, richFamily: 'draft', contenteditable: true, controlled: true };
    const p = await probeEditor(async () => fake, '#a');
    expect(p.controlled).toBe(true);
    expect(p.richFamily).toBe('draft');
  });

  it('probeEditor evaluate 抛错时按非受控兜底（不阻塞 fill）', async () => {
    const p = await probeEditor(async () => { throw new Error('detached'); }, '#a');
    expect(p.controlled).toBe(false);
  });

  it('probeEditor 非对象返回值按非受控兜底', async () => {
    const p = await probeEditor(async () => null, '#a');
    expect(p.controlled).toBe(false);
  });
});
