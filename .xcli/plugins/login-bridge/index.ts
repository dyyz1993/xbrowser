import { z } from 'zod/v4';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { createServer, type Server } from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * login-bridge — Chrome ↔ xbrowser 登录态双向通道
 *
 * 组成：
 *  1. Bridge HTTP 服务（127.0.0.1:9355）：Chrome 插件 POST cookie 到这里，
 *     xbrowser 命令从这里拉取并注入自动化浏览器
 *  2. `login-sync serve`    启动 bridge（常驻，随 daemon 自动起）
 *  3. `login-sync save`     从 bridge 拉取 → 存到插件 storage（按域名归档）
 *  4. `login-sync apply`    把归档的 cookie 注入当前会话页面
 *  5. `login-sync launch`   用固定 profile 启动 Chromium（登录态持久化）
 *
 * 配套 Chrome 插件：extension/（chrome://extensions 加载已解压）
 */

const BRIDGE_PORT = 9355;
const PROFILE_DIR = join(homedir(), '.xbrowser', 'chrome-profile');

interface CookieItem {
  domain: string; name: string; value: string; path?: string;
  secure?: boolean; httpOnly?: boolean; sameSite?: string;
  expirationDate?: number; hostOnly?: boolean;
}

/** In-memory cookie store served by the bridge (also persisted to disk). */
const bridgeStoreFile = join(homedir(), '.xbrowser', 'login-bridge-store.json');

function loadStore(): Record<string, { cookies: CookieItem[]; localStorage: unknown[]; at: number }> {
  try { return JSON.parse(readFileSync(bridgeStoreFile, 'utf8')); } catch { return {}; }
}
function saveStore(store: Record<string, { cookies: CookieItem[]; localStorage: unknown[]; at: number }>): void {
  mkdirSync(join(homedir(), '.xbrowser'), { recursive: true });
  writeFileSync(bridgeStoreFile, JSON.stringify(store, null, 1));
}

let bridgeServer: Server | null = null;

/** Spawn a detached resident bridge process (survives CLI exit). */
function spawnResidentBridge(): void {
  const { spawn } = require('child_process') as typeof import('child_process');
  const script = `
    const { createServer } = require('http');
    const { readFileSync, writeFileSync, mkdirSync } = require('fs');
    const { join } = require('path');
    const STORE = ${JSON.stringify(bridgeStoreFile)};
    const loadStore = () => { try { return JSON.parse(readFileSync(STORE, 'utf8')); } catch { return {}; } };
    const saveStore = (s) => { mkdirSync(require('path').dirname(STORE), { recursive: true }); writeFileSync(STORE, JSON.stringify(s)); };
    createServer((req, res) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
      if (req.method === 'POST' && req.url === '/cookies') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 20e6) req.destroy(); });
        req.on('end', () => {
          try {
            const p = JSON.parse(body);
            const store = loadStore();
            store[p.domain || '*'] = { cookies: p.cookies || [], localStorage: p.localStorage || [], at: Date.now() };
            saveStore(store);
            res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, stored: (p.cookies || []).length }));
          } catch (e) { res.writeHead(400, cors); res.end(JSON.stringify({ ok: false, error: String(e) })); }
        });
        return;
      }
      if (req.method === 'GET' && (req.url || '').startsWith('/cookies')) {
        const q = new URL(req.url, 'http://x').searchParams.get('domain') || '';
        const store = loadStore();
        const all = Object.entries(store).filter(([k]) => !q || k === q || k === '*').flatMap(([, v]) => v.cookies);
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ cookies: all }));
        return;
      }
      res.writeHead(404, cors); res.end();
    }).listen(${BRIDGE_PORT}, '127.0.0.1');
  `;
  const tmp = join(bridgeStoreFile, '..', 'login-bridge-server.cjs');
  writeFileSync(tmp, script);
  const child = spawn(process.execPath, [tmp], { detached: true, stdio: 'ignore' });
  child.unref();
}

function startBridge(): Promise<void> {
  if (bridgeServer) return Promise.resolve();
  return new Promise((resolve, reject) => {
    bridgeServer = createServer((req, res) => {
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

      if (req.method === 'POST' && req.url === '/cookies') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 20e6) req.destroy(); });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body) as { domain?: string; cookies: CookieItem[]; localStorage?: unknown[] };
            const store = loadStore();
            store[payload.domain || '*'] = { cookies: payload.cookies || [], localStorage: payload.localStorage || [], at: Date.now() };
            saveStore(store);
            res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, stored: (payload.cookies || []).length }));
          } catch (e) {
            res.writeHead(400, cors); res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        });
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/cookies')) {
        const q = new URL(req.url, 'http://x').searchParams.get('domain') || '';
        const store = loadStore();
        const all = Object.entries(store)
          .filter(([k]) => !q || k === q || k === '*')
          .flatMap(([, v]) => v.cookies);
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ cookies: all }));
        return;
      }

      res.writeHead(404, cors); res.end();
    });
    bridgeServer.listen(BRIDGE_PORT, '127.0.0.1', () => resolve());
    bridgeServer.on('error', reject);
  });
}

function cookieDomainMatches(cookieDomain: string, site: string): boolean {
  const d = cookieDomain.replace(/^\./, '').toLowerCase();
  return d === site.toLowerCase() || d.endsWith('.' + site.toLowerCase());
}

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'login-bridge',
    url: 'http://local.bridge',
    description: 'Chrome ↔ xbrowser 登录态双向同步（bridge 9355 + 固定 profile）',
    requiresLogin: false,
    isLogin: async () => true, // 本插件管理登录态本身，永远"已登录"
  });

  site.command('serve', {
    description: '启动 bridge HTTP 服务（9355，接收 Chrome 插件推送）',
    scope: 'project',
    loginRequired: 'none',
    parameters: z.object({}),
    handler: async () => {
      try {
        // Port already alive? (resident bridge from a previous serve)
        const alive = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/cookies`).then((r) => r.ok).catch(() => false);
        if (!alive) {
          const inDaemon = !!process.env.XBROWSER_DAEMON_WORKER;
          if (!inDaemon) {
            spawnResidentBridge();
            await new Promise((r) => setTimeout(r, 800));
          } else {
            await startBridge();
          }
        }
        const n = Object.values(loadStore()).reduce((s, v) => s + v.cookies.length, 0);
        return ok({ port: BRIDGE_PORT, storedCookies: n }, [
          `bridge 已就绪: http://127.0.0.1:${BRIDGE_PORT}（库存 ${n} 条 cookie）`,
          'Chrome 插件点「导出」即可推送登录态',
        ]);
      } catch (e) {
        return fail(`bridge 启动失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  });

  site.command('save', {
    description: '从 bridge 拉取最新登录态并归档到本地（.xbrowser/login-bridge-store.json 即档案）',
    scope: 'project',
    loginRequired: 'none',
    parameters: z.object({}),
    handler: async () => {
      const store = loadStore();
      const domains = Object.keys(store);
      const total = Object.values(store).reduce((s, v) => s + v.cookies.length, 0);
      return ok({ domains, total, at: store['*']?.at || null }, [
        total ? `库存 ${total} 条 cookie（${domains.join(', ')}）` : '库存为空 — 先在 Chrome 插件里点「导出」',
      ]);
    },
  });

  site.command('apply', {
    description: '把归档的 cookie 注入当前会话页面（--site 过滤域名）',
    scope: 'page',
    loginRequired: 'none',
    parameters: z.object({
      site: z.string().optional().describe('只注入匹配该域名的 cookie，如 xiaohongshu.com'),
    }),
    handler: async (p, ctx) => {
      const page = (ctx as Record<string, unknown>).page as
        | { _cdpSend?: (m: string, p?: unknown) => Promise<unknown> }
        | undefined;
      const store = loadStore();
      const all: CookieItem[] = Object.entries(store)
        .filter(([k]) => !p.site || k === p.site || k === '*')
        .flatMap(([, v]) => v.cookies);
      const matched = p.site ? all.filter((c) => cookieDomainMatches(c.domain, p.site!)) : all;
      if (!matched.length) return fail(`无匹配 cookie（site=${p.site || '*'}）— 先在 Chrome 插件里导出`);

      // 通过 CDP Storage.setCookies 注入（page._cdpSend；evaluate 无法设 httpOnly）
      const cdp = page?._cdpSend?.bind(page) as
        | ((m: string, p2?: unknown) => Promise<unknown>)
        | undefined;
      if (!cdp) return fail('需要 CDP 上下文（--cdp 或已启动的会话）');

      await cdp('Storage.setCookies', {
        cookies: matched.map((c) => ({
          name: c.name, value: c.value,
          domain: c.hostOnly ? c.domain.replace(/^\./, '') : (c.domain || undefined),
          path: c.path || '/',
          secure: !!c.secure, httpOnly: !!c.httpOnly,
          ...(c.expirationDate ? { expires: c.expirationDate } : {}),
          ...(c.sameSite && c.sameSite !== 'unspecified'
            ? { sameSite: c.sameSite === 'no_restriction' ? 'None' : c.sameSite === 'lax' ? 'Lax' : 'Strict' }
            : {}),
        })),
      }).catch((e: unknown) => ({ error: e }));

      return ok({ applied: matched.length, site: p.site || '*' }, [
        `已注入 ${matched.length} 条 cookie — 刷新页面即可生效`,
      ]);
    },
  });

  site.command('import-from-chrome', {
    description: '从 Google Chrome 导入登录态（需 Chrome 已完全退出——运行中密钥被轮换无法解密）',
    scope: 'project',
    loginRequired: 'none',
    parameters: z.object({
      site: z.string().describe('目标站点域名，如 juejin.cn'),
      profile: z.string().optional().describe('Chrome profile 名（默认 Default）'),
    }),
    handler: async (p) => {
      const { execSync } = await import('child_process');
      // 1. Chrome 必须完全退出（运行时密钥轮换，开着解不开）
      let chromeRunning = false;
      try { execSync('pgrep -x "Google Chrome"', { stdio: 'ignore' }); chromeRunning = true; } catch { /* not running */ }
      if (chromeRunning) {
        return fail('Google Chrome 正在运行 — 请先完全退出（Cmd+Q）再重试', [
          '原因：Chrome 运行时把 cookie 解密密钥轮换进内存，钥匙串条目是陈旧的',
          '退出后真实密钥会写回钥匙串，本命令即可解开（Codex 同款机制）',
        ]);
      }
      // 2. 拷贝 cookie 库（含 journal 合并的完整 backup）
      const chromeDb = join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', p.profile || 'Default', 'Cookies');
      if (!existsSync(chromeDb)) return fail(`找不到 Chrome cookie 库: ${chromeDb}`);
      const tmpDb = join(bridgeStoreFile, '..', 'chrome-import.db');
      execSync(`sqlite3 "${chromeDb}" ".backup ${tmpDb}"`);

      // 3. 钥匙串取 Chrome 密钥 → 解密
      const { decryptChromeCookies } = await import('./decrypt-chrome.js');
      const cookies = decryptChromeCookies(tmpDb, p.site);
      if (!cookies.length) return fail(`解出 0 条 cookie（site=${p.site}）— 该站点可能无登录态`);

      // 4. 存入 bridge 库存
      const store = loadStore();
      store[p.site] = { cookies, localStorage: [], at: Date.now() };
      saveStore(store);

      return ok({ imported: cookies.length, site: p.site }, [
        `已导入 ${cookies.length} 条 cookie（${p.site}）→ 用 login-bridge apply 注入浏览器`,
        '现在可以重新打开 Chrome 了',
      ]);
    },
  });

  site.command('launch', {
    description: '用固定 profile 启动 Chromium（登录态持久化在 ~/.xbrowser/chrome-profile）',
    scope: 'project',
    loginRequired: 'none',
    parameters: z.object({
      url: z.string().optional(),
      port: z.coerce.number().optional().describe('CDP 端口（默认 9333）'),
    }),
    handler: async (p) => {
      const port = p.port ?? 9333;
      const { spawn } = await import('child_process');
      const candidates = [
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ];
      const bin = candidates.find((c) => existsSync(c));
      if (!bin) return fail('未找到 Chromium/Chrome');
      mkdirSync(PROFILE_DIR, { recursive: true });
      const child = spawn(bin, [
        '--headless=new',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${PROFILE_DIR}`,
        '--no-first-run', '--window-size=1440,900',
        p.url || 'about:blank',
      ], { detached: true, stdio: 'ignore' });
      child.unref();
      await new Promise((r) => setTimeout(r, 2500));
      return ok({ pid: child.pid, port, profile: PROFILE_DIR }, [
        `Chromium 已启动（固定 profile，登录态持久）: --cdp http://localhost:${port}`,
      ]);
    },
  });
}
