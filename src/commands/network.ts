import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { createEphemeralContext, closeEphemeralContext } from '../browser.js';
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
}

interface NetworkJsonResult {
  url: string;
  captures: NetworkCapture[];
  console: string[];
  total: number;
  timestamp: number;
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
): NetworkSummaryResult {
  return {
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
}

function buildJsonOutput(
  url: string,
  captures: NetworkCapture[],
  consoleMessages: string[],
  totalCount: number,
): NetworkJsonResult {
  return {
    url,
    captures,
    console: consoleMessages,
    total: totalCount,
    timestamp: Date.now(),
  };
}

export const networkCommand = registerCommand({
  name: 'network',
  description: 'Capture and filter network responses from a URL',
  scope: 'project',
  parameters: z.object({
    url: z.string(),
    filter: z.string().optional(),
    match: z.string().optional(),
    console: z.boolean().default(false),
    timeout: z.number().default(30000),
    wait: z.number().default(3000),
    limit: z.number().default(50),
    format: z.enum(['summary', 'json']).default('summary'),
  }),
  handler: async (p, ctx: BrowserCommandContext): Promise<ReturnType<typeof ok>> => {
    const isCDP = !!ctx.cdpEndpoint;
    const launchOpts = isCDP
      ? { cdpEndpoint: ctx.cdpEndpoint }
      : { headless: true };

    const { context, page } = await createEphemeralContext(launchOpts);
    const startTime = Date.now();

    try {
      const captures: NetworkCapture[] = [];
      const consoleMessages: string[] = [];

      page.on('response', async (response: Response) => {
        if (captures.length >= p.limit) return;

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
      });

      if (p.console) {
        page.on('console', (msg) => {
          consoleMessages.push(`${msg.type()}: ${msg.text()}`);
        });
      }

      await page.goto(p.url, {
        waitUntil: 'networkidle',
        timeout: p.timeout,
      });

      await page.waitForTimeout(p.wait);

      const totalCount = captures.length;

      let results = captures;
      if (p.match) {
        results = captures.filter((c) => JSON.stringify(c).includes(p.match!));
      }

      const duration = Date.now() - startTime;

      if (p.format === 'json') {
        return ok(buildJsonOutput(p.url, results, consoleMessages, totalCount));
      }

      return ok(buildSummaryOutput(p.url, duration, results, consoleMessages, totalCount));
    } finally {
      await closeEphemeralContext(context);
    }
  },
});
