import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// bridge 通道守卫：guard.mjs 必须把危险命令拦在扩展之前，并返回 [CDP-Guard]+替代 提示。
// 铁律（2026-10-22 用户定）：所有插件/通道的自动化输入必须经过守卫。
// @ts-expect-error -- 插件 .mjs 无类型声明（运行时消费；接口在下方手工断言）
import { checkBridgeCommand, setGuardEngineForTests } from '../../.xcli/plugins/chrome-bridge/guard.mjs';

interface GuardDecision {
  action: string;
  reason?: string;
  suggestion?: string;
  ruleId?: string;
}

function fakeEngine(decision: GuardDecision | null) {
  return {
    evaluate: vi.fn(() => decision),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

describe('chrome-bridge guard (铁律：所有插件必须经过守卫)', () => {
  beforeEach(() => {
    delete process.env.XBROWSER_CDP_GUARD;
  });
  afterEach(() => {
    setGuardEngineForTests(false);
    delete process.env.XBROWSER_CDP_GUARD;
  });

  it('click 命令恒拒（扩展 click = el.click() 合成事件）并给出替代用法', async () => {
    const r = await checkBridgeCommand('click', { selector: '#btn' });
    expect(r.blocked).toBe(true);
    expect(r.ruleId).toBe('event-simulation');
    expect(r.message).toContain('[CDP-Guard]');
    expect(r.message).toContain('替代');
    expect(r.message).toContain('Input.dispatchMouseEvent');
  });

  it('cdp 命令命中规则引擎 block 决策时拒绝并透传 reason+suggestion', async () => {
    const engine = fakeEngine({
      action: 'block',
      reason: 'Event simulation detected: "el.click()".',
      suggestion: 'Use page.click(selector).',
      ruleId: 'event-simulation',
    });
    setGuardEngineForTests(engine);
    const r = await checkBridgeCommand('cdp', {
      method: 'Runtime.evaluate',
      params: { expression: 'document.querySelector("button").click()' },
      tabId: 1,
    });
    expect(r.blocked).toBe(true);
    expect(r.message).toContain('[CDP-Guard] Event simulation detected');
    expect(r.message).toContain('| 替代: Use page.click(selector).');
    expect(r.message).toContain('[event-simulation]');
    // 引擎必须收到展开后的 CDP 形态
    expect(engine.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      method: 'Runtime.evaluate',
      direction: 'client→browser',
    }));
  });

  it('evaluate 命令的表达式过规则引擎（合成事件表达式被拦）', async () => {
    const engine = fakeEngine({
      action: 'block', reason: 'R', suggestion: 'S', ruleId: 'event-simulation',
    });
    setGuardEngineForTests(engine);
    const r = await checkBridgeCommand('evaluate', {
      expression: 'el.dispatchEvent(new MouseEvent("click"))',
      tabId: 1,
    });
    expect(r.blocked).toBe(true);
    expect(engine.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      method: 'Runtime.evaluate',
      params: { expression: 'el.dispatchEvent(new MouseEvent("click"))' },
    }));
  });

  it('引擎放行的 cdp 命令正常通过（安全命令不误伤）', async () => {
    setGuardEngineForTests(fakeEngine(null));
    const r = await checkBridgeCommand('cdp', { method: 'Runtime.evaluate', params: { expression: '1+1' }, tabId: 1 });
    expect(r.blocked).toBe(false);
  });

  it('低危命令（ping/tabs/navigate/type/fill）不触发引擎直接放行', async () => {
    const engine = fakeEngine({ action: 'block', reason: 'x', ruleId: 'r' });
    setGuardEngineForTests(engine);
    for (const cmd of ['ping', 'tabs', 'navigate', 'type', 'fill', 'screenshot', 'url']) {
      const r = await checkBridgeCommand(cmd, {});
      expect(r.blocked, `cmd=${cmd} 应放行`).toBe(false);
    }
    expect(engine.evaluate).not.toHaveBeenCalled();
  });

  it('引擎不可用时危险命令熔断（宁关不裸奔），并提示修复路径', async () => {
    setGuardEngineForTests(null);
    const r = await checkBridgeCommand('cdp', { method: 'Input.insertText', params: { text: 'x' }, tabId: 1 });
    expect(r.blocked).toBe(true);
    expect(r.ruleId).toBe('guard-unavailable');
    expect(r.message).toContain('XBROWSER_DIST_INDEX');
  });

  it('XBROWSER_CDP_GUARD=off 与主通道同一开关（全部放行）', async () => {
    process.env.XBROWSER_CDP_GUARD = 'off';
    const r = await checkBridgeCommand('click', { selector: '#x' });
    expect(r.blocked).toBe(false);
  });
});
