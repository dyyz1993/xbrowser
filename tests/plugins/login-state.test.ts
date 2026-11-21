import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createCipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { readFileSync, mkdtempSync, symlinkSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import plugin from '../../.xcli/plugins/login-state/index.ts';
import {
  convertExpires,
  convertSameSite,
  decryptCookieValue,
  deriveAesKey,
  domainMatches,
  exportLoginState,
  LoginStateError,
  mergeCookies,
  normalizeDomainFilter,
  readKeychainPassword,
  resolveCookieDb,
  writeStateAtomic,
  type CookieRow,
  type PlaywrightCookie,
} from '../../.xcli/plugins/login-state/helpers.ts';

// ─── 合成加密向量：Keychain 密码 'keychain-pw' 派生的 key ───
const KEY = deriveAesKey('keychain-pw');

function encryptEnvelope(plain: Buffer, host: string, withDigest = true): Buffer {
  const body = withDigest
    ? Buffer.concat([createHash('sha256').update(host, 'utf8').digest(), plain])
    : plain;
  const pad = 16 - (body.length % 16);
  const padded = Buffer.concat([body, Buffer.alloc(pad, pad)]);
  const cipher = createCipheriv('aes-128-cbc', KEY, Buffer.alloc(16, 0x20));
  cipher.setAutoPadding(false);
  return Buffer.concat([Buffer.from('v10', 'latin1'), cipher.update(padded), cipher.final()]);
}

function futureExpiresUtc(): number {
  return (Date.now() / 1000 + 3600 + 11644473600) * 1_000_000;
}

function row(partial: Partial<CookieRow> & { host_key: string; name: string }): CookieRow {
  return {
    value: '',
    encrypted_value: null,
    path: '/',
    expires_utc: futureExpiresUtc(),
    is_secure: 0,
    is_httponly: 0,
    has_expires: 1,
    samesite: -1,
    ...partial,
  };
}

// ─── mock node:child_process / node:sqlite（vi.hoisted 供 hoisted 的工厂引用）───
const h = vi.hoisted(() => {
  return {
    rows: [] as unknown[],
    execFile: vi.fn((_cmd: string, args: string[], _opts: unknown, cb: unknown) => {
      const callback = cb as (e: Error | null, r?: { stdout?: string }) => void;
      if (args.includes('-w')) callback(null, { stdout: 'keychain-pw' });
      else callback(null, { stdout: '' });
    }),
  };
});

vi.mock('node:child_process', () => ({ execFile: h.execFile }));
vi.mock('node:sqlite', () => ({
  DatabaseSync: class {
    prepare(sql: string): { all: (...a: unknown[]) => unknown[]; get: (...a: unknown[]) => unknown } {
      if (sql.includes('meta')) {
        return { all: () => [], get: () => ({ value: '24' }) };
      }
      return { all: () => h.rows, get: () => undefined };
    }
    close(): void { /* noop */ }
  },
}));

// ─── 插件注册 ───

type Site = {
  command: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
};

function makeMock(): { site: Site; xcli: { createSite: ReturnType<typeof vi.fn> } } {
  const site: Site = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
  return { site, xcli: { createSite: vi.fn(() => site) } };
}

function getHandler(site: Site, name: string): (params: unknown) => Promise<unknown> {
  const call = site.command.mock.calls.find((item: unknown[]) => item[0] === name);
  if (!call) throw new Error(`Command not registered: ${name}`);
  return (call[1] as { handler: (params: unknown) => Promise<unknown> }).handler;
}

describe('login-state plugin registration', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('registers site with name login-state and single export command', () => {
    const { site, xcli } = makeMock();
    plugin(xcli as never);
    expect(xcli.createSite).toHaveBeenCalledWith(expect.objectContaining({ name: 'login-state', requiresLogin: false }));
    expect(site.command.mock.calls.map(c => c[0])).toEqual(['export']);
  });

  it('export command has full contract metadata incl result schema', () => {
    const { site, xcli } = makeMock();
    plugin(xcli as never);
    const cmd = site.command.mock.calls[0]![1] as Record<string, unknown>;
    expect(cmd.description).toBeTruthy();
    expect(cmd.scope).toBe('project');
    expect(cmd.loginRequired).toBe('none');
    expect(cmd.parameters).toBeTruthy();
    expect(cmd.result).toBeTruthy();
    expect(typeof cmd.handler).toBe('function');
  });
});

// ─── 解密纯函数 ───

describe('decryptCookieValue', () => {
  const host = '.example.com';

  it('v24 格式（digest 前缀）往返，含中文', () => {
    const ev = encryptEnvelope(Buffer.from('tok-中文走廊'), host);
    expect(decryptCookieValue(ev, KEY, host, true)).toBe('tok-中文走廊');
  });

  it('pre-v24 无前缀不误剥', () => {
    const ev = encryptEnvelope(Buffer.from('plain-value'), host, false);
    expect(decryptCookieValue(ev, KEY, host, false)).toBe('plain-value');
  });

  it('pre-v24 摘要命中时剥（向后兼容）', () => {
    const ev = encryptEnvelope(Buffer.from('v'), host, true);
    expect(decryptCookieValue(ev, KEY, host, false)).toBe('v');
  });

  it('错误密钥返回 null', () => {
    const ev = encryptEnvelope(Buffer.from('v'), host);
    expect(decryptCookieValue(ev, Buffer.alloc(16, 1), host, true)).toBeNull();
  });

  it('非 v10/v11 envelope 返回 null；空 envelope 返回空串', () => {
    expect(decryptCookieValue(Buffer.from('garbage!!'), KEY, host, true)).toBeNull();
    expect(decryptCookieValue(Buffer.from('v10'), KEY, host, true)).toBe('');
  });

  it('deriveAesKey 与 Python 参照实现一致（pbkdf2 sha1 1003 saltysalt）', () => {
    // 参照：hashlib.pbkdf2_hmac('sha1', b'pw', b'saltysalt', 1003, 16)
    const expected = pbkdf2Sync('pw', 'saltysalt', 1003, 16, 'sha1');
    expect(deriveAesKey('pw').equals(expected)).toBe(true);
  });
});

// ─── 域名过滤 ───

describe('normalizeDomainFilter', () => {
  it('接受普通域 / URL / localhost / IPv4', () => {
    expect(normalizeDomainFilter('github.com')).toBe('github.com');
    expect(normalizeDomainFilter('https://gist.github.com/foo')).toBe('gist.github.com');
    expect(normalizeDomainFilter('.weibo.com')).toBe('weibo.com');
    expect(normalizeDomainFilter('localhost')).toBe('localhost');
    expect(normalizeDomainFilter('192.168.1.1')).toBe('192.168.1.1');
  });

  it('拒绝公共后缀（多租户/多级 eTLD）', () => {
    for (const bad of ['github.io', 'vercel.app', 'co.uk', 'com.cn']) {
      expect(() => normalizeDomainFilter(bad)).toThrow(LoginStateError);
    }
  });

  it('拒绝非法字符与非 http(s) scheme', () => {
    expect(() => normalizeDomainFilter('a b.com')).toThrow(LoginStateError);
    expect(() => normalizeDomainFilter('a;rm')).toThrow(LoginStateError);
    expect(() => normalizeDomainFilter('file:///etc/passwd')).toThrow(LoginStateError);
  });
});

describe('domainMatches', () => {
  it('精确命中与子域后缀命中', () => {
    expect(domainMatches('.github.com', ['github.com'])).toBe(true);
    expect(domainMatches('gist.github.com', ['github.com'])).toBe(true);
    expect(domainMatches('notgithub.com', ['github.com'])).toBe(false);
    expect(domainMatches('a.b', [])).toBe(true); // 空过滤器全过（内部调用方始终传非空）
  });
});

// ─── 转换与合并 ───

describe('convert helpers', () => {
  it('expires：无过期 -1；微秒 → unix 秒', () => {
    expect(convertExpires(0, 0)).toBe(-1);
    expect(convertExpires(null, 1)).toBe(-1);
    const utc = (1700000000 + 11644473600) * 1_000_000;
    expect(convertExpires(utc, 1)).toBeCloseTo(1700000000, 2);
  });

  it('samesite 映射', () => {
    expect(convertSameSite(2, false)).toBe('Strict');
    expect(convertSameSite(0, true)).toBe('None');
    expect(convertSameSite(0, false)).toBe('Lax');
    expect(convertSameSite(-1, false)).toBe('Lax');
  });
});

describe('mergeCookies', () => {
  const c = (name: string, domain = '.a.com', expires = -1): PlaywrightCookie => ({
    name, value: `v-${name}`, domain, path: '/', expires, httpOnly: false, secure: false, sameSite: 'Lax',
  });

  it('upsert 同名替换、不同名保留、过期清除', () => {
    const existing = [c('x', '.a.com', 1000), c('y')]; // x 已过期
    const incoming = [c('x'), c('z')];
    const merged = mergeCookies(existing, incoming, false);
    expect(merged.map(m => m.name).sort()).toEqual(['x', 'y', 'z']);
    expect(merged.find(m => m.name === 'x')?.value).toBe('v-x');
  });

  it('refresh 时整体替换', () => {
    const merged = mergeCookies([c('old')], [c('new')], true);
    expect(merged.map(m => m.name)).toEqual(['new']);
  });
});

// ─── 原子写权限 ───

describe('writeStateAtomic', () => {
  it('写 0600 且内容完整', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xb-ls-test-'));
    const target = join(dir, 'state.json');
    writeStateAtomic(target, '{"cookies":[]}');
    expect((statSync(target).mode & 0o777)).toBe(0o600);
    expect(readFileSync(target, 'utf8')).toBe('{"cookies":[]}');
    unlinkSync(target);
  });
});

// ─── 安全守卫 ───

describe('security guards', () => {
  const realPlatform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
  });

  it('符号链接 Cookies 路径拒读', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xb-ls-sym-'));
    const real = join(dir, 'real.db');
    const link = join(dir, 'link.db');
    writeFileSync(real, 'x');
    symlinkSync(real, link);
    expect(() => resolveCookieDb('chrome', undefined, link)).toThrow(/符号链接/);
    unlinkSync(link);
    unlinkSync(real);
  });

  it('非 macOS 平台直接报错（不碰 Keychain）', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    await expect(readKeychainPassword('chrome')).rejects.toThrow(/仅支持 macOS/);
  });
});

// ─── 端到端（handler，mock sqlite + keychain）───

describe('export handler end-to-end', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.rows = [];
  });

  function handler() {
    const { site, xcli } = makeMock();
    plugin(xcli as never);
    return getHandler(site, 'export');
  }

  it('非法域名过滤器 → fail，且不触发 Keychain', async () => {
    const result = await handler()({ domains: 'github.io' });
    expect(JSON.stringify(result)).toContain('拒绝不安全');
    expect(h.execFile).not.toHaveBeenCalled();
  });

  it('happy path：解密 → storageState 落盘 0600 → 合并语义', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xb-ls-e2e-'));
    const fakeDb = join(dir, 'Cookies');
    writeFileSync(fakeDb, 'fake-sqlite-bytes');
    const out = join(dir, 'state.json');

    h.rows = [
      row({ host_key: '.example.com', name: 'sid', encrypted_value: encryptEnvelope(Buffer.from('tok-中文'), '.example.com'), is_secure: 1, is_httponly: 1, samesite: 2 }),
      row({ host_key: '.example.com', name: 'plain', value: 'pv' }),
      row({ host_key: '.other.org', name: 'sid', encrypted_value: encryptEnvelope(Buffer.from('should-not-decrypt'), '.other.org') }), // 域外：不得进入输出
    ];

    const result = (await handler()({
      domains: 'example.com',
      dbPath: fakeDb,
      output: out,
    })) as { success: boolean; data: { saved: string; cookieCount: number; profile: string } };

    expect(result.success).toBe(true);
    expect(result.data.cookieCount).toBe(2);
    expect(result.data.profile).toBe('Default'); // dbPath 兜底名
    const state = JSON.parse(readFileSync(result.data.saved, 'utf8')) as { cookies: PlaywrightCookie[]; origins: unknown[] };
    const sid = state.cookies.find(c => c.name === 'sid')!;
    expect(sid.value).toBe('tok-中文');
    expect(sid.sameSite).toBe('Strict');
    expect(sid.secure).toBe(true);
    expect(state.cookies.some(c => c.domain === '.other.org')).toBe(false);
    expect(state.origins).toEqual([]);
    expect(statSync(result.data.saved).mode & 0o777).toBe(0o600);

    // 合并语义：再导一次同域不同 cookie → upsert 后总数增长
    h.rows = [row({ host_key: '.example.com', name: 'extra' })];
    const result2 = (await handler()({ domains: 'example.com', dbPath: fakeDb, output: out })) as { data: { cookieCount: number } };
    expect(result2.data.cookieCount).toBe(3);

    // refresh：整体替换
    const result3 = (await handler()({ domains: 'example.com', dbPath: fakeDb, output: out, refresh: true })) as { data: { cookieCount: number } };
    expect(result3.data.cookieCount).toBe(1);

    unlinkSync(out);
    unlinkSync(fakeDb);
  });

  it('解密失败计入 failedCount 但不阻断', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xb-ls-fail-'));
    const fakeDb = join(dir, 'Cookies');
    writeFileSync(fakeDb, 'x');
    const out = join(dir, 'state.json');
    h.rows = [
      row({ host_key: '.example.com', name: 'bad', encrypted_value: Buffer.from('v10' + 'x'.repeat(48), 'latin1') }),
      row({ host_key: '.example.com', name: 'good', value: 'ok' }),
    ];
    const result = (await handler()({ domains: 'example.com', dbPath: fakeDb, output: out })) as { data: { cookieCount: number; failedCount: number } };
    expect(result.data.cookieCount).toBe(1);
    expect(result.data.failedCount).toBe(1);
    unlinkSync(out);
    unlinkSync(fakeDb);
  });
});

// ─── 无加密行时不触发 Keychain（纯明文 cookie 库）───

describe('exportLoginState keychain-on-demand', () => {
  beforeEach(() => { vi.clearAllMocks(); h.rows = []; });

  it('全部明文行 → 不调用 Keychain', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xb-ls-plain-'));
    const fakeDb = join(dir, 'Cookies');
    writeFileSync(fakeDb, 'x');
    const out = join(dir, 'state.json');
    h.rows = [row({ host_key: '.example.com', name: 'p', value: 'plain' })];
    await exportLoginState({ domains: 'example.com', dbPath: fakeDb, output: out });
    expect(h.execFile).not.toHaveBeenCalled();
    unlinkSync(out);
    unlinkSync(fakeDb);
  });
});
