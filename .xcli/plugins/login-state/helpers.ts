/**
 * login-state 插件 — 离线提取本机 Chromium 系浏览器的登录态（Cookies）。
 *
 * 与 chrome-bridge（在线控制用户浏览器）互补的第三条登录态通道：
 * 直接无锁快照 profile 里的 SQLite Cookies 库（含 -wal/-shm 边车），
 * 经 macOS Keychain 取 "Chrome Safe Storage" 密钥派生 AES-128-CBC 解密，
 * 输出标准 Playwright storageState JSON（0600 原子写）。
 *
 * 解密格式参考 wasabihu/sessfork（MIT）：
 * - v10/v11 envelope + AES-128-CBC(key, IV=16×0x20) + PKCS7
 * - Chrome 130+（cookie DB meta.version >= 24）明文带 32 字节 SHA256(host_key) 前缀
 */
import { execFile } from 'node:child_process';
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { chmodSync, closeSync, copyFileSync, existsSync, fchmodSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class LoginStateError extends Error {}

// ─── Chromium 常量 ───
const AES_BLOCK = 16;
const CHROMIUM_IV = Buffer.alloc(AES_BLOCK, 0x20); // 16 个空格，Chromium OSCrypt 规范
const CHROMIUM_SALT = 'saltysalt';
const MACOS_ITERATIONS = 1003;
const CHROMIUM_EPOCH_DELTA_SECONDS = 11644473600; // 1601-01-01 → 1970-01-01

const BROWSER_KEYCHAIN: Record<string, { service: string; account: string }> = {
  chrome: { service: 'Chrome Safe Storage', account: 'Chrome' },
  canary: { service: 'Chrome Safe Storage', account: 'Chrome Canary' },
  brave: { service: 'Brave Safe Storage', account: 'Brave' },
  edge: { service: 'Microsoft Edge Safe Storage', account: 'Microsoft Edge' },
  arc: { service: 'Arc Safe Storage', account: 'Arc' },
};

// 最小权限：拒绝把这些"公共后缀/多租户平台域"当过滤器（会一次性带走全平台租户的会话）
const UNSAFE_PUBLIC_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.au', 'net.au', 'org.au',
  'co.jp', 'ne.jp', 'or.jp',
  'co.kr', 'com.br', 'com.hk', 'com.tw', 'com.sg', 'co.in',
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app',
  'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
  'herokuapp.com', 'onrender.com', 'fly.dev', 'railway.app',
]);

const VALID_HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

// ─── 域名过滤 ───

export function normalizeDomainFilter(raw: string): string {
  const text = raw.trim();
  if (!text) throw new LoginStateError('域名为空');
  let host: string;
  if (text.includes('://')) {
    try {
      const parsed = new URL(text);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('bad scheme');
      }
      host = parsed.hostname.replace(/^\.+/, '').toLowerCase();
    } catch {
      throw new LoginStateError(`非法 URL 过滤器：${raw}`);
    }
  } else {
    if (/[ \t\r\n;|&$`'"\\<>]/.test(text)) {
      throw new LoginStateError(`域名含非法字符：${raw}`);
    }
    host = text.split('/')[0].split(':')[0].replace(/^\.+/, '').toLowerCase();
  }
  if (host === 'localhost') return host;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host; // IPv4
  if (!VALID_HOSTNAME_RE.test(host) || UNSAFE_PUBLIC_SUFFIXES.has(host)) {
    throw new LoginStateError(`拒绝不安全或非法的域名过滤器 ${raw}（请给具体域，如 github.com）`);
  }
  return host;
}

export function domainMatches(hostKey: string, filters: string[]): boolean {
  if (filters.length === 0) return true;
  const clean = hostKey.replace(/^\.+/, '').toLowerCase();
  return filters.some(f => clean === f || clean.endsWith(`.${f}`));
}

// ─── 解密 ───

export function deriveAesKey(password: string): Buffer {
  return pbkdf2Sync(password, CHROMIUM_SALT, MACOS_ITERATIONS, AES_BLOCK, 'sha1');
}

export function stripPkcs7(data: Buffer): Buffer {
  if (data.length === 0 || data.length % AES_BLOCK !== 0) {
    throw new LoginStateError('解密块长度非法');
  }
  const pad = data[data.length - 1];
  if (pad < 1 || pad > AES_BLOCK) throw new LoginStateError('PKCS7 填充非法（多半密钥不对）');
  for (let i = data.length - pad; i < data.length; i++) {
    if (data[i] !== pad) throw new LoginStateError('PKCS7 填充序列损坏');
  }
  return data.subarray(0, data.length - pad);
}

/**
 * 解密一条 Chromium cookie。
 * 返回 null = 解不开（错 key / 非 v10 envelope）；空串 = 原本就是空值。
 */
export function decryptCookieValue(
  encryptedValue: Buffer,
  key: Buffer,
  hostKey: string,
  dbV24: boolean,
): string | null {
  if (encryptedValue.length === 0) return '';
  if (encryptedValue.subarray(0, 3).toString('latin1') !== 'v10'
    && encryptedValue.subarray(0, 3).toString('latin1') !== 'v11') {
    return null;
  }
  const payload = encryptedValue.subarray(3);
  if (payload.length === 0) return '';
  const decipher = createDecipheriv('aes-128-cbc', key, CHROMIUM_IV);
  decipher.setAutoPadding(false);
  let raw: Buffer;
  try {
    raw = Buffer.concat([decipher.update(payload), decipher.final()]);
    raw = stripPkcs7(raw);
  } catch {
    return null;
  }
  // Chrome 130+（DB v24+）：明文前缀 32 字节 SHA256(host_key)；老库仅在摘要命中时剥
  if (raw.length >= 32) {
    const hostDigest = createHash('sha256').update(Buffer.from(hostKey, 'utf8')).digest();
    if (dbV24 || raw.subarray(0, 32).equals(hostDigest)) {
      raw = raw.subarray(32);
    }
  }
  return raw.toString('utf8');
}

// ─── Keychain ───

export async function readKeychainPassword(browser: string): Promise<string> {
  if (process.platform !== 'darwin') {
    throw new LoginStateError('当前仅支持 macOS（Linux 走 secret-tool 在路线图上；Windows DPAPI 不支持）');
  }
  const conf = BROWSER_KEYCHAIN[browser];
  if (!conf) throw new LoginStateError(`不支持的浏览器：${browser}`);
  // 先探元数据（不弹窗），条目不存在时避免空跑 -w 触发授权框
  try {
    await execFileAsync('/usr/bin/security', ['find-generic-password', '-s', conf.service, '-a', conf.account], { timeout: 5000 });
  } catch {
    throw new LoginStateError(`Keychain 中没有 ${conf.service}/${conf.account}（该浏览器在本机没用过？）`);
  }
  const { stdout } = await execFileAsync(
    '/usr/bin/security',
    ['find-generic-password', '-w', '-s', conf.service, '-a', conf.account],
    { timeout: 120_000 }, // 用户需要时间点【允许】
  );
  const pw = stdout.trim();
  if (!pw) throw new LoginStateError('Keychain 返回空密钥（用户拒绝授权？）');
  return pw;
}

// ─── profile 定位与无锁快照 ───

function browserBaseDirs(browser: string, home: string): string[] {
  const appSupport = join(home, 'Library', 'Application Support');
  const mapping: Record<string, string[]> = {
    chrome: [join(appSupport, 'Google', 'Chrome')],
    canary: [join(appSupport, 'Google', 'Chrome Canary')],
    brave: [join(appSupport, 'BraveSoftware', 'Brave-Browser')],
    edge: [join(appSupport, 'Microsoft Edge')],
    arc: [join(appSupport, 'Arc', 'User Data')],
  };
  return mapping[browser] ?? [];
}

function assertNotSymlink(p: string): void {
  const st = lstatSync(p);
  if (st.isSymbolicLink()) throw new LoginStateError(`拒绝读取符号链接路径：${p}`);
}

export function resolveCookieDb(browser: string, profile?: string, dbPath?: string): string {
  if (dbPath) {
    const expanded = resolve(dbPath.replace(/^~/, homedir()));
    if (!existsSync(expanded)) throw new LoginStateError(`Cookies 库不存在：${expanded}`);
    assertNotSymlink(expanded);
    return expanded;
  }
  const bases = browserBaseDirs(browser, homedir()).filter(d => existsSync(d));
  if (bases.length === 0) throw new LoginStateError(`找不到 ${browser} 的用户数据目录`);
  const candidates: string[] = [];
  for (const base of bases) {
    const profiles = profile
      ? [join(base, profile)]
      : [join(base, 'Default'), ...readdirSync(base).filter(n => /^Profile /.test(n)).sort().map(n => join(base, n))];
    for (const pdir of profiles) {
      for (const cand of [join(pdir, 'Cookies'), join(pdir, 'Network', 'Cookies')]) {
        if (existsSync(cand)) {
          assertNotSymlink(cand);
          candidates.push(cand);
        }
      }
    }
  }
  if (candidates.length === 0) {
    throw new LoginStateError(`没有找到 Cookies 库${profile ? `（profile=${profile}）` : ''}`);
  }
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs); // 取最近活跃的
  return candidates[0];
}

/** 拷贝 Cookies + -wal/-shm 到 0700 临时目录（Chrome 运行中最新 cookie 可能还在 WAL 未落盘）。 */
export function snapshotDatabase(dbPath: string): { tmpDb: string; cleanup: () => void } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'xb-loginstate-'));
  chmodSync(tmpDir, 0o700);
  const tmpDb = join(tmpDir, 'Cookies');
  copyFileSync(dbPath, tmpDb);
  for (const suffix of ['-wal', '-shm']) {
    const side = `${dbPath}${suffix}`;
    if (existsSync(side)) copyFileSync(side, `${tmpDb}${suffix}`);
  }
  return {
    tmpDb,
    cleanup: () => {
      for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
        try { unlinkSync(f); } catch { /* best-effort */ }
      }
      try { unlinkSync(tmpDir); } catch { /* best-effort */ }
    },
  };
}

// ─── SQLite 读取（node:sqlite，Node >= 22.5）───

export interface CookieRow {
  host_key: string;
  name: string;
  value: string;
  encrypted_value: Uint8Array | Buffer | null;
  path: string;
  expires_utc: number | null;
  is_secure: number | null;
  is_httponly: number | null;
  has_expires: number | null;
  samesite: number | null;
}

interface SqliteDatabase {
  prepare: (sql: string) => { all: (...args: unknown[]) => unknown[]; get: (...args: unknown[]) => unknown };
  close: () => void;
}

export async function readCookieRows(tmpDb: string): Promise<{ rows: CookieRow[]; dbVersion: number }> {
  let sqlite: { DatabaseSync: new (path: string) => SqliteDatabase };
  try {
    sqlite = await import('node:sqlite');
  } catch {
    throw new LoginStateError('需要 Node >= 22.5（node:sqlite）才能读取 Cookies 库；请升级 Node 后重试');
  }
  const db = new sqlite.DatabaseSync(tmpDb);
  try {
    let dbVersion = 24;
    try {
      const meta = db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value?: string | number } | undefined;
      if (meta && meta.value !== undefined && meta.value !== null) dbVersion = Number(meta.value);
    } catch { /* meta 表缺失按 v24 处理 */ }
    const rawRows = db.prepare(
      'SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, has_expires, samesite FROM cookies',
    ).all() as unknown as CookieRow[];
    return { rows: rawRows, dbVersion };
  } finally {
    db.close();
  }
}

// ─── storageState 组装 ───

export interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export function convertExpires(expiresUtc: number | null, hasExpires: number | null): number {
  if (!hasExpires || !expiresUtc || expiresUtc <= 0) return -1;
  const unix = expiresUtc / 1_000_000 - CHROMIUM_EPOCH_DELTA_SECONDS;
  return unix > 0 ? Math.round(unix * 1000) / 1000 : -1;
}

export function convertSameSite(raw: number | null, secure: boolean): 'Strict' | 'Lax' | 'None' {
  if (raw === 2) return 'Strict';
  if (raw === 0) return secure ? 'None' : 'Lax';
  return 'Lax';
}

export interface DecryptOutcome {
  cookies: PlaywrightCookie[];
  failed: string[];
}

export function buildCookies(
  rows: CookieRow[],
  key: Buffer,
  dbV24: boolean,
  filters: string[],
  includeExpired: boolean,
): DecryptOutcome {
  const now = Date.now() / 1000;
  const cookies: PlaywrightCookie[] = [];
  const failed: string[] = [];
  for (const row of rows) {
    if (!domainMatches(row.host_key, filters)) continue; // 最小权限：不匹配的行不进入解密
    const expires = convertExpires(row.expires_utc, row.has_expires);
    if (!includeExpired && expires !== -1 && expires <= now) continue;
    const plain = row.value && row.value.length > 0
      ? row.value
      : row.encrypted_value
        ? decryptCookieValue(Buffer.from(row.encrypted_value as Uint8Array), key, row.host_key, dbV24)
        : '';
    if (plain === null) {
      failed.push(`${row.host_key}/${row.name}`);
      continue;
    }
    const secure = Boolean(row.is_secure);
    cookies.push({
      name: row.name,
      value: plain,
      domain: row.host_key,
      path: row.path || '/',
      expires,
      httpOnly: Boolean(row.is_httponly),
      secure,
      sameSite: convertSameSite(row.samesite, secure),
    });
  }
  return { cookies, failed };
}

function cookieIdentity(c: PlaywrightCookie): string {
  return `${c.domain}|${c.path}|${c.name}`;
}

/** 合并语义：新 cookie upsert，旧 cookie 未过期的保留（refresh 时整体替换）。 */
export function mergeCookies(existing: PlaywrightCookie[], incoming: PlaywrightCookie[], refresh: boolean): PlaywrightCookie[] {
  const now = Date.now() / 1000;
  const merged = new Map<string, PlaywrightCookie>();
  if (!refresh) {
    for (const c of existing) {
      if (c.expires !== -1 && c.expires <= now) continue; // 顺手清过期
      merged.set(cookieIdentity(c), c);
    }
  }
  for (const c of incoming) merged.set(cookieIdentity(c), c);
  return [...merged.values()].sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : a.name < b.name ? -1 : 1));
}

// ─── 0600 原子写 ───

export function writeStateAtomic(targetPath: string, payload: string): void {
  const resolved = resolve(targetPath);
  mkdirSync(dirname(resolved), { recursive: true });
  try { chmodSync(dirname(resolved), 0o700); } catch { /* 已存在目录可能非本人所有，best-effort */ }
  const tmpPath = join(dirname(resolved), `.state_${process.pid}_${Date.now()}.tmp`);
  const fd = openSync(tmpPath, 'w');
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, payload);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, resolved);
}

export function loadExistingState(path: string): PlaywrightCookie[] {
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as { cookies?: unknown };
    return Array.isArray(data.cookies) ? data.cookies as PlaywrightCookie[] : [];
  } catch {
    return [];
  }
}

// ─── 编排 ───

export interface ExportParams {
  domains: string; // CSV
  browser?: string;
  profile?: string;
  dbPath?: string;
  output?: string;
  refresh?: boolean;
}

export interface ExportResult {
  saved: string;
  cookieCount: number;
  failedCount: number;
  domains: string[];
  profile: string;
  browser: string;
}

export function defaultStatePath(): string {
  return join(homedir(), '.xbrowser', 'login-state', 'state.json');
}

export function resolveStatePath(statePath?: string): string {
  return resolve((statePath ?? defaultStatePath()).replace(/^~/, homedir()));
}

/** 读 state 文件里的 cookies（run 命令用）；文件缺失/损坏返回空数组由调用方引导。 */
export function loadStateCookies(statePath: string): PlaywrightCookie[] {
  return loadExistingState(statePath);
}

export async function exportLoginState(params: ExportParams): Promise<ExportResult> {
  const filters = params.domains.split(',').map(s => s.trim()).filter(Boolean).map(normalizeDomainFilter);
  if (filters.length === 0) throw new LoginStateError('缺少域名：--domains github.com[,linear.app]');
  const browser = params.browser ?? 'chrome';
  const sourceDb = resolveCookieDb(browser, params.profile, params.dbPath);
  // profile 名从库路径反推（Default / Profile N）
  const profile = /\/(Default|Profile [^/]+)\/(Network\/)?Cookies$/.exec(sourceDb)?.[1] ?? 'Default';

  const snap = snapshotDatabase(sourceDb);
  let outcome: DecryptOutcome;
  let failedCount = 0;
  try {
    const { rows, dbVersion } = await readCookieRows(snap.tmpDb);
    const needsKey = rows.some(r => !r.value && r.encrypted_value && r.encrypted_value.length > 0);
    const key = needsKey ? deriveAesKey(await readKeychainPassword(browser)) : Buffer.alloc(0);
    outcome = buildCookies(rows, key, dbVersion >= 24, filters, false);
    failedCount = outcome.failed.length;
  } finally {
    snap.cleanup();
  }

  const target = resolve((params.output ?? defaultStatePath()).replace(/^~/, homedir()));
  const existing = params.refresh ? [] : loadExistingState(target);
  const merged = mergeCookies(existing, outcome.cookies, Boolean(params.refresh));
  const state = { cookies: merged, origins: [] };
  writeStateAtomic(target, `${JSON.stringify(state, null, 2)}\n`);
  return {
    saved: target,
    cookieCount: merged.length,
    failedCount,
    domains: filters,
    profile,
    browser,
  };
}
