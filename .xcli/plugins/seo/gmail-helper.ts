import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createServer } from 'http';

const GMAIL_DIR = join(homedir(), '.xbrowser');
const CREDENTIALS_PATH = join(GMAIL_DIR, 'gmail-credentials.json');
const TOKEN_PATH = join(GMAIL_DIR, 'gmail-token.json');

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const REDIRECT_PORT = 9225;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

interface Credentials {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
    project_id?: string;
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
    project_id?: string;
  };
}

interface TokenData {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
  scope: string;
}

function ensureDir(): void {
  if (!existsSync(GMAIL_DIR)) {
    mkdirSync(GMAIL_DIR, { recursive: true });
  }
}

function loadCredentials(): { client_id: string; client_secret: string } | null {
  if (!existsSync(CREDENTIALS_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8')) as Credentials;
    const src = raw.installed || raw.web;
    if (!src) return null;
    return { client_id: src.client_id, client_secret: src.client_secret };
  } catch {
    return null;
  }
}

function loadToken(): TokenData | null {
  if (!existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_PATH, 'utf-8')) as TokenData;
  } catch {
    return null;
  }
}

function saveToken(token: TokenData): void {
  ensureDir();
  writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), 'utf-8');
}

async function exchangeCode(code: string, creds: { client_id: string; client_secret: string }): Promise<TokenData> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Token exchange failed: ${resp.status} ${err}`);
  }
  const data = (await resp.json()) as Record<string, unknown>;
  return {
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string,
    expiry_date: Date.now() + ((data.expires_in as number) * 1000),
    token_type: (data.token_type as string) || 'Bearer',
    scope: (data.scope as string) || SCOPES.join(' '),
  };
}

async function refreshToken(token: TokenData, creds: { client_id: string; client_secret: string }): Promise<TokenData> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: token.refresh_token,
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Token refresh failed: ${resp.status} ${err}`);
  }
  const data = (await resp.json()) as Record<string, unknown>;
  const updated: TokenData = {
    access_token: data.access_token as string,
    refresh_token: (data.refresh_token as string) || token.refresh_token,
    expiry_date: Date.now() + ((data.expires_in as number) * 1000),
    token_type: (data.token_type as string) || token.token_type,
    scope: (data.scope as string) || token.scope,
  };
  saveToken(updated);
  return updated;
}

export async function getAccessToken(): Promise<string> {
  const creds = loadCredentials();
  if (!creds) throw new Error('Gmail credentials not found. Run seo setup-gmail first.');

  let token = loadToken();
  if (!token) throw new Error('Gmail token not found. Run seo setup-gmail to authorize.');

  if (Date.now() >= token.expiry_date - 60000) {
    token = await refreshToken(token, creds);
  }

  return token.access_token;
}

export async function initGmailAuth(): Promise<{ success: boolean; message: string }> {
  const creds = loadCredentials();
  if (!creds) {
    return {
      success: false,
      message: `未找到 Gmail 凭据文件。请从 Google Cloud Console 下载 OAuth 客户端凭据 JSON 并保存到:\n  ${CREDENTIALS_PATH}\n\n步骤:\n  1. 打开 https://console.cloud.google.com/apis/credentials\n  2. 创建 OAuth 2.0 客户端 ID（类型选"桌面应用"或"Web 应用"）\n  3. 下载 JSON 凭据文件\n  4. 保存为 ${CREDENTIALS_PATH}`,
    };
  }

  const existing = loadToken();
  if (existing && existing.expiry_date > Date.now()) {
    return { success: true, message: 'Gmail 已授权且 token 仍然有效，无需重新授权。' };
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: creds.client_id,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  }).toString()}`;

  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      if (!req.url) return;
      const url = new URL(req.url, `http://127.0.0.1:${REDIRECT_PORT}`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error || !code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>授权失败</h1><p>请关闭此页面并重试。</p>');
          server.close();
          resolve({ success: false, message: `授权被拒绝: ${error || 'no code'}` });
          return;
        }

        try {
          const token = await exchangeCode(code, creds);
          saveToken(token);

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>授权成功！</h1><p>可以关闭此页面了。</p>');
          server.close();
          resolve({ success: true, message: 'Gmail 授权成功，token 已保存。' });
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h1>授权失败</h1><p>${(e as Error).message}</p>`);
          server.close();
          resolve({ success: false, message: `Token 交换失败: ${(e as Error).message}` });
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`\n请在浏览器中打开以下链接完成 Gmail 授权:\n\n${authUrl}\n\n等待授权回调中...`);
    });

    setTimeout(() => {
      server.close();
      resolve({ success: false, message: '授权超时（5分钟），请重试。' });
    }, 5 * 60 * 1000);
  });
}

export async function gmailApiCall(endpoint: string): Promise<unknown> {
  const token = await getAccessToken();
  const url = endpoint.startsWith('http')
    ? endpoint
    : `https://www.googleapis.com/gmail/v1/users/me${endpoint}`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gmail API error: ${resp.status} ${errText}`);
  }

  return resp.json();
}

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  const normalized = pad ? padded + '='.repeat(4 - pad) : padded;
  return Buffer.from(normalized, 'base64').toString('utf-8');
}

function extractBodyFromPayload(payload: Record<string, unknown>): string {
  if (payload.body && (payload.body as Record<string, unknown>).data) {
    return decodeBase64Url((payload.body as Record<string, unknown>).data as string);
  }

  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts as Record<string, unknown>[]) {
      if (part.mimeType === 'text/plain' && (part.body as Record<string, unknown>)?.data) {
        return decodeBase64Url((part.body as Record<string, unknown>).data as string);
      }
    }
    for (const part of payload.parts as Record<string, unknown>[]) {
      if (part.mimeType === 'text/html' && (part.body as Record<string, unknown>)?.data) {
        return decodeBase64Url((part.body as Record<string, unknown>).data as string);
      }
    }
    for (const part of payload.parts as Record<string, unknown>[]) {
      const nested = extractBodyFromPayload(part as Record<string, unknown>);
      if (nested) return nested;
    }
  }

  return '';
}

function extractVerificationData(body: string, subject: string): { code: string; link: string } {
  let code = '';
  let link = '';

  const contextWindow = 200;
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

function extractHeader(payload: Record<string, unknown>, name: string): string {
  const headers = payload.headers as Array<{ name: string; value: string }> | undefined;
  if (!headers) return '';
  const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : '';
}

export interface VerificationResult {
  code: string;
  link: string;
  subject: string;
  from: string;
}

export async function fetchVerificationCode(fromFilter: string, maxAge: number): Promise<VerificationResult> {
  const ageMinutes = Math.ceil(maxAge / 60);
  const query = `from:{${fromFilter}} is:unread newer_than:${ageMinutes}m`;

  const listResult = (await gmailApiCall(
    `/messages?q=${encodeURIComponent(query)}&maxResults=5`
  )) as { messages?: Array<{ id: string }>; resultSizeEstimate?: number };

  if (!listResult.messages || listResult.messages.length === 0) {
    throw new Error(`未找到来自 "${fromFilter}" 的未读邮件（最近 ${maxAge} 秒内）`);
  }

  const latestMsg = listResult.messages[0];
  const msgResult = (await gmailApiCall(`/messages/${latestMsg.id}?format=full`)) as {
    payload: Record<string, unknown>;
    snippet?: string;
  };

  const payload = msgResult.payload || {};
  const subject = extractHeader(payload, 'Subject');
  const from = extractHeader(payload, 'From');
  const body = extractBodyFromPayload(payload);
  const { code, link } = extractVerificationData(body, subject);

  return {
    code,
    link,
    subject,
    from,
  };
}

export { loadCredentials, CREDENTIALS_PATH, TOKEN_PATH };
