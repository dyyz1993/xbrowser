/**
 * Chrome cookie 解密（macOS）—— 仅在 Chrome 完全退出后可用。
 *
 * 算法（Chromium os_crypt，macOS 分支，经纯净对照实验验证）：
 *   key  = PBKDF2-SHA1(keychainPassword, "saltysalt", 1003, 16)
 *   enc  = "v10" + AES-128-CBC(key, IV=0x20*16, PKCS7)
 *
 * 注意：Chrome 运行时会把真实密钥轮换进内存，此时钥匙串条目陈旧、解密必败。
 */
import { execSync } from 'child_process';
import crypto from 'crypto';

interface RawCookie {
  host_key: string; name: string; encrypted_value: string;
  path: string; is_secure: number; is_httponly: number;
  expires_utc: number | null; samesite: number;
}

export function decryptChromeCookies(dbPath: string, siteFilter?: string): Array<Record<string, unknown>> {
  const chromePw = execSync(
    'security find-generic-password -w -s "Chrome Safe Storage" -a "Chrome"',
    { encoding: 'utf8' },
  ).trim();
  const key = crypto.pbkdf2Sync(chromePw, 'saltysalt', 1003, 16, 'sha1');

  const like = siteFilter ? `WHERE host_key LIKE '%${siteFilter.replace(/[^a-z0-9.-]/gi, '')}%'` : '';
  const rows = JSON.parse(
    execSync(`sqlite3 -json "${dbPath}" "SELECT host_key,name,hex(encrypted_value) AS enc_hex,path,is_secure,is_httponly,expires_utc,samesite FROM cookies ${like}"`, { encoding: 'utf8', maxBuffer: 50e6 }),
  ) as RawCookie[] & { enc_hex?: string }[];

  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const full = Buffer.from((r as unknown as { enc_hex: string }).enc_hex, 'hex');
    if (full.length < 4) continue;
    const prefix = full.slice(0, 3).toString('latin1');
    if (prefix !== 'v10') continue; // v20/app-bound 不可解，跳过
    try {
      const d = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
      const dec = Buffer.concat([d.update(full.slice(3)), d.final()]);
      // PKCS7 unpad manually (decode-safe)
      const pad = dec[dec.length - 1];
      const plain = pad >= 1 && pad <= 16 ? dec.slice(0, dec.length - pad) : dec;
      const value = plain.toString('utf8');
      if (!value) continue;
      out.push({
        domain: r.host_key,
        name: r.name,
        value,
        path: r.path,
        secure: !!r.is_secure,
        httpOnly: !!r.is_httponly,
        expirationDate: r.expires_utc ? Math.floor(r.expires_utc / 1e6 - 11644473600) : undefined,
        sameSite: r.samesite === 0 ? 'no_restriction' : r.samesite === 1 ? 'lax' : r.samesite === 2 ? 'strict' : 'unspecified',
        hostOnly: !r.host_key.startsWith('.'),
      });
    } catch { /* wrong key or v20 — skip */ }
  }
  return out;
}
