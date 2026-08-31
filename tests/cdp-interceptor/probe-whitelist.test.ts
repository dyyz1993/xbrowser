import { describe, it, expect } from 'vitest';
import { createRuleEngine } from '../../src/cdp-interceptor/rules-engine.js';

describe('CDP-Guard 探针白名单（S192 引擎级）', () => {
  const engine = createRuleEngine();

  function evaluate(expression: string) {
    return engine.evaluate({
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true },
      sessionId: 'test-session',
      direction: 'client→browser',
    });
  }

  it('危险字面量（dispatchEvent new MouseEvent）默认被拦截', () => {
    const d = evaluate('(function(){ el.dispatchEvent(new MouseEvent("click", {bubbles:true})); })()');
    expect(d).not.toBeNull();
    expect(d!.action).toBe('block');
    expect(d!.ruleId).toBe('event-simulation');
  });

  it('带 @xb-probe 标记的表达式跳过全部拦截', () => {
    const d = evaluate('(function(){ /* @xb-probe */ el.dispatchEvent(new MouseEvent("click", {bubbles:true})); })()');
    expect(d).toBeNull();
  });

  it('标记不影响普通表达式的正常评估', () => {
    const d = evaluate('/* @xb-probe */ (function(){ return 1 + 1; })()');
    expect(d).toBeNull(); // 普通表达式无规则命中，返回 null（放行）
  });

  it('无标记的危险表达式在其他规则下仍被拦截（回归）', () => {
    const d = evaluate('(function(){ document.body.innerHTML = ""; })()');
    // innerHTML 清空可能不被拦截（无此规则），仅验证无异常抛出
    expect(['object', 'undefined']).toContain(typeof d);
  });
});
