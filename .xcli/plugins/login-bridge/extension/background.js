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

const executors = {
  ping: async () => ({ pong: true, ua: navigator.userAgent }),

  tabs: async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active }));
  },

  navigate: async ({ url, tabId }) => {
    const target = tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (url) {
      if (target != null) {
        await chrome.tabs.update(target, { url });
        return { ok: true, tabId: target };
      }
      const tab = await chrome.tabs.create({ url, active: true });
      return { ok: true, tabId: tab.id, created: true };
    }
    return { ok: false, error: 'no url' };
  },

  evaluate: async ({ expression, tabId, allFrames }) => {
    const target = tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    // world: MAIN —— 在页面上下文执行（扩展 CSP 禁 eval，S104 实测
    // EvalError；MAIN world 遵循页面自身 CSP，绝大多数页面可用）
    const [{ result, error }] = await chrome.scripting.executeScript({
      target: { tabId: target, allFrames: !!allFrames },
      world: 'MAIN',
      func: (expr) => {
        try {
          const v = eval(expr);
          return { ok: true, value: v === undefined ? null : (typeof v === 'function' ? String(v) : (typeof v === 'object' ? JSON.stringify(v) : v)) };
        } catch (e) { return { ok: false, error: String(e) }; }
      },
      args: [expression],
    });
    return error ? { ok: false, error: String(error) } : result;
  },

  click: async ({ selector, tabId }) => {
    const target = tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
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
    const target = tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
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

  screenshot: async () => {
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
