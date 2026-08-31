/**
 * stealth-common.cjs — 桥任务 tab 的反检测纯逻辑（S164）
 *
 * 被两方共享：
 *  - background.js 通过 importScripts 加载（self.StealthCommon）
 *  - vitest 单测通过 ESM interop 加载（module.exports）
 *
 * L1 可见性一致性层：后台任务 tab 对页面 JS 自称"可见"——
 *   物理矛盾（hidden tab 收到 trusted 输入）是后台自动化的头号死穴，
 *   防守方给每个事件打的 visibility 戳必须与输入行为一致。
 *   d29 教训的延伸：伪装必须自洽（全链 visible），半真半假更可疑。
 *
 * L2 行为预热：真实的鼠标轨迹不是匀速直线——
 *   突发簇状采样、缓入缓出、过冲回修、悬停停留。
 *   预热数据进防守方事件数组的前排，后续任务事件混在自然数据里。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StealthCommon = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /**
   * L1：document_start 注入源。加到 Page.addScriptToEvaluateOnNewDocument，
   * 并在 task-open 后立即 Runtime.evaluate 一次覆盖当前文档。
   *
   * 一致性清单（全部指向 visible）：
   *   document.visibilityState / webkitVisibilityState
   *   document.hidden / webkitHidden
   *   document.hasFocus()
   *   visibilitychange 监听（真实状态切换发生时重新断言，防泄漏）
   *   rAF 垫片：hidden tab 的 rAF 完全静默是硬伤——垫片保证"会回调"，
   *   帧距受后台定时器节流限制（~1000ms），属已知残留（L3），文档明示不掩盖。
   */
  var VISIBILITY_STEALTH_SOURCE = [
    '(function(){',
    '  if (window.__xbVisStealth) return; window.__xbVisStealth = true;',
    '  var assert = function () {',
    '    try {',
    '      Object.defineProperty(document, "visibilityState", { get: function () { return "visible"; }, configurable: true });',
    '      Object.defineProperty(document, "webkitVisibilityState", { get: function () { return "visible"; }, configurable: true });',
    '      Object.defineProperty(document, "hidden", { get: function () { return false; }, configurable: true });',
    '      Object.defineProperty(document, "webkitHidden", { get: function () { return false; }, configurable: true });',
    '      document.hasFocus = function () { return true; };',
    '    } catch (e) {}',
    '  };',
    '  assert();',
    '  document.addEventListener("visibilitychange", function () { assert(); }, true);',
    '  var _raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : null;',
    '  window.requestAnimationFrame = function (cb) {',
    '    return setTimeout(function () { cb(performance.now()); }, 16);',
    '  };',
    '})();',
  ].join('\n');

  /**
   * 生成一段拟人鼠标轨迹点。
   * @param {object} o
   * @param {number} o.fromX 起点 x
   * @param {number} o.fromY 起点 y
   * @param {number} o.toX 终点 x
   * @param {number} o.toY 终点 y
   * @param {number} [o.steps=48] 点数
   * @param {number} [o.overshoot=0.06] 过冲比例（0 关闭）
   * @returns {Array<{x:number,y:number}>}
   */
  function generateMousePath(o) {
    var steps = o.steps || 48;
    var overshoot = o.overshoot === undefined ? 0.06 : o.overshoot;
    var dx = o.toX - o.fromX;
    var dy = o.toY - o.fromY;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    // 过冲：目标外延一段再修回（真实指针的常见形态）
    var overX = o.toX + (dx / dist) * dist * overshoot;
    var overY = o.toY + (dy / dist) * dist * overshoot;
    var pts = [];
    var i, t, ease, jitter, px, py;
    for (i = 0; i < steps; i++) {
      t = i / (steps - 1);
      ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
      jitter = (dist > 40 ? 2.2 : 0.8);
      px = o.fromX + (overX - o.fromX) * ease + (Math.random() - 0.5) * jitter;
      py = o.fromY + (overY - o.fromY) * ease + (Math.random() - 0.5) * jitter;
      pts.push({ x: Math.round(px), y: Math.round(py) });
    }
    // 修回段：从过冲点收敛到真实目标（5 步）
    for (i = 1; i <= 5; i++) {
      t = i / 5;
      pts.push({
        x: Math.round(overX + (o.toX - overX) * t),
        y: Math.round(overY + (o.toY - overY) * t),
      });
    }
    return pts;
  }

  /**
   * 规划一次预热行为序列。
   * @param {object} o
   * @param {number} o.w 视口宽
   * @param {number} o.h 视口高
   * @param {number} [o.ms=3000] 目标时长（毫秒）
   * @returns {Array<{type:'move'|'pause'|'wheel', x?:number, y?:number, dy?:number, delay:number}>}
   *   动作按序执行；move 走 generateMousePath 展开成连续点。
   */
  function planWarmup(o) {
    var w = o.w || 1280;
    var h = o.h || 720;
    var budget = o.ms || 3000;
    var actions = [];
    // 起始位：视口内随机（真实用户打开页面时指针在任意位置）
    var cx = w * (0.2 + Math.random() * 0.6);
    var cy = h * (0.2 + Math.random() * 0.6);
    // 3 段游走：随机目标点（避开边缘 10%），每段之间短暂停顿
    var segs = 3;
    var segMs = Math.max(400, Math.floor(budget / segs) - 120);
    // 采样密度随段时长缩放：真实鼠标 ~8ms/点（125Hz 上限）
    var stepsPerSeg = Math.max(12, Math.min(120, Math.round(segMs / 8)));
    var s, tx, ty, pts, k;
    for (s = 0; s < segs; s++) {
      tx = w * (0.1 + Math.random() * 0.8);
      ty = h * (0.1 + Math.random() * 0.8);
      pts = generateMousePath({ fromX: cx, fromY: cy, toX: tx, toY: ty, steps: stepsPerSeg });
      for (k = 0; k < pts.length; k++) {
        actions.push({ type: 'move', x: pts[k].x, y: pts[k].y, delay: Math.max(4, Math.round(8 * (0.5 + Math.random()))) });
      }
      cx = tx; cy = ty;
      if (s < segs - 1) {
        actions.push({ type: 'pause', delay: 80 + Math.round(Math.random() * 260) });
      }
    }
    // 收尾：一次小幅滚轮（阅读感），停顿
    actions.push({ type: 'wheel', x: cx, y: cy, dy: 120 + Math.round(Math.random() * 160), delay: 60 });
    actions.push({ type: 'pause', delay: 150 + Math.round(Math.random() * 200) });
    return actions;
  }

  return {
    VISIBILITY_STEALTH_SOURCE: VISIBILITY_STEALTH_SOURCE,
    generateMousePath: generateMousePath,
    planWarmup: planWarmup,
  };
});
