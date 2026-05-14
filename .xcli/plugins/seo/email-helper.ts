import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ImapFlow } from 'imapflow';

const CONFIG_DIR = join(homedir(), '.xbrowser');
const CONFIG_PATH = join(CONFIG_DIR, 'email-config.json');
const TOKEN_PATH = join(CONFIG_DIR, 'email-token.json');

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  tls: boolean;
}

export interface VerificationResult {
  code: string;
  link: string;
  subject: string;
  from: string;
}

const DEFAULT_CONFIG: Partial<EmailConfig> = {
  host: 'imap.qq.com',
  port: 993,
  tls: true,
};

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): EmailConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as EmailConfig;
  } catch {
    return null;
  }
}

function saveConfig(config: EmailConfig): void {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function createClient(config: EmailConfig): ImapFlow {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    logger: false as unknown as undefined,
  });
}

async function testConnection(config: EmailConfig): Promise<boolean> {
  const client = createClient(config);
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    try {
      await client.logout();
    } catch {}
  }
}

export async function setupEmailConfig(config: Partial<EmailConfig>): Promise<{ success: boolean; message: string }> {
  const fullConfig: EmailConfig = {
    host: config.host || DEFAULT_CONFIG.host || 'imap.qq.com',
    port: config.port || DEFAULT_CONFIG.port || 993,
    user: config.user || '',
    pass: config.pass || '',
    tls: config.tls !== undefined ? config.tls : true,
  };

  if (!fullConfig.user || !fullConfig.pass) {
    return {
      success: false,
      message: '缺少必要参数: user（邮箱地址）和 pass（授权码）不能为空。',
    };
  }

  const connected = await testConnection(fullConfig);
  if (!connected) {
    return {
      success: false,
      message: `IMAP 连接失败，请检查配置:\n  主机: ${fullConfig.host}:${fullConfig.port}\n  用户: ${fullConfig.user}\n  授权码是否正确？是否已开启 IMAP 服务？`,
    };
  }

  saveConfig(fullConfig);
  return {
    success: true,
    message: `邮箱配置已保存并连接测试成功。\n  主机: ${fullConfig.host}:${fullConfig.port}\n  用户: ${fullConfig.user}\n  配置文件: ${CONFIG_PATH}`,
  };
}

export async function initEmailAuth(): Promise<{ success: boolean; message: string }> {
  const config = loadConfig();
  if (!config) {
    return {
      success: false,
      message: `未找到邮箱配置文件。请先运行配置:\n  配置文件路径: ${CONFIG_PATH}\n\n需要的配置:\n  host: IMAP 服务器地址（QQ邮箱: imap.qq.com）\n  port: 端口（通常 993）\n  user: 邮箱地址\n  pass: 授权码（非邮箱密码）\n  tls: 是否启用 TLS（建议 true）`,
    };
  }

  const connected = await testConnection(config);
  if (!connected) {
    return {
      success: false,
      message: `IMAP 连接失败，配置可能已过期或授权码已更改。\n  主机: ${config.host}:${config.port}\n  用户: ${config.user}\n  请重新运行 setupEmailConfig 配置。`,
    };
  }

  return {
    success: true,
    message: `邮箱连接成功。\n  主机: ${config.host}:${config.port}\n  用户: ${config.user}`,
  };
}

function extractVerificationData(body: string, subject: string): { code: string; link: string } {
  let code = '';

  const keywords = ['code', 'verification', 'verify', '验证码', '验证', 'pin', 'otp', 'confirm'];

  const lowerBody = body.toLowerCase();
  const lowerSubject = subject.toLowerCase();

  const codePatterns = [
    /(?:code|验证码|verification|verify|pin|otp)[^\d]{0,30}(\d{4,8})/i,
    /(\d{4,8})[^\d]{0,30}(?:code|验证码|verification|verify|pin|otp)/i,
    /(?:is|为|:)\s*(\d{4,8})\b/i,
    /<strong[^>]*>\s*(\d{4,8})\s*<\/strong>/i,
    /<b[^>]*>\s*(\d{4,8})\s*<\/b>/i,
  ];

  for (const pattern of codePatterns) {
    const m = body.match(pattern) || subject.match(pattern);
    if (m) {
      code = m[1];
      break;
    }
  }

  if (!code) {
    const sentences = body.split(/[.!?\n]+/);
    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (keywords.some(kw => lower.includes(kw))) {
        const numMatch = sentence.match(/\b(\d{4,8})\b/);
        if (numMatch) {
          code = numMatch[1];
          break;
        }
      }
    }
  }

  let link = '';

  const linkPatterns = [
    /https?:\/\/[^\s"'<>]+(?:verify|confirm|activate|token|验证)[^\s"'<>]*/i,
    /https?:\/\/[^\s"'<>]*(?:verify|confirm|activate|token)[^\s"'<>]*/i,
    /href=["'](https?:\/\/[^\s"'<>]+(?:verify|confirm|activate|token)[^\s"'<>]*)["']/i,
    /href=["'](https?:\/\/[^\s"'<>]*(?:verify|confirm|activate|token)[^\s"'<>]*)["']/i,
  ];

  for (const pattern of linkPatterns) {
    const m = body.match(pattern);
    if (m) {
      link = m[1] || m[0];
      link = link.replace(/['"<>]/g, '');
      break;
    }
  }

  if (!link) {
    const hrefMatch = body.match(/href=["'](https?:\/\/[^\s"'<>]+)["']/i);
    if (hrefMatch) {
      const candidate = hrefMatch[1];
      if (keywords.some(kw => candidate.toLowerCase().includes(kw)) || lowerSubject.includes('verify') || lowerSubject.includes('confirm')) {
        link = candidate;
      }
    }
  }

  return { code, link };
}

function parseMimeBody(raw: string): { text: string; html: string } {
  const boundaryMatch = raw.match(/boundary=["']?([^"'\s;]+)["']?/i);
  if (!boundaryMatch) {
    return { text: raw, html: '' };
  }

  const boundary = boundaryMatch[1];
  const parts = raw.split('--' + boundary);

  let text = '';
  let html = '';

  for (const part of parts) {
    if (!part.trim() || part.trim() === '--') continue;

    const encodingMatch = part.match(/Content-Transfer-Encoding:\s*([\w-]+)/i);
    const encoding = encodingMatch ? encodingMatch[1].toLowerCase() : '7bit';

    const headerEnd = part.indexOf('\r\n\r\n');
    const bodyStart = headerEnd === -1 ? part.indexOf('\n\n') : headerEnd;
    if (bodyStart === -1) continue;

    const partBody = part.substring(bodyStart).trim();

    let decoded: string;
    if (encoding === 'base64') {
      decoded = Buffer.from(partBody.replace(/\r?\n/g, ''), 'base64').toString('utf-8');
    } else if (encoding === 'quoted-printable') {
      decoded = partBody
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    } else {
      decoded = partBody;
    }

    if (part.toLowerCase().includes('content-type: text/plain')) {
      text = decoded;
    } else if (part.toLowerCase().includes('content-type: text/html')) {
      html = decoded;
    }
  }

  return { text, html };
}

export async function fetchVerificationCode(fromFilter: string, maxAge: number): Promise<VerificationResult> {
  const config = loadConfig();
  if (!config) {
    throw new Error(`未找到邮箱配置文件: ${CONFIG_PATH}，请先运行 setupEmailConfig。`);
  }

  const client = createClient(config);

  try {
    await client.connect();

    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - maxAge * 1000);
      const searchCriteria: Record<string, unknown> = {
        since,
        unseen: true,
      };

      if (fromFilter) {
        searchCriteria.from = fromFilter;
      }

      const uids = await client.search(searchCriteria);

      if (!uids || uids.length === 0) {
        throw new Error(`未找到来自 "${fromFilter}" 的未读邮件（最近 ${maxAge} 秒内）`);
      }

      const latestUid = uids[uids.length - 1];

      let subject = '';
      let fromDisplay = '';
      let body = '';

      for await (const msg of client.fetch(String(latestUid), { envelope: true, source: true })) {
        subject = msg.envelope?.subject || '';
        const fromAddr = msg.envelope?.from?.[0]?.address || '';
        const fromName = msg.envelope?.from?.[0]?.name || '';
        fromDisplay = fromName ? `${fromName} <${fromAddr}>` : fromAddr;

        const raw = msg.source;
        if (raw) {
          const rawStr = typeof raw === 'string' ? raw : raw.toString('utf-8');
          const parsed = parseMimeBody(rawStr);
          body = parsed.text || parsed.html || '';
        }
      }
      const { code, link } = extractVerificationData(body, subject);

      return {
        code,
        link,
        subject,
        from: fromDisplay,
      };
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {}
  }
}

export { CONFIG_PATH, TOKEN_PATH };
