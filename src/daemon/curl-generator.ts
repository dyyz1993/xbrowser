import type { NetworkCaptureEntry } from './network-store.js';
import { errMsg } from '../utils/error.js';

export interface CurlOptions {
  includeHeaders?: boolean;
  includeBody?: boolean;
  compressed?: boolean;
  insecure?: boolean;
}

export interface CurlResult {
  command: string;
  method: string;
  url: string;
  headerCount: number;
  hasBody: boolean;
}

const SKIP_HEADERS = new Set([
  'host', 'connection', 'content-length', 'accept-encoding',
  'accept-language', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user',
  'upgrade-insecure-requests', 'priority',
]);

function escapeSingleQuote(str: string): string {
  return str.replace(/'/g, "'\\''");
}

export function generateCurl(
  entry: NetworkCaptureEntry,
  options: CurlOptions = {},
): CurlResult {
  const opts = {
    includeHeaders: options.includeHeaders ?? true,
    includeBody: options.includeBody ?? true,
    compressed: options.compressed ?? true,
    insecure: options.insecure ?? false,
  };

  const parts: string[] = ['curl'];

  if (opts.compressed) parts.push('--compressed');
  if (opts.insecure) parts.push('-k');

  const method = entry.method.toUpperCase();
  parts.push(`-X '${method}'`);
  parts.push(`'${entry.url}'`);

  let headerCount = 0;
  if (opts.includeHeaders && entry.requestHeaders) {
    for (const [key, value] of Object.entries(entry.requestHeaders)) {
      if (SKIP_HEADERS.has(key.toLowerCase())) continue;
      if (key.startsWith(':')) continue;
      parts.push(`-H '${key}: ${escapeSingleQuote(value)}'`);
      headerCount++;
    }
  }

  const hasBody = entry.requestBody !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  if (opts.includeBody && hasBody && entry.requestBody !== undefined) {
    const bodyStr = typeof entry.requestBody === 'string' ? entry.requestBody : JSON.stringify(entry.requestBody);
    parts.push(`-d '${escapeSingleQuote(bodyStr)}'`);
  }

  return {
    command: parts.join(' \\\n  '),
    method,
    url: entry.url,
    headerCount,
    hasBody,
  };
}

export interface ReplayResult {
  curlCommand: string;
  replay: {
    success: boolean;
    status: number | null;
    statusText: string;
    contentType: string;
    size: number;
    bodyMatch: boolean;
    duration: number;
    error?: string;
  } | null;
}

const HOP_BY_HOP = new Set([
  'host', 'connection', 'content-length', 'transfer-encoding',
]);

export async function replayEntry(
  entry: NetworkCaptureEntry,
  options: CurlOptions = {},
): Promise<ReplayResult> {
  const curl = generateCurl(entry, options);

  try {
    const method = entry.method.toUpperCase();
    const fetchHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(entry.requestHeaders ?? {})) {
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;
      if (k.startsWith(':')) continue;
      fetchHeaders[k] = v;
    }

    const fetchOpts: RequestInit = {
      method,
      headers: fetchHeaders,
      signal: AbortSignal.timeout(15000),
    };

    if (entry.requestBody !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const bodyStr = typeof entry.requestBody === 'string' ? entry.requestBody : JSON.stringify(entry.requestBody);
      fetchOpts.body = bodyStr;
      if (!fetchHeaders['content-type']) {
        fetchHeaders['content-type'] = 'application/json';
      }
    }

    const start = Date.now();
    const resp = await fetch(entry.url, fetchOpts);
    const duration = Date.now() - start;

    const respText = await resp.text();
    const respSize = respText.length;

    let bodyMatch = false;
    if (entry.body && resp.ok) {
      try {
        const originalStr = typeof entry.body === 'string' ? entry.body : JSON.stringify(entry.body);
        const origLen = originalStr.length;
        const respLen = respText.length;
        bodyMatch = respLen > 0 && Math.abs(origLen - respLen) / Math.max(origLen, 1) < 0.5;
      } catch {
        bodyMatch = false;
      }
    }

    return {
      curlCommand: curl.command,
      replay: {
        success: resp.ok,
        status: resp.status,
        statusText: resp.statusText,
        contentType: resp.headers.get('content-type') || '',
        size: respSize,
        bodyMatch,
        duration,
      },
    };
  } catch (err) {
    return {
      curlCommand: curl.command,
      replay: {
        success: false,
        status: null,
        statusText: '',
        contentType: '',
        size: 0,
        bodyMatch: false,
        duration: 0,
        error: errMsg(err),
      },
    };
  }
}
