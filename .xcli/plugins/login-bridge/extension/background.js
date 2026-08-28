/**
 * xbrowser Login Bridge — background worker
 *
 * 导出：抓取指定站点（或全部）的 cookie + localStorage，经本机 bridge 服务
 * 推给 xbrowser（POST http://127.0.0.1:9355/cookies）。
 * 导入：从 bridge 拉 cookie 列表写入浏览器（用于反向同步）。
 */

const BRIDGE = 'http://127.0.0.1:9355';

async function exportCookies(domainFilter) {
  const all = await chrome.cookies.getAll(domainFilter ? { domain: domainFilter } : {});
  // 只要有意义的：名字非空 + host 少量敏感过滤（__Host- 保留，它们是关键登录态）
  return all.map((c) => ({
    domain: c.domain,
    name: c.name,
    value: c.value,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite === 'unspecified' ? 'unspecified' : c.sameSite,
    expirationDate: c.expirationDate,
    hostOnly: c.hostOnly,
    storeId: c.storeId,
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
  } catch {
    return [];
  }
}

async function pushToBridge(payload) {
  const resp = await fetch(`${BRIDGE}/cookies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
        name: c.name,
        value: c.value,
        path: c.path || '/',
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
      };
      if (!c.hostOnly && c.domain && c.domain.startsWith('.')) details.domain = c.domain;
      if (c.expirationDate) details.expirationDate = c.expirationDate;
      if (c.sameSite && c.sameSite !== 'unspecified') details.sameSite = c.sameSite;
      await chrome.cookies.set(details);
      ok++;
    } catch {
      fail++;
    }
  }
  return { ok, fail };
}

// ── Message router (popup → worker) ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'export') {
        const cookies = await exportCookies(msg.domain);
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const local = await exportLocalStorage(tab, msg.domain);
        const result = await pushToBridge({ source: 'chrome', domain: msg.domain || '*', cookies, localStorage: local, at: Date.now() });
        sendResponse({ ok: true, cookies: cookies.length, localStorage: local.length, result });
      } else if (msg.type === 'import') {
        const data = await pullFromBridge(msg.domain);
        const r = await importCookies(data.cookies || []);
        sendResponse({ ok: true, ...r });
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
  return true; // async sendResponse
});
