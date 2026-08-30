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
  // ── S121: CDP 透传（核心：命令转发器，扩展零逻辑） ──
  cdp: async ({ tabId, method, params }) => {
    const target = tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
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
    const tab = await chrome.tabs.create({ url: url || 'about:blank', active: true });
    const group = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(group, { title: 'xb-task-' + (name || 'default'), color: 'green' });
    return { tabId: tab.id, groupId: group };
  },
  'task-close': async ({ name }) => {
    const groups = await chrome.tabGroups.query({});
    const targets = name
      ? groups.filter((g) => g.title === 'xb-task-' + name)
      : groups.filter((g) => g.title.startsWith('xb-task-'));
    let closed = 0;
    for (const g of targets) {
      const tabs = await chrome.tabs.query({ groupId: g.id });
      for (const t of tabs) await chrome.tabs.remove(t.id).catch(() => {});
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

  evaluate: async ({ expression, tabId }) => {
    // S105：chrome.scripting（含 world MAIN）的注入都受 CSP 约束（eval 被拦）。
    // chrome.debugger 走 CDP Runtime.evaluate —— DevTools console 同源能力，
    // 不受页面/扩展 CSP 限制。attach 时浏览器顶部出现"正在调试"横幅（用户可见）。
    const target = tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    return new Promise((resolve) => {
      const dbg = { tabId: target };
      const finish = (r) => {
        chrome.debugger.detach(dbg).catch(() => {});
        if (r?.exceptionDetails) {
          resolve({ ok: false, error: r.exceptionDetails.exception?.description || r.exceptionDetails.text });
        } else {
          let v = r?.result?.value;
          if (v === undefined) v = null;
          else if (typeof v === 'object') { try { v = JSON.parse(JSON.stringify(v)); } catch {} }
          resolve({ ok: true, value: v });
        }
      };
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

  uploadFile: async ({ filePathB64, fileName, selector, tabId }) => {
    // S113：页面级 DataTransfer 注入被 React 清零（files 赋值立即归零）。
    // chrome.debugger DOM.setFileInputFiles 是原生级（等价手动选文件）。
    // 限制：CDP 的 setFileInputFiles 只接受 file:// 真实路径 —— 先把
    // base64 落到扩展可写的临时位置不可行（SW 无 fs），改走两步：
    // 1) navigate 到 file:// 中转页不行 —— 直接用 sendCommand 前把文件
    //    写入由 CLI 侧先放置的固定路径（CLI 负责写盘）。
    const target = tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
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
    const target = tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    return new Promise((resolve) => {
      const dbg = { tabId: target };
      // 先 detach（可能残留）再 attach —— 残留 attach 会让新 attach 静默失败
      chrome.debugger.detach(dbg).catch(() => {}).finally(() => {
      chrome.debugger.attach(dbg, '1.3', () => {
        const err = chrome.runtime.lastError;
        if (err) { resolve({ ok: false, error: err.message }); return; }
        chrome.debugger.sendCommand(dbg, 'Input.dispatchMouseEvent',
          { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, () => {
            chrome.debugger.sendCommand(dbg, 'Input.dispatchMouseEvent',
              { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, () => {
                chrome.debugger.detach(dbg).catch(() => {});
                resolve({ ok: true, clicked: x + ',' + y });
              });
          });
      });
      });
    });
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
