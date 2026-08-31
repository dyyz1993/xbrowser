/**
 * xbrowser Login Bridge — background worker
 *
 * 登录态：导出 cookie+localStorage 到 bridge（9355 HTTP），导入反向同步。
 * 控制通道（S103）：常驻 WS 客户端连 xbrowser bridge（ws://127.0.0.1:9346），
 * 接收 xbrowser 下发的命令（navigate/evaluate/click/fill/tabs/screenshot），
 * 在用户浏览器内执行 —— 无需开 --remote-debugging-port。
 */

const BRIDGE = 'http://127.0.0.1:9355';
const WS_BRIDGE = 'ws://127.0.0.1:9346';
// S164-BISECT-2: 内联 stealth-common（importScripts 在真实 SW 崩，源码内联绕开）
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

const stealthTabs = new Set();
// S164-BISECT-2-END

// 持久 attach 的任务 tab：已注册 document_start 伪装脚本。
// 这些 tab 上的 evaluate/trustedClick/screenshot 跳过 attach/detach
//（二次 attach 会报 "Another debugger is already attached"，
//  且 detach-first 会拆掉伪装注册）。
async function enableTaskStealth(tabId) {
  const dbg = { tabId };
  const attachOnce = (retry) => new Promise((resolve) => {
    chrome.debugger.attach(dbg, '1.3', () => {
      const err = chrome.runtime.lastError;
      if (!err) { resolve(true); return; }
      // 残留 attach（此前流程异常退出）→ 拆掉重试一次
      if (retry && /already attached/i.test(err.message)) {
        chrome.debugger.detach(dbg).catch(() => {}).finally(() => {
          chrome.debugger.attach(dbg, '1.3', () => {
            resolve(!chrome.runtime.lastError);
          });
        });
        return;
      }
      resolve(false);
    });
  });
  const ok = await attachOnce(true);
  if (!ok) return { ok: false, error: 'attach failed' };
  const send = (method, params) => new Promise((resolve) => {
    chrome.debugger.sendCommand(dbg, method, params || {}, () => resolve(!chrome.runtime.lastError));
  });
  await send('Page.enable');
  const reg = await new Promise((resolve) => {
    chrome.debugger.sendCommand(dbg, 'Page.addScriptToEvaluateOnNewDocument',
      { source: StealthCommon.VISIBILITY_STEALTH_SOURCE }, (r) => resolve(r));
  });
  if (chrome.runtime.lastError) return { ok: false, error: chrome.runtime.lastError.message };
  // 立即对当前文档生效（addScriptToEvaluateOnNewDocument 只管后续文档）
  await send('Runtime.evaluate', { expression: StealthCommon.VISIBILITY_STEALTH_SOURCE });
  stealthTabs.add(tabId);
  return { ok: true, tabId, identifier: reg?.identifier, persistent: true };
}

// ── 登录态（原有能力） ──────────────────────────────────────

async function exportCookies(domainFilter) {
  const all = await chrome.cookies.getAll(domainFilter ? { domain: domainFilter } : {});
  return all.map((c) => ({
    domain: c.domain, name: c.name, value: c.value, path: c.path,
    secure: c.secure, httpOnly: c.httpOnly,
    sameSite: c.sameSite === 'unspecified' ? 'unspecified' : c.sameSite,
    expirationDate: c.expirationDate, hostOnly: c.hostOnly, storeId: c.storeId,
  }));
}

async function exportLocalStorage(tab, domainFilter) {
  if (!tab || !tab.id) return [];
  if (domainFilter && !(tab.url || '').includes(domainFilter.replace(/^\./, ''))) return [];
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const out = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          out.push({ key: k, value: localStorage.getItem(k) });
        }
        return out;
      },
    });
    return (result || []).map((e) => ({ url: tab.url, ...e }));
  } catch { return []; }
}

async function pushToBridge(payload) {
  const resp = await fetch(`${BRIDGE}/cookies`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

async function pullFromBridge(domain) {
  const resp = await fetch(`${BRIDGE}/cookies?domain=${encodeURIComponent(domain || '')}`);
  return resp.json();
}

async function importCookies(items) {
  let ok = 0, fail = 0;
  for (const c of items) {
    try {
      const details = {
        url: `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path || '/'}`,
        name: c.name, value: c.value, path: c.path || '/',
        secure: !!c.secure, httpOnly: !!c.httpOnly,
      };
      if (!c.hostOnly && c.domain && c.domain.startsWith('.')) details.domain = c.domain;
      if (c.expirationDate) details.expirationDate = c.expirationDate;
      if (c.sameSite && c.sameSite !== 'unspecified') details.sameSite = c.sameSite;
      await chrome.cookies.set(details);
      ok++;
    } catch { fail++; }
  }
  return { ok, fail };
}

// ── 控制通道执行器（S103） ──────────────────────────────────


// S139：获取目标 tab——优先用 xb-task 组的最后一个 tab（后台），不抢用户焦点
async function getTaskTabId() {
  const groups = await chrome.tabGroups.query({});
  const taskGroups = groups.filter(g => g.title && g.title.startsWith('xb-task-'));
  if (taskGroups.length > 0) {
    // 取最后一个任务组的 tab
    const g = taskGroups[taskGroups.length - 1];
    const tabs = await chrome.tabs.query({ groupId: g.id });
    if (tabs.length > 0) return tabs[tabs.length - 1].id;
  }
  // fallback: active tab（兼容无任务组的旧用法）
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active?.id;
}

const executors = {
  // ── S121: CDP 透传（核心：命令转发器，扩展零逻辑） ──
  cdp: async ({ tabId, method, params }) => {
    const target = tabId ?? await getTaskTabId();
    return new Promise((resolve) => {
      chrome.debugger.attach({ tabId: target }, '1.3', () => {
        // 已 attach 也继续（幂等）
        chrome.debugger.sendCommand({ tabId: target }, method, params || {}, (result) => {
          const err = chrome.runtime.lastError;
          if (err) resolve({ ok: false, error: err.message });
          else resolve({ ok: true, data: result });
        });
      });
    });
  },
  'cdp-detach': async ({ tabId }) => {
    const target = tabId ?? null;
    if (target) {
      await chrome.debugger.detach({ tabId: target }).catch(() => {});
      return { ok: true, detached: target };
    }
    return { ok: false, error: 'no tabId' };
  },

  // ── S121: tab group 生命周期（任务分组） ──
  'task-open': async ({ name, url }) => {
    const tab = await chrome.tabs.create({ url: url || 'about:blank', active: false }); // 后台创建，不抢焦点
    const group = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(group, { title: 'xb-task-' + (name || 'default'), color: 'green' });
    // S164: 任务 tab 预置可见性一致性层（失败降级为普通任务 tab，不阻塞）
    const stealth = await enableTaskStealth(tab.id).catch((e) => ({ ok: false, error: String(e) }));
    return { tabId: tab.id, groupId: group, stealth: stealth.ok };
  },
  'task-close': async ({ name }) => {
    const groups = await chrome.tabGroups.query({});
    const targets = name
      ? groups.filter((g) => g.title === 'xb-task-' + name)
      : groups.filter((g) => g.title.startsWith('xb-task-'));
    let closed = 0;
    for (const g of targets) {
      const tabs = await chrome.tabs.query({ groupId: g.id });
      for (const t of tabs) {
        await chrome.tabs.remove(t.id).catch(() => {});
        stealthTabs.delete(t.id);
      }
      closed++;
    }
    return { closed };
  },
  'task-list': async () => {
    const groups = await chrome.tabGroups.query({});
    const out = [];
    for (const g of groups.filter((g) => g.title.startsWith('xb-task-'))) {
      const tabs = await chrome.tabs.query({ groupId: g.id });
      out.push({
        name: g.title.slice(8),
        groupId: g.id,
        tabs: tabs.map((t) => ({ id: t.id, url: (t.url || '').slice(0, 60), title: (t.title || '').slice(0, 30) })),
      });
    }
    return out;
  },

  ping: async () => ({ pong: true, ua: navigator.userAgent }),

  tabs: async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active }));
  },

  navigate: async ({ url, tabId }) => {
    const target = tabId ?? await getTaskTabId();
    if (url) {
      if (target != null) {
        await chrome.tabs.update(target, { url, active: false });
        return { ok: true, tabId: target };
      }
      const tab = await chrome.tabs.create({ url, active: false }); // 后台创建，不抢焦点
      return { ok: true, tabId: tab.id, created: true };
    }
    return { ok: false, error: 'no url' };
  },

  evaluate: async ({ expression, tabId }) => {
    // S105：chrome.scripting（含 world MAIN）的注入都受 CSP 约束（eval 被拦）。
    // chrome.debugger 走 CDP Runtime.evaluate —— DevTools console 同源能力，
    // 不受页面/扩展 CSP 限制。attach 时浏览器顶部出现"正在调试"横幅（用户可见）。
    // S164：stealthTabs 上的 tab 走持久 attach，跳过 attach/detach。
    const target = tabId ?? await getTaskTabId();
    const persistent = stealthTabs.has(target);
    return new Promise((resolve) => {
      const dbg = { tabId: target };
      const finish = (r) => {
        if (!persistent) chrome.debugger.detach(dbg).catch(() => {});
        if (r?.exceptionDetails) {
          resolve({ ok: false, error: r.exceptionDetails.exception?.description || r.exceptionDetails.text });
        } else {
          let v = r?.result?.value;
          if (v === undefined) v = null;
          else if (typeof v === 'object') { try { v = JSON.parse(JSON.stringify(v)); } catch {} }
          resolve({ ok: true, value: v });
        }
      };
      if (persistent) {
        chrome.debugger.sendCommand(dbg, 'Runtime.evaluate',
          { expression, returnByValue: true, awaitPromise: true },
          (r) => finish(r));
        return;
      }
      chrome.debugger.attach(dbg, '1.3', () => {
        const err = chrome.runtime.lastError;
        if (err) { resolve({ ok: false, error: err.message }); return; }
        chrome.debugger.sendCommand(dbg, 'Runtime.evaluate',
          { expression, returnByValue: true, awaitPromise: true },
          (r) => finish(r));
      });
    });
  },

  click: async ({ selector, tabId }) => {
    const target = tabId ?? await getTaskTabId();
    const [{ result, error }] = await chrome.scripting.executeScript({
      target: { tabId: target },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { ok: false, error: 'not found: ' + sel };
        el.click();
        return { ok: true };
      },
      args: [selector],
    });
    return error ? { ok: false, error: String(error) } : result;
  },

  fill: async ({ selector, value, tabId }) => {
    const target = tabId ?? await getTaskTabId();
    const [{ result, error }] = await chrome.scripting.executeScript({
      target: { tabId: target },
      func: (sel, val) => {
        const el = document.querySelector(sel);
        if (!el) return { ok: false, error: 'not found: ' + sel };
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      },
      args: [selector, value],
    });
    return error ? { ok: false, error: String(error) } : result;
  },

  uploadFile: async ({ filePathB64, fileName, selector, tabId }) => {
    // S113：页面级 DataTransfer 注入被 React 清零（files 赋值立即归零）。
    // chrome.debugger DOM.setFileInputFiles 是原生级（等价手动选文件）。
    // 限制：CDP 的 setFileInputFiles 只接受 file:// 真实路径 —— 先把
    // base64 落到扩展可写的临时位置不可行（SW 无 fs），改走两步：
    // 1) navigate 到 file:// 中转页不行 —— 直接用 sendCommand 前把文件
    //    写入由 CLI 侧先放置的固定路径（CLI 负责写盘）。
    const target = tabId ?? await getTaskTabId();
    return new Promise((resolve) => {
      const dbg = { tabId: target };
      chrome.debugger.attach(dbg, '1.3', () => {
        const err = chrome.runtime.lastError;
        if (err) { resolve({ ok: false, error: err.message }); return; }
        // 先查 input 节点（DOM.getDocument + querySelector）
        chrome.debugger.sendCommand(dbg, 'DOM.getDocument', {}, (doc) => {
          chrome.debugger.sendCommand(dbg, 'DOM.querySelector', {
            nodeId: doc.root.nodeId, selector: selector || 'input[type=file]:last-of-type',
          }, (q) => {
            if (!q || !q.nodeId) { chrome.debugger.detach(dbg); resolve({ ok: false, error: 'input node not found' }); return; }
            chrome.debugger.sendCommand(dbg, 'DOM.setFileInputFiles', {
              nodeId: q.nodeId,
              // position-22 反序列化 bug 规避：显式构造纯字符串数组
              files: [String(filePathB64)].filter(Boolean),
            }, () => {
              const err2 = chrome.runtime.lastError;
              chrome.debugger.detach(dbg);
              resolve(err2 ? { ok: false, error: err2.message } : { ok: true, nodeSet: true });
            });
          });
        });
      });
    });
  },

  // S120：可信点击（chrome.debugger Input.dispatchMouseEvent）——
  // 页面 el.click() 是合成事件，ProseMirror 等框架不认；可信点击等价鼠标。
  trustedClick: async ({ x, y, tabId }) => {
    const target = tabId ?? await getTaskTabId();
    const persistent = stealthTabs.has(target); // S164: 持久 attach 不做 detach-first（会拆伪装）
    return new Promise((resolve) => {
      const dbg = { tabId: target };
      const dispatch = () => {
        chrome.debugger.sendCommand(dbg, 'Input.dispatchMouseEvent',
          { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, () => {
            chrome.debugger.sendCommand(dbg, 'Input.dispatchMouseEvent',
              { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, () => {
                if (!persistent) chrome.debugger.detach(dbg).catch(() => {});
                resolve({ ok: true, clicked: x + ',' + y });
              });
          });
      };
      if (persistent) { dispatch(); return; }
      // 先 detach（可能残留）再 attach —— 残留 attach 会让新 attach 静默失败
      chrome.debugger.detach(dbg).catch(() => {}).finally(() => {
        chrome.debugger.attach(dbg, '1.3', () => {
          const err = chrome.runtime.lastError;
          if (err) { resolve({ ok: false, error: err.message }); return; }
          dispatch();
        });
      });
    });
  },

  // S164: 行为预热（L2）——trusted 鼠标轨迹 + 滚轮。
  // 防守方事件数组的前排应当是自然数据：变速曲线游走、停顿、小幅滚动。
  // 全部经 Input 域派发（isTrusted=true），与真实输入在事件层面不可区分。
  warmup: async ({ tabId, ms }) => {
    const target = tabId ?? await getTaskTabId();
    if (target == null) return { ok: false, error: 'no tabId' };
    const dbg = { tabId: target };
    const persistent = stealthTabs.has(target);
    const attachIfNeeded = () => new Promise((resolve) => {
      if (persistent) { resolve(true); return; }
      chrome.debugger.attach(dbg, '1.3', () => resolve(!chrome.runtime.lastError));
    });
    // 视口尺寸
    const vp = await new Promise((resolve) => {
      chrome.debugger.sendCommand(dbg, 'Runtime.evaluate',
        { expression: 'JSON.stringify({w:innerWidth,h:innerHeight})', returnByValue: true }, (r) => {
          try { resolve(JSON.parse(r.result.value)); } catch { resolve({ w: 1280, h: 720 }); }
        });
    });
    const okAttach = await attachIfNeeded();
    if (!okAttach) return { ok: false, error: 'attach failed' };
    const actions = StealthCommon.planWarmup({ w: vp.w, h: vp.h, ms: ms || 3000 });
    const t0 = Date.now();
    let done = 0;
    const budget = (ms || 3000) * 2 + 4000; // 死线：回调链任何一处卡死也不挂起调用方
    await new Promise((resolve) => {
      let finished = false;
      const fin = () => { if (!finished) { finished = true; resolve(); } };
      setTimeout(fin, budget);
      const step = () => {
        if (finished) return;
        if (done >= actions.length) { fin(); return; }
        const a = actions[done++];
        const fire = (ok) => {
          if (finished) return;
          if (!ok) { fin(); return; } // 派发失败（tab 关闭等）立即收尾
          setTimeout(step, a.delay);
        };
        if (a.type === 'move') {
          chrome.debugger.sendCommand(dbg, 'Input.dispatchMouseEvent',
            { type: 'mouseMoved', x: a.x, y: a.y, buttons: 0 }, () => fire(!chrome.runtime.lastError));
        } else if (a.type === 'wheel') {
          chrome.debugger.sendCommand(dbg, 'Input.dispatchMouseEvent',
            { type: 'mouseWheel', x: a.x, y: a.y, deltaX: 0, deltaY: a.dy }, () => fire(!chrome.runtime.lastError));
        } else { // pause
          setTimeout(step, a.delay);
        }
      };
      step();
    });
    if (!persistent) chrome.debugger.detach(dbg).catch(() => {});
    return { ok: true, tabId: target, actions: actions.length, ms: Date.now() - t0 };
  },

  // S161：tabId 感知截图——captureVisibleTab 只能截激活 tab（会截到用户正在看的页面），
  // 指定 tabId 时改用 debugger Page.captureScreenshot（后台 tab 也能截，截完立即 detach）
  screenshot: async ({ tabId }) => {
    if (tabId != null) {
      const persistent = stealthTabs.has(tabId); // S164
      return new Promise((resolve) => {
        const dbg = { tabId };
        const capture = () => {
          chrome.debugger.sendCommand(dbg, 'Page.captureScreenshot', { format: 'png' }, (res) => {
            if (!persistent) chrome.debugger.detach(dbg).catch(() => {});
            if (chrome.runtime.lastError || !res || !res.data) {
              resolve({ ok: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'capture failed' });
              return;
            }
            resolve({ ok: true, fullLength: res.data.length + 22, base64: res.data });
          });
        };
        if (persistent) { capture(); return; }
        chrome.debugger.detach(dbg).catch(() => {}).finally(() => {
          chrome.debugger.attach(dbg, '1.3', () => {
            if (chrome.runtime.lastError) {
              const url = chrome.tabs.captureVisibleTab(null, { format: 'png' });
              url.then(u => resolve({ ok: true, fallback: 'visible', fullLength: u.length, base64: u.split(',')[1] }));
              return;
            }
            capture();
          });
        });
      });
    }
    const url = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    return { ok: true, dataUrl: url.slice(0, 100), fullLength: url.length, base64: url.split(',')[1] };
  },

  url: async ({ tabId }) => {
    const t = tabId != null
      ? (await chrome.tabs.get(tabId))
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    return { ok: true, url: t?.url, title: t?.title };
  },
};

// ── WS 客户端（连 xbrowser bridge 9346） ────────────────────

let ws = null;
let backoff = 1000;

function badge(text, color) {
  try { chrome.action.setBadgeText({ text }); if (color) chrome.action.setBadgeBackgroundColor({ color }); } catch {}
}

function connectWS() {
  try { ws = new WebSocket(WS_BRIDGE); } catch { scheduleReconnect(); return; }
  ws.onopen = () => { backoff = 1000; badge('ON', '#238636'); };
  ws.onclose = () => { ws = null; badge('off', '#8b949e'); scheduleReconnect(); };
  ws.onerror = () => { try { ws.close(); } catch {} };
  ws.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const { id, cmd, args } = msg || {};
    const reply = (payload) => { try { ws?.send(JSON.stringify({ id, ...payload })); } catch {} };
    const exec = executors[cmd];
    if (!exec) { reply({ ok: false, error: `unknown cmd: ${cmd}` }); return; }
    try { reply({ ok: true, data: await exec(args || {}) }); }
    catch (e) { reply({ ok: false, error: String(e) }); }
  };
}

function scheduleReconnect() {
  setTimeout(connectWS, backoff);
  backoff = Math.min(backoff * 2, 15000);
}

connectWS();

// MV3 SW 生命周期兜底（S103）：SW 空闲 ~30s 被杀，setTimeout 重试随进程
// 蒸发（实测扩展加载成功但永不连入的根因）。alarms 是 Chrome 官方的
// 定时唤醒源 —— 每 30s 唤醒 SW，若 WS 断开则重连。
chrome.alarms.create('ws-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'ws-keepalive' && (!ws || ws.readyState > 1)) {
    connectWS();
  }
});

// ── Message router (popup → worker) ─────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'export') {
        const cookies = await exportCookies(msg.domain);
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const local = await exportLocalStorage(tab, msg.domain);
        const result = await pushToBridge({ source: 'chrome', domain: msg.domain || '*', cookies, localStorage: local, at: Date.now() });
        sendResponse({ ok: true, cookies: cookies.length, localStorage: local.length, result, wsConnected: !!ws });
      } else if (msg.type === 'import') {
        const data = await pullFromBridge(msg.domain);
        const r = await importCookies(data.cookies || []);
        sendResponse({ ok: true, ...r, wsConnected: !!ws });
      } else if (msg.type === 'status') {
        sendResponse({ ok: true, wsConnected: !!ws, wsBridge: WS_BRIDGE });
      } else if (msg.type === 'tabs') {
        const tabs = await chrome.tabs.query({});
        const groups = {};
        for (const t of tabs) {
          const g = t.groupId && t.groupId !== -1 ? `group-${t.groupId}` : 'ungrouped';
          (groups[g] = groups[g] || []).push({ title: t.title, url: t.url });
        }
        sendResponse({ ok: true, groups });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true;
});
