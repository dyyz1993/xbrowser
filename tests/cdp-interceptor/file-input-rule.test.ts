/**
 * File Input Synthesis Rule (src/cdp-interceptor/rules/file-input.ts)
 *
 * 合成点击 file input 必须被拦，且替代指引指向 DOM.setFileInputFiles ——
 * 「用真实鼠标点击」在这里是反向指引：file input 上的可信点击只会弹系统
 * 文件选择框（2026-11-27 京东云备案页 8 连败的事故源）。
 *
 * 引擎级用例钉住优先级分流：file-input（35）先于 event-simulation（40），
 * file input 场景给上传指引，其余场景保留原 event-simulation 建议。
 */
import { describe, it, expect } from 'vitest';
import type { RuleContext } from '../../src/cdp-interceptor/types.js';
import { createRuleEngine } from '../../src/cdp-interceptor/rules-engine.js';
import { fileInputRule } from '../../src/cdp-interceptor/rules/file-input.js';

function makeCtx(expression: string, method = 'Runtime.evaluate'): RuleContext {
  return {
    method,
    params: method === 'Runtime.callFunctionOn'
      ? { functionDeclaration: 'function utilityScript.evaluate() { [native code] }', arguments: [{ value: expression }] }
      : { expression },
    sessionId: 'test-session',
    direction: 'client→browser',
    sessionState: new Map(),
  };
}

describe('file-input rule — synthetic click on a file input', () => {
  it('blocks input[type=file].click() and points at DOM.setFileInputFiles', () => {
    const d = fileInputRule.evaluate(makeCtx(`document.querySelector("input[type=file]").click()`));
    expect(d).not.toBeNull();
    expect(d?.ruleId).toBe('file-input-synthesis');
    expect(d?.action).toBe('block');
    expect(d?.severity).toBe('danger');
    expect(d?.suggestion).toContain('DOM.setFileInputFiles');
    // 反向指引必须在替代里绝迹：真实点击 file input 只会弹系统文件对话框
    expect(d?.suggestion).not.toContain('Input.dispatchMouseEvent');
    expect(d?.suggestion).not.toContain('page.click');
    expect(d?.reason).not.toContain('Input.dispatchMouseEvent');
  });

  it('matches every visible type=file spelling, on evaluate and callFunctionOn', () => {
    const expressions = [
      `document.querySelector('input[type=file]').click()`,
      `document.querySelector('input[type="file"]').click()`,
      `document.querySelector("input[type='file']").click()`,
      `document.querySelector('input[ type = file ]').click()`,
      `document.querySelector('input[type=file]').dispatchEvent(new MouseEvent('click'))`,
    ];
    for (const expr of expressions) {
      const viaEvaluate = fileInputRule.evaluate(makeCtx(expr));
      const viaCallFunctionOn = fileInputRule.evaluate(makeCtx(expr, 'Runtime.callFunctionOn'));
      expect(viaEvaluate?.ruleId, expr).toBe('file-input-synthesis');
      expect(viaEvaluate?.action, expr).toBe('block');
      expect(viaCallFunctionOn?.ruleId, expr).toBe('file-input-synthesis');
    }
  });

  it('stays silent without a synthetic trigger (reading files.length is fine)', () => {
    expect(fileInputRule.evaluate(makeCtx(`document.querySelector('input[type=file]').files.length`))).toBeNull();
    expect(fileInputRule.evaluate(makeCtx(`document.querySelector('input[type=file]')`))).toBeNull();
  });

  it('stays silent for other elements (el.click() stays event-simulation territory)', () => {
    expect(fileInputRule.evaluate(makeCtx(`document.querySelector('button').click()`))).toBeNull();
  });

  it('ignores compound attributes like data-type="file"', () => {
    expect(fileInputRule.evaluate(makeCtx(`document.querySelector('[data-type=file]').click()`))).toBeNull();
    expect(fileInputRule.evaluate(makeCtx(`document.querySelector('[data-type="file"]').click()`))).toBeNull();
  });

  it('probe-marked traffic passes (S190)', () => {
    expect(fileInputRule.evaluate(makeCtx(`document.querySelector('input[type=file]').click() /* @xb-probe */`))).toBeNull();
  });

  it('engine prefers this rule over event-simulation (priority 35 < 40)', () => {
    const engine = createRuleEngine();
    engine.start();
    const d = engine.evaluate({
      method: 'Runtime.evaluate',
      params: { expression: `document.querySelector("input[type=file]").click()` },
      sessionId: 's',
      direction: 'client→browser',
    });
    expect(d?.ruleId).toBe('file-input-synthesis');
    expect(d?.action).toBe('block');
    expect(d?.suggestion).toContain('DOM.setFileInputFiles');
    expect(d?.suggestion).not.toContain('Input.dispatchMouseEvent');
  });

  it('engine keeps the generic event-simulation advice for a normal element click', () => {
    const engine = createRuleEngine();
    engine.start();
    const d = engine.evaluate({
      method: 'Runtime.evaluate',
      params: { expression: `document.querySelector('button').click()` },
      sessionId: 's',
      direction: 'client→browser',
    });
    expect(d?.ruleId).toBe('event-simulation');
    expect(d?.suggestion).toContain('Input.dispatchMouseEvent');
  });
});
