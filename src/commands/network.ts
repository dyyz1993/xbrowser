import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { createEphemeralContext, closeEphemeralContext, resolveLaunchOpts } from '../browser.js';
import type { Response } from 'playwright';

interface NetworkCapture {
  method: string;
  url: string;
  path: string;
  status: number;
  size: number;
  contentType: string;
  headers: Record<string, string>;
  body?: unknown;
}

interface SummaryCapture {
  method: string;
  path: string;
  status: number;
  size: number;
  contentType: string;
  preview: string;
}

interface NetworkSummaryResult {
  url: string;
  duration: number;
  captures: SummaryCapture[];
  console: string[];
  total: number;
  filtered: number;
  timestamp: number;
  websockets?: Array<{ url: string; direction: string; data: string }>;
}

interface WSCapture {
  url: string;
  direction: 'sent' | 'received';
  data: string;
  timestamp: number;
}

interface NetworkJsonResult {
  url: string;
  captures: NetworkCapture[];
  console: string[];
  total: number;
  timestamp: number;
  websockets?: WSCapture[];
}

function extractPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return url;
  }
}

function generatePreview(body: unknown): string {
  if (body === null || body === undefined) return '';
  if (typeof body !== 'object') return String(body).slice(0, 200);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      parts.push(`${key}[${value.length}]`);
    } else if (typeof value === 'object' && value !== null) {
      parts.push(`${key}={...}`);
    } else {
      parts.push(`${key}=${value}`);
    }
    if (parts.length >= 5) break;
  }
  return parts.join(', ');
}

function buildSummaryOutput(
  url: string,
  duration: number,
  captures: NetworkCapture[],
  consoleMessages: string[],
  totalCount: number,
  wsCaptures?: WSCapture[],
): NetworkSummaryResult {
  const result: NetworkSummaryResult = {
    url,
    duration,
    captures: captures.map((c) => ({
      method: c.method,
      path: c.path,
      status: c.status,
      size: c.size,
      contentType: c.contentType,
      preview: c.body !== undefined ? generatePreview(c.body) : '',
    })),
    console: consoleMessages,
    total: totalCount,
    filtered: captures.length,
    timestamp: Date.now(),
  };

  if (wsCaptures && wsCaptures.length > 0) {
    result.websockets = wsCaptures.map(ws => ({
      url: ws.url.slice(0, 100),
      direction: ws.direction,
      data: ws.data.slice(0, 200),
    }));
  }

  return result;
}

function buildJsonOutput(
  url: string,
  captures: NetworkCapture[],
  consoleMessages: string[],
  totalCount: number,
  wsCaptures?: WSCapture[],
  searchResults?: unknown,
): NetworkJsonResult & { searchResults?: unknown } {
  return {
    url,
    captures,
    console: consoleMessages,
    total: totalCount,
    timestamp: Date.now(),
    ...(wsCaptures && wsCaptures.length > 0 ? { websockets: wsCaptures } : {}),
    searchResults,
  };
}

function searchInObject(obj: unknown, searchTerm: string, path: string = ''): unknown {
  if (obj === null || obj === undefined) return undefined;

  if (typeof obj === 'string') {
    return obj.toLowerCase().includes(searchTerm.toLowerCase()) ? obj : undefined;
  }

  if (typeof obj !== 'object') {
    const str = String(obj).toLowerCase();
    return str.includes(searchTerm.toLowerCase()) ? obj : undefined;
  }

  if (Array.isArray(obj)) {
    const results: unknown[] = [];
    for (let i = 0; i < obj.length; i++) {
      const found = searchInObject(obj[i], searchTerm, `${path}[${i}]`);
      if (found !== undefined) results.push(found);
    }
    return results.length > 0 ? results : undefined;
  }

  const record = obj as Record<string, unknown>;
  const results: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (key.toLowerCase().includes(searchTerm.toLowerCase())) {
      results[key] = value;
    } else {
      const found = searchInObject(value, searchTerm, currentPath);
      if (found !== undefined) {
        results[key] = found;
      }
    }
  }

  return Object.keys(results).length > 0 ? results : undefined;
}

export const networkCommand = registerCommand({
  name: 'network',
  description: 'Capture and filter network responses from a URL',
  scope: 'project',
  parameters: z.object({
    url: z.string(),
    filter: z.string().optional(),
    match: z.string().optional(),
    search: z.string().optional().describe('Search within all captured response bodies'),
    console: z.boolean().default(false),
    timeout: z.number().default(30000),
    wait: z.number().default(3000),
    limit: z.number().default(50),
    format: z.enum(['summary', 'json']).default('summary'),
    ws: z.boolean().optional().default(false).describe('Only show WebSocket messages'),
    listen: z.boolean().optional().default(false).describe('监听模式：使用现有 session 的 page，等待指定时间捕获请求'),
    duration: z.number().int().optional().default(15000).describe('监听模式等待时长（毫秒，默认 15000）'),
  }),
  handler: async (p, ctx: BrowserCommandContext): Promise<ReturnType<typeof ok>> => {
    const startTime = Date.now();

    const responseHandler = async (response: Response, captures: NetworkCapture[], limit: number) => {
      if (captures.length >= limit) return;

      const responseUrl = response.url();

      if (p.filter && !responseUrl.includes(p.filter)) return;

      const contentType = response.headers()['content-type'] || '';
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(response.headers())) {
        headers[k] = v;
      }

      let body: unknown = undefined;
      let size = 0;

      const isJsonish = contentType.includes('json') || contentType.includes('javascript');
      if (isJsonish) {
        try {
          body = await response.json();
        } catch {
          try {
            const text = await response.text();
            size = text.length;
            try {
              body = JSON.parse(text);
            } catch {
              body = text;
            }
          } catch {
            // unable to read body
          }
        }
        if (body !== undefined && size === 0) {
          size = JSON.stringify(body).length;
        }
      } else {
        try {
          const text = await response.text();
          size = text.length;
        } catch {
          size = 0;
        }
      }

      captures.push({
        method: response.request().method(),
        url: responseUrl,
        path: extractPath(responseUrl),
        status: response.status(),
        size,
        contentType,
        headers,
        body,
      });
    };

    if (p.listen) {
      const page = ctx.page;
      if (!page) return fail('No active page. Use --cdp to connect first.');

      const captures: NetworkCapture[] = [];
      const consoleMessages: string[] = [];
      const wsCaptures: WSCapture[] = [];

      const handler = (response: Response) => responseHandler(response, captures, p.limit);
      page.on('response', handler);

      if (p.console) {
        page.on('console', (msg) => {
          consoleMessages.push(`${msg.type()}: ${msg.text()}`);
        });
      }

      page.on('websocket', (ws) => {
        const wsUrl = ws.url();
        ws.on('framesent', ({ payload }) => {
          const dataStr = typeof payload === 'string' ? payload.slice(0, 500) : `[binary ${(payload as Buffer).byteLength || 0} bytes]`;
          wsCaptures.push({ url: wsUrl, direction: 'sent', data: dataStr, timestamp: Date.now() });
        });
        ws.on('framereceived', ({ payload }) => {
          const dataStr = typeof payload === 'string' ? payload.slice(0, 500) : `[binary ${(payload as Buffer).byteLength || 0} bytes]`;
          wsCaptures.push({ url: wsUrl, direction: 'received', data: dataStr, timestamp: Date.now() });
        });
      });

      console.error(`[network] Listening for ${p.duration}ms...`);
      await page.waitForTimeout(p.duration);

      page.off('response', handler);

      const duration = Date.now() - startTime;

      if (p.ws && wsCaptures.length > 0) {
        return ok({
          url: '[listen mode]',
          duration,
          total: captures.length,
          filtered: captures.length,
          timestamp: Date.now(),
          websockets: wsCaptures.map(ws => ({
            url: ws.url.slice(0, 100),
            direction: ws.direction,
            data: ws.data.slice(0, 200),
          })),
        });
      }

      if (p.format === 'json') {
        return ok(buildJsonOutput('[listen mode]', captures, consoleMessages, captures.length, wsCaptures));
      }

      return ok(buildSummaryOutput('[listen mode]', duration, captures, consoleMessages, captures.length, wsCaptures));
    }

    const { context, page } = await createEphemeralContext(resolveLaunchOpts(ctx));

    try {
      const captures: NetworkCapture[] = [];
      const consoleMessages: string[] = [];
      const wsCaptures: WSCapture[] = [];

      page.on('response', (response: Response) => responseHandler(response, captures, p.limit));

      if (p.console) {
        page.on('console', (msg) => {
          consoleMessages.push(`${msg.type()}: ${msg.text()}`);
        });
      }

      page.on('websocket', (ws) => {
        const wsUrl = ws.url();
        ws.on('framesent', ({ payload }) => {
          const dataStr = typeof payload === 'string' ? payload.slice(0, 500) : `[binary ${(payload as Buffer).byteLength || 0} bytes]`;
          wsCaptures.push({ url: wsUrl, direction: 'sent', data: dataStr, timestamp: Date.now() });
        });
        ws.on('framereceived', ({ payload }) => {
          const dataStr = typeof payload === 'string' ? payload.slice(0, 500) : `[binary ${(payload as Buffer).byteLength || 0} bytes]`;
          wsCaptures.push({ url: wsUrl, direction: 'received', data: dataStr, timestamp: Date.now() });
        });
      });

      await page.goto(p.url, {
        waitUntil: 'domcontentloaded',
        timeout: p.timeout,
      });

      await page.waitForLoadState('networkidle', { timeout: p.timeout }).catch(() => {});

      await page.waitForTimeout(p.wait);

      const totalCount = captures.length;

      let results = captures;
      if (p.match) {
        results = captures.filter((c) => JSON.stringify(c).includes(p.match!));
      }

      let searchResults: unknown = undefined;
      if (p.search) {
        const allMatches: Array<{ url: string; path: string; match: unknown }> = [];
        for (const cap of results) {
          if (cap.body !== undefined) {
            const found = searchInObject(cap.body, p.search);
            if (found !== undefined) {
              allMatches.push({
                url: cap.url,
                path: cap.path,
                match: found,
              });
            }
          }
        }
        searchResults = allMatches.length > 0 ? allMatches : null;
      }

      const duration = Date.now() - startTime;

      if (p.ws && wsCaptures.length > 0) {
        return ok({
          url: p.url,
          duration,
          total: captures.length,
          filtered: captures.length,
          timestamp: Date.now(),
          websockets: wsCaptures.map(ws => ({
            url: ws.url.slice(0, 100),
            direction: ws.direction,
            data: ws.data.slice(0, 200),
          })),
        });
      }

      if (p.format === 'json') {
        return ok(buildJsonOutput(p.url, results, consoleMessages, totalCount, wsCaptures, searchResults));
      }

      return ok(buildSummaryOutput(p.url, duration, results, consoleMessages, totalCount, wsCaptures));
    } finally {
      await closeEphemeralContext(context);
    }
  },
});

export { extractPath, generatePreview, buildSummaryOutput, buildJsonOutput, searchInObject };
