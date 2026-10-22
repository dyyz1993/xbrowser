/**
 * chrome-bridge 通道守卫 —— 所有经 /exec 下发的命令先过 CDP Guard 规则引擎。
 *
 * 铁律（用户 2026-10-22 定）：所有插件/通道的自动化输入必须经过守卫；
 * bridge（HTTP 9347 → 扩展 → chrome.debugger）此前完全绕过引擎裸奔。
 *
 * 引擎复用 xbrowser dist 的 createRuleEngine（173 规则/10 模块），从插件目录
 * 向上探测 dist/index.js；XBROWSER_CDP_GUARD=off 与主通道同一开关。
 * 引擎不可用时对危险命令（cdp/click/evaluate）熔断拒绝——守卫宁关不裸奔。
 */

/** @typedef {{ evaluate(ctx: { method: string; params: Record<string, unknown>; sessionId: string; direction: string }): { action: string; reason?: string; suggestion?: string; ruleId?: string } | null, start(): void, stop(): void }} RuleEngine */

/** @type {RuleEngine | null | undefined} */
let cachedEngine;
/** @type {false | null | RuleEngine} 测试注入覆盖：false=未注入 */
let engineOverride = false;

const DANGER_CMDS = new Set(['cdp', 'click', 'evaluate']);

/**
 * 动态加载规则引擎（dist/index.js 的 createRuleEngine）。
 * @returns {Promise<RuleEngine | null>}
 */
export async function loadGuardEngine() {
  if (engineOverride !== false) return engineOverride;
  if (cachedEngine !== undefined) return cachedEngine ?? null;
  if (process.env.XBROWSER_CDP_GUARD === 'off') {
    cachedEngine = null;
    return null;
  }
  const { existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const candidates = [];
  if (process.env.XBROWSER_DIST_INDEX) candidates.push(process.env.XBROWSER_DIST_INDEX);
  let dir = fileURLToPath(new URL('.', import.meta.url));
  for (let i = 0; i < 6; i++) {
    candidates.push(dir + 'dist/index.js');
    dir += '../';
  }
  for (const c of candidates) {
    try {
      if (!existsSync(c)) continue;
      const mod = await import(c);
      if (typeof mod.createRuleEngine !== 'function') continue;
      const engine = mod.createRuleEngine();
      engine.start();
      cachedEngine = engine;
      return engine;
    } catch { /* try next candidate */ }
  }
  cachedEngine = null;
  return null;
}

/** 测试注入：传 null 模拟引擎不可用，传对象模拟引擎决策 */
export function setGuardEngineForTests(engine) {
  engineOverride = engine;
  cachedEngine = undefined;
}

/** 展开为 CDP 命令形态；click 是扩展侧 el.click() 合成（恒危险），直接给硬决策 */
function toCdpShape(cmd, args) {
  const a = args || {};
  if (cmd === 'cdp') {
    if (typeof a.method !== 'string') return null;
    return { method: a.method, params: a.params || {} };
  }
  if (cmd === 'evaluate') {
    if (typeof a.expression !== 'string') return null;
    return { method: 'Runtime.evaluate', params: { expression: a.expression } };
  }
  return null;
}

/**
 * 检查一条 bridge /exec 命令。
 * @returns {Promise<{ blocked: boolean; message?: string; ruleId?: string }>}
 */
export async function checkBridgeCommand(cmd, args) {
  if (process.env.XBROWSER_CDP_GUARD === 'off') return { blocked: false };

  if (cmd === 'click') {
    // 扩展 click = content-script el.click()，isTrusted=false，恒拒绝
    return {
      blocked: true,
      ruleId: 'event-simulation',
      message: '[CDP-Guard] bridge cmd "click" 用 el.click() 派发合成事件（isTrusted=false，可被站点检测）。'
        + ' | 替代: 用 cmd "cdp" 的 Input.dispatchMouseEvent 在元素中心坐标真实点击（isTrusted=true），'
        + '输入类用 cmd "type"（键盘流）。 [event-simulation]',
    };
  }

  const shape = toCdpShape(cmd, args);
  if (!shape) return { blocked: false }; // ping/tabs/navigate/fill/type/screenshot 等低危命令放行（fill 有扩展侧受控检测自升级）

  const engine = await loadGuardEngine();
  if (!engine) {
    // 引擎不可用 → 危险命令熔断（宁关不裸奔）
    return {
      blocked: true,
      ruleId: 'guard-unavailable',
      message: `[CDP-Guard] 规则引擎不可用（dist 未解析），通道对危险命令已熔断：cmd=${cmd}`
        + ' | 替代: 设置 XBROWSER_DIST_INDEX 指向 xbrowser 的 dist/index.js 后重启 bridge。 [guard-unavailable]',
    };
  }
  const decision = engine.evaluate({
    method: shape.method,
    params: shape.params,
    sessionId: 'chrome-bridge',
    direction: 'client→browser',
  });
  if (decision && decision.action === 'block') {
    return {
      blocked: true,
      ruleId: decision.ruleId,
      message: `[CDP-Guard] ${decision.reason}`
        + (decision.suggestion ? ` | 替代: ${decision.suggestion}` : '')
        + ` [${decision.ruleId}]`,
    };
  }
  return { blocked: false };
}
