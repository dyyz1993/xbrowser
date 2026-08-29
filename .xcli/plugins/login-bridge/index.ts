import { z } from 'zod/v4';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { createServer, type Server } from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
const __req = createRequire(import.meta.url);

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
        const all = Object.entries(store).filter(([k]) => !q || k === q || k === '*').flatMap(([, v]) => v.cookies || []);
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
          .flatMap(([, v]) => v.cookies || []);
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
    requiresLogin: false,
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
    requiresLogin: false,
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
    requiresLogin: false,
    parameters: z.object({
      site: z.string().optional().describe('只注入匹配该域名的 cookie，如 xiaohongshu.com'),
    }),
    handler: async (p, ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as
        | { _cdpSend?: (m: string, p?: unknown) => Promise<unknown> }
        | undefined;
      const store = loadStore();
      const all: CookieItem[] = Object.entries(store)
        .filter(([k]) => !p.site || k === p.site || k === '*')
        .flatMap(([, v]) => v.cookies || []);
      const matched = p.site ? all.filter((c: any) => cookieDomainMatches(String(c.domain), p.site!)) : all;
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
    description: '从 Google Chrome 导入登录态（Chrome 运行中即可，经 hack-browser-data 解密）',
    scope: 'project',
    requiresLogin: false,
    parameters: z.object({
      site: z.string().describe('目标站点域名，如 juejin.cn'),
    }),
    handler: async (p) => {
      const { execSync } = await import('child_process');
      const outDir = join(bridgeStoreFile, '..', 'hbd-out');

      // 主路径：hack-browser-data（brew 安装）——支持 macOS 新版 Chrome 运行时解密
      let cookies: Array<CookieItem> = [];
      let via = 'hack-browser-data';
      try {
        // daemon 的 PATH 不含 /opt/homebrew/bin —— 用绝对路径（找不到则回退 PATH 查找）
        // daemon 可能跑在受限可见度的环境 —— 依次探测已知安装位置
        const hbdCandidates = [
          '/opt/homebrew/bin/hack-browser-data',
          '/usr/local/bin/hack-browser-data',
          join(homedir(), '.brew', 'bin', 'hack-browser-data'),
        ];
        const hbdBin = hbdCandidates.find((p2) => existsSync(p2)) || 'hack-browser-data';
        console.error('[login-bridge] HOME=' + homedir() + ' hbdBin=' + hbdBin + ' candidates=' + JSON.stringify(hbdCandidates.map(p2 => existsSync(p2))));
        execSync(`cd /tmp && ${hbdBin} dump -b chrome -c cookie -f json -d "${outDir}"`,
          { stdio: 'pipe', timeout: 120_000 });
        const raw = JSON.parse(readFileSync(join(outDir, 'cookie.json'), 'utf8'));
        const arr: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : Object.values(raw).flat() as Array<Record<string, unknown>>;
        // hack-browserData 导出字段：host/is_secure/is_http_only/expire_at(ISO)，
        // 首次接入时误按 Playwright 风格（hostname/secure/expires）映射 → 全部丢空，
        // __Secure- 前缀 cookie 因 secure:false 被 CDP 拒写（YouTube 登录失败的根因）
        cookies = arr
          .filter((c) => String(c.host ?? c.hostname ?? '').includes(p.site.replace(/^\./, '')))
          .map((c) => ({
            domain: String(c.host ?? ''),
            name: String(c.name),
            value: String(c.value ?? ''),
            path: String(c.path || '/'),
            secure: !!c.is_secure,
            httpOnly: !!c.is_http_only,
            expirationDate: c.expire_at ? Math.floor(new Date(String(c.expire_at)).getTime() / 1000) : undefined,
            sameSite: 'unspecified',
          }));
      } catch (e) {
        console.error('[login-bridge] hbd path error:', String(e).substring(0, 200));
      }

      // Fallback：Chrome 完全退出后走钥匙串解密（decrypt-chrome.ts）
      if (!cookies.length) {
        let chromeRunning = false;
        try { execSync('pgrep -x "Google Chrome"', { stdio: 'ignore' }); chromeRunning = true; } catch { /* not running */ }
        if (chromeRunning) {
          return fail(`hack-browser-data 解出 0 条（site=${p.site}）且 Chrome 运行中无法走备用解密`, [
            via === 'hack-browser-data' ? '检查该站点是否真的在 Chrome 里登录过' : 'brew install hack-browser-data 后重试',
            '或完全退出 Chrome（Cmd+Q）后再试（会走钥匙串解密 fallback）',
          ]);
        }
        const chromeDb = join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cookies');
        if (!existsSync(chromeDb)) return fail(`找不到 Chrome cookie 库: ${chromeDb}`);
        const tmpDb = join(bridgeStoreFile, '..', 'chrome-import.db');
        execSync(`sqlite3 "${chromeDb}" ".backup ${tmpDb}"`);
        const { decryptChromeCookies } = await import('./decrypt-chrome.js');
        cookies = decryptChromeCookies(tmpDb, p.site) as unknown as CookieItem[];
        via = 'keychain-decrypt';
      }

      if (!cookies.length) return fail(`解出 0 条 cookie（site=${p.site}）— 该站点可能无登录态`);

      const store = loadStore();
      store[p.site] = { cookies, localStorage: [], at: Date.now() };
      // 记录用户 Chrome 的 UA（从 cookie 库同目录的 Local State 无法直接拿，
      // 用 cookie 库 mtime + hbd 的 browser 字段确认是 Chrome；UA 版本从
      // Chrome 主程序 Info.plist 读，失败则用空 = 不固化）
      try {
        const uaOut = execSync(
          `defaults read "/Applications/Google Chrome.app/Contents/Info" CFBundleShortVersionString 2>/dev/null`,
          { encoding: 'utf8' }).trim();
        console.error('[login-bridge] UA probe raw:', JSON.stringify(uaOut.substring(0,20)));
        if (/^\d+\./.test(uaOut)) {
          const ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${uaOut.split('.')[0]}.0.0.0 Safari/537.36`;
          writeFileSync(join(homedir(), '.xbrowser', 'login-bridge-ua.txt'), ua);
        }
      } catch (e2) { console.error('[login-bridge] UA probe fail:', String(e2).substring(0,120)); }
      saveStore(store);

      return ok({ imported: cookies.length, site: p.site, via }, [
        `已导入 ${cookies.length} 条 cookie（${p.site}，via ${via}）`,
        `注入: xbrowser login-bridge apply --site ${p.site} --cdp <endpoint> --session <sess>`,
      ]);
    },
  });

  site.command('launch', {
    description: '用固定 profile 启动 Chromium（登录态持久化在 ~/.xbrowser/chrome-profile）',
    scope: 'project',
    requiresLogin: false,
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
      // UA 固化（R45 攻防产出）：导入的 cookie 属于用户 Chrome 的 UA 环境，
      // Chromium 自动化必须以相同 UA 运行——否则站点看到 session 的 UA 突变，
      // 触发设备绑定风控（豆包案例：首次成功后重启失效）。
      const uaFile = join(homedir(), '.xbrowser', 'login-bridge-ua.txt');
      const importUA = existsSync(uaFile) ? readFileSync(uaFile, 'utf8').trim() : null;
      const uaFlag = importUA ? `--user-agent=${importUA}` : '';
      const child = spawn(bin, [
        '--headless=new',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${PROFILE_DIR}`,
        uaFlag,
        '--no-first-run', '--window-size=1440,900',
        p.url || 'about:blank',
      ].filter(Boolean), { detached: true, stdio: 'ignore' });
      child.unref();
      await new Promise((r) => setTimeout(r, 2500));
      // 初始化后设置 color-gamut p3（Mac 广色域特征 —— headless 默认 srgb 是指纹差异）
      try {
        const ver = await fetch(`http://localhost:${port}/json/version`).then(r => r.ok).catch(() => false);
        if (ver) {
          const { WebSocket: WS } = await import(pathToFileURL(__req.resolve('ws', { paths: [process.cwd() + '/node_modules'] })).href);
          const targets = await fetch(`http://localhost:${port}/json`).then(r => r.json());
          const pg = targets.find((t: { type: string }) => t.type === 'page');
          if (pg) {
            const ws = new WS(pg.webSocketDebuggerUrl);
            await new Promise((r2) => ws.on('open', r2));
            ws.send(JSON.stringify({ id: 1, method: 'Emulation.setEmulatedMedia', params: { features: [{ name: 'color-gamut', value: 'p3' }] } }));
            setTimeout(() => ws.close(), 1000);
          }
        }
      } catch { /* best-effort — 启动不受影响 */ }
      return ok({ pid: child.pid, port, profile: PROFILE_DIR }, [
        `Chromium 已启动（固定 profile，登录态持久）: --cdp http://localhost:${port}`,
      ]);
    },
  });
}
