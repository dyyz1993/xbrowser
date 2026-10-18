import { describe, expect, it } from 'vitest';
import type { RuleContext } from '../../src/cdp-interceptor/types.js';
import { createRuleEngine } from '../../src/cdp-interceptor/rules-engine.js';
import { humanizeTransformRule } from '../../src/cdp-interceptor/rules/humanize-transform.js';

function makeCtx(method: string, params: Record<string, unknown>, state = new Map<string, unknown>()): RuleContext {
  return {
    method,
    params,
    sessionId: 'humanize-test',
    direction: 'client→browser',
    sessionState: state,
  };
}

describe('humanize transform rule', () => {
  it('expands a teleporting mouse move into a trusted bezier sequence', () => {
    const decision = humanizeTransformRule.evaluate(makeCtx('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: 300, y: 220,
    }));
    expect(decision?.action).toBe('transform');
    const sequence = decision?.transformedParams?.__sequence as Array<{ method: string; params: { type: string; x: number; y: number }; delayMs: number }>;
    expect(sequence.length).toBeGreaterThan(8);
    expect(sequence[0].method).toBe('Input.dispatchMouseEvent');
    expect(sequence.every((step) => step.params.type === 'mouseMoved')).toBe(true);
    const finalPoint = sequence.at(-1)?.params as { x: number; y: number };
    expect(Math.abs(finalPoint.x - 300)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(finalPoint.y - 220)).toBeLessThanOrEqual(1.5);
    expect(sequence.some((step) => step.delayMs > 0)).toBe(true);
  });

  it('keeps deliberate clicks and short moves untouched', () => {
    const short = humanizeTransformRule.evaluate(makeCtx('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 }));
    expect(short).toBeNull();
    const click = humanizeTransformRule.evaluate(makeCtx('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: 300, y: 220, button: 'left', clickCount: 1,
    }));
    expect(click).toBeNull();
  });

  it('converts insertText into a complete keyboard stream with rhythm', () => {
    const decision = humanizeTransformRule.evaluate(makeCtx('Input.insertText', { text: 'ab' }));
    expect(decision?.action).toBe('transform');
    const sequence = decision?.transformedParams?.__sequence as Array<{ method: string; params: { type: string } }>;
    expect(sequence.map((step) => step.params.type)).toEqual([
      'rawKeyDown', 'char', 'keyUp', 'rawKeyDown', 'char', 'keyUp',
    ]);
  });

  it('stays inactive until explicitly enabled and works via engine when enabled', () => {
    const engine = createRuleEngine();
    engine.start();
    expect(engine.evaluate(makeCtx('Input.insertText', { text: 'hello' }))).toBeNull();
    engine.stop();

    process.env.XBROWSER_HUMANIZE_CDP = 'on';
    try {
      const enabled = createRuleEngine();
      enabled.start();
      const decision = enabled.evaluate(makeCtx('Input.insertText', { text: 'hello' }));
      expect(decision?.action).toBe('transform');
      expect(decision?.ruleId).toBe('humanize-transform');
      enabled.stop();
    } finally {
      delete process.env.XBROWSER_HUMANIZE_CDP;
    }
  });
});
