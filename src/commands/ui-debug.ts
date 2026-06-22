import { z } from 'zod';
import { errMsg } from '../utils/error.js';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const consoleCheckCommand = registerCommand({
  name: 'console',
  description: 'Collect and analyze browser console messages (errors, warnings, logs)',
  scope: 'page',
  parameters: z.object({
    url: z.string().optional().describe('URL to navigate first (optional, uses current page if omitted)'),
    duration: z.number().optional().default(5000).describe('How long to collect messages (ms)'),
    filter: z.enum(['all', 'error', 'warning', 'info', 'log']).optional().default('all'),
    includeStackTraces: z.boolean().optional().default(true),
  }),
  result: z.object({
    url: z.string(),
    duration: z.number(),
    total: z.number(),
    errors: z.number(),
    warnings: z.number(),
    messages: z.array(z.record(z.unknown())),
    summary: z.string(),
    passed: z.boolean(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const { page } = ctx;

    if (p.url) {
      await page.goto(p.url, { waitUntil: 'domcontentloaded' });
    }

    const messages = await page.evaluate<Array<{ type: string; text: string; location: string; timestamp: string; stack?: string }>>((args: { duration: number }) => {
      return new Promise<Array<{ type: string; text: string; location: string; timestamp: string; stack?: string }>>((resolve) => {
        const collected: Array<{ type: string; text: string; location: string; timestamp: string; stack?: string }> = [];

        const originalConsole = {
          log: console.log,
          warn: console.warn,
          error: console.error,
          info: console.info,
        };

        const capture = (type: string, captureArgs: unknown[]) => {
          const text = captureArgs.map((a) => {
            if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
            if (typeof a === 'object') try { return JSON.stringify(a); } catch { return String(a); } // circular refs
            return String(a);
          }).join(' ');

          const stack = new Error().stack?.split('\n').slice(2, 5).join('\n') || '';

          collected.push({
            type,
            text,
            location: stack.split('\n')[0]?.trim() || '',
            timestamp: new Date().toISOString(),
            stack,
          });
        };

        console.log = (...a: unknown[]) => { capture('log', a); originalConsole.log(...a); };
        console.warn = (...a: unknown[]) => { capture('warning', a); originalConsole.warn(...a); };
        console.error = (...a: unknown[]) => { capture('error', a); originalConsole.error(...a); };
        console.info = (...a: unknown[]) => { capture('info', a); originalConsole.info(...a); };

        window.addEventListener('error', (e: ErrorEvent) => {
          collected.push({
            type: 'error',
            text: `${e.message} at ${e.filename}:${e.lineno}:${e.colno}`,
            location: `${e.filename}:${e.lineno}`,
            timestamp: new Date().toISOString(),
            stack: e.error?.stack || '',
          });
        });

        window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
          collected.push({
            type: 'error',
            text: `Unhandled Promise Rejection: ${e.reason}`,
            location: '',
            timestamp: new Date().toISOString(),
            stack: e.reason?.stack || '',
          });
        });

        setTimeout(() => {
          console.log = originalConsole.log;
          console.warn = originalConsole.warn;
          console.error = originalConsole.error;
          console.info = originalConsole.info;
          resolve(collected);
        }, args.duration);
      });
    }, { duration: p.duration });

    const filtered = p.filter === 'all'
      ? messages
      : messages.filter((m) => m.type === p.filter);

    const errorCount = messages.filter((m) => m.type === 'error').length;
    const warnCount = messages.filter((m) => m.type === 'warning').length;

    return ok({
      url: page.url(),
      duration: p.duration,
      total: messages.length,
      errors: errorCount,
      warnings: warnCount,
      messages: p.includeStackTraces ? filtered : filtered.map(({ stack: _s, ...rest }) => rest),
      summary: `${messages.length} messages (${errorCount} errors, ${warnCount} warnings)`,
      passed: errorCount === 0,
    });
  },
});

export const networkCheckCommand = registerCommand({
  name: 'net-debug',
  description: 'Monitor and analyze network requests — capture failed requests, slow responses, status codes',
  scope: 'page',
  parameters: z.object({
    url: z.string().optional().describe('URL to navigate first'),
    duration: z.number().optional().default(5000).describe('How long to monitor (ms)'),
    filter: z.enum(['all', 'failed', 'slow', 'error', 'xhr', 'fetch', 'document', 'stylesheet', 'script', 'image']).optional().default('all'),
    slowThreshold: z.number().optional().default(3000).describe('Threshold for "slow" requests (ms)'),
  }),
  result: z.object({
    url: z.string(),
    duration: z.number(),
    totalRequests: z.number(),
    failedRequests: z.number(),
    slowRequests: z.number(),
    errorRequests: z.number(),
    totalSizeKB: z.number(),
    requests: z.array(z.record(z.unknown())),
    summary: z.string(),
    passed: z.boolean(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const { page } = ctx;
    const client = await page.context().newCDPSession(page);
    try {
      const requests: Array<{
        url: string;
        method: string;
        resourceType: string;
        status: number;
        mimeType: string;
        duration: number;
        size: number;
        error?: string;
      }> = [];

      const pendingRequests = new Map<string, { startTime: number; request: { url: string; method: string; resourceType: string } }>();

      await client.send('Network.enable');

      client.on('Network.requestWillBeSent', (params: { requestId: string; request: { url: string; method: string }; type?: string }) => {
        pendingRequests.set(params.requestId, {
          startTime: Date.now(),
          request: {
            url: params.request.url,
            method: params.request.method,
            resourceType: params.type || 'other',
          },
        });
      });

      client.on('Network.responseReceived', (params: { requestId: string; response: { status: number; mimeType: string; encodedDataLength?: number } }) => {
        const pending = pendingRequests.get(params.requestId);
        if (pending) {
          requests.push({
            url: pending.request.url,
            method: pending.request.method,
            resourceType: pending.request.resourceType,
            status: params.response.status,
            mimeType: params.response.mimeType,
            duration: Date.now() - pending.startTime,
            size: params.response.encodedDataLength || 0,
          });
          pendingRequests.delete(params.requestId);
        }
      });

      client.on('Network.loadingFailed', (params: { requestId: string; errorText?: string }) => {
        const pending = pendingRequests.get(params.requestId);
        if (pending) {
          requests.push({
            url: pending.request.url,
            method: pending.request.method,
            resourceType: pending.request.resourceType,
            status: 0,
            mimeType: '',
            duration: Date.now() - pending.startTime,
            size: 0,
            error: params.errorText || 'Loading failed',
          });
          pendingRequests.delete(params.requestId);
        }
      });

      if (p.url) {
        await page.goto(p.url, { waitUntil: 'domcontentloaded' });
      } else {
        await page.reload({ waitUntil: 'domcontentloaded' });
      }

      await page.waitForTimeout(p.duration);

      let filtered = requests;
      switch (p.filter) {
        case 'failed':
          filtered = requests.filter((r) => r.status === 0 || r.status >= 400);
          break;
        case 'slow':
          filtered = requests.filter((r) => r.duration >= p.slowThreshold);
          break;
        case 'error':
          filtered = requests.filter((r) => r.error);
          break;
        case 'xhr':
        case 'fetch':
          filtered = requests.filter((r) => r.resourceType === p.filter);
          break;
        case 'document':
        case 'stylesheet':
        case 'script':
        case 'image':
          filtered = requests.filter((r) => r.resourceType === p.filter);
          break;
      }

      const failedCount = requests.filter((r) => r.status === 0 || r.status >= 400).length;
      const slowCount = requests.filter((r) => r.duration >= p.slowThreshold).length;
      const errorCount = requests.filter((r) => r.error).length;
      const totalSize = requests.reduce((sum, r) => sum + r.size, 0);

      return ok({
        url: page.url(),
        duration: p.duration,
        totalRequests: requests.length,
        failedRequests: failedCount,
        slowRequests: slowCount,
        errorRequests: errorCount,
        totalSizeKB: Math.round(totalSize / 1024),
        requests: filtered,
        summary: `${requests.length} requests: ${failedCount} failed, ${slowCount} slow (>${p.slowThreshold ?? 3000}ms), ${errorCount} errors`,
        passed: failedCount === 0 && errorCount === 0,
      });
    } finally {
      await client.detach().catch(() => {});
    }
  },
});

export const perfCheckCommand = registerCommand({
  name: 'perf',
  description: 'Audit page performance metrics — load time, FCP, LCP, CLS, TTFB, resource sizes',
  scope: 'page',
  parameters: z.object({
    url: z.string().optional().describe('URL to navigate (uses current page if omitted)'),
    iterations: z.number().optional().default(1).describe('Number of iterations to average'),
  }),
  result: z.object({
    url: z.string(),
    iterations: z.number(),
    metrics: z.record(z.unknown()),
    allIterations: z.array(z.record(z.unknown())).optional(),
    passed: z.boolean(),
    summary: z.string(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const { page } = ctx;
    const allMetrics: Array<Record<string, unknown>> = [];

    for (let i = 0; i < p.iterations; i++) {
      if (p.url) {
        await page.goto(p.url, { waitUntil: 'load' });
      } else {
        await page.reload({ waitUntil: 'load' });
      }

      const metrics = await page.evaluate<Record<string, unknown>>(() => {
        const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
        const nav = navEntries.length > 0 ? navEntries[navEntries.length - 1] : null;
        const paint = performance.getEntriesByType('paint');

        const fcp = paint.find((e) => e.name === 'first-contentful-paint');
        const lcp = paint.find((e) => e.name === 'largest-contentful-paint');

        const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        const resourceStats: {
          total: number;
          totalSize: number;
          byType: Record<string, { count: number; size: number; avgDuration: number }>;
        } = { total: resources.length, totalSize: 0, byType: {} };

        resources.forEach((r) => {
          const type = r.initiatorType || 'other';
          if (!resourceStats.byType[type]) {
            resourceStats.byType[type] = { count: 0, size: 0, avgDuration: 0 };
          }
          resourceStats.byType[type].count++;
          resourceStats.byType[type].size += r.transferSize || 0;
          resourceStats.byType[type].avgDuration += r.duration;
        });

        Object.keys(resourceStats.byType).forEach((type) => {
          const stat = resourceStats.byType[type];
          stat.avgDuration = Math.round(stat.avgDuration / stat.count);
        });

        return {
          ttfb: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
          domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : null,
          loadComplete: nav ? Math.round(nav.loadEventEnd - nav.startTime) : null,
          fcp: fcp ? Math.round(fcp.startTime) : null,
          lcp: lcp ? Math.round(lcp.startTime) : null,
          domInteractive: nav ? Math.round(nav.domInteractive - nav.startTime) : null,
          transferSize: nav?.transferSize || 0,
          decodedBodySize: nav?.decodedBodySize || 0,
          resourceStats,
        };
      });

      allMetrics.push(metrics);

      if (i < p.iterations - 1) {
        await page.evaluate(() => {
          performance.clearResourceTimings();
        });
      }
    }

    const numericKeys = ['ttfb', 'domContentLoaded', 'loadComplete', 'fcp', 'lcp', 'domInteractive', 'transferSize', 'decodedBodySize'];

    const avgMetrics: Record<string, unknown> = allMetrics.length === 1
      ? allMetrics[0]
      : (() => {
          const avg: Record<string, unknown> = {};
          numericKeys.forEach((key) => {
            const values = allMetrics.map((m) => m[key]).filter((v): v is number => typeof v === 'number');
            avg[key] = values.length > 0 ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null;
          });
          const resourceStats = allMetrics[allMetrics.length - 1]?.resourceStats;
          if (resourceStats) avg.resourceStats = resourceStats;
          return avg;
        })();

    return ok({
      url: page.url(),
      iterations: p.iterations,
      metrics: avgMetrics,
      allIterations: p.iterations > 1 ? allMetrics : undefined,
      passed: true,
      summary: `TTFB: ${avgMetrics.ttfb}ms | FCP: ${avgMetrics.fcp}ms | Load: ${avgMetrics.loadComplete}ms`,
    });
  },
});

export const healthCheckCommand = registerCommand({
  name: 'health',
  description: 'Comprehensive page health check — broken links, missing images, console errors, SEO issues',
  scope: 'page',
  parameters: z.object({
    url: z.string().optional().describe('URL to check'),
    checkLinks: z.boolean().optional().default(true).describe('Check for broken links'),
    checkImages: z.boolean().optional().default(true).describe('Check for missing/broken images'),
    checkMeta: z.boolean().optional().default(true).describe('Check SEO meta tags'),
    maxLinks: z.number().optional().default(50).describe('Max links to check'),
  }),
  result: z.object({
    url: z.string(),
    title: z.string(),
    passed: z.boolean(),
    totalIssues: z.number(),
    errors: z.number(),
    warnings: z.number(),
    info: z.number(),
    issues: z.array(z.record(z.unknown())),
    summary: z.string(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const { page } = ctx;

    if (p.url) {
      await page.goto(p.url, { waitUntil: 'load' });
    }

    const result = await page.evaluate<{ issues: Array<{ severity: string; category: string; message: string; element?: string }>; url: string; title: string }>(async (args: { checkLinks: boolean; checkImages: boolean; checkMeta: boolean; maxLinks: number }) => {
      const issues: Array<{ severity: 'error' | 'warning' | 'info'; category: string; message: string; element?: string }> = [];

      if (args.checkImages) {
        document.querySelectorAll('img').forEach((img) => {
          if (!img.complete || img.naturalWidth === 0) {
            issues.push({
              severity: 'error',
              category: 'images',
              message: `Broken image: ${img.src || img.alt || 'no src'}`,
              element: img.outerHTML.slice(0, 100),
            });
          }
          if (!img.alt) {
            issues.push({
              severity: 'warning',
              category: 'accessibility',
              message: `Image missing alt: ${img.src?.slice(0, 80)}`,
              element: img.outerHTML.slice(0, 100),
            });
          }
        });
      }

      if (args.checkMeta) {
        const title = document.querySelector('title')?.textContent?.trim();
        if (!title) {
          issues.push({ severity: 'error', category: 'seo', message: 'Missing <title> tag' });
        } else if (title.length > 60) {
          issues.push({ severity: 'warning', category: 'seo', message: `Title too long (${title.length} chars): ${title}` });
        }

        const description = document.querySelector('meta[name="description"]')?.getAttribute('content');
        if (!description) {
          issues.push({ severity: 'warning', category: 'seo', message: 'Missing meta description' });
        } else if (description.length > 160) {
          issues.push({ severity: 'warning', category: 'seo', message: `Description too long (${description.length} chars)` });
        }

        const canonical = document.querySelector('link[rel="canonical"]');
        if (!canonical) {
          issues.push({ severity: 'info', category: 'seo', message: 'Missing canonical URL' });
        }

        const h1s = document.querySelectorAll('h1');
        if (h1s.length === 0) {
          issues.push({ severity: 'warning', category: 'seo', message: 'Missing H1 tag' });
        } else if (h1s.length > 1) {
          issues.push({ severity: 'warning', category: 'seo', message: `Multiple H1 tags (${h1s.length})` });
        }
      }

      if (args.checkLinks) {
        const links = Array.from(document.querySelectorAll('a[href]')).slice(0, args.maxLinks);

        for (const link of links) {
          const href = (link as HTMLAnchorElement).href;
          if (!href || href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('mailto:')) continue;

          try {
            const response = await fetch(href, { method: 'HEAD', mode: 'no-cors' });
            if (response.status >= 400 || response.status === 0) {
              issues.push({
                severity: 'error',
                category: 'links',
                message: `Broken link (${response.status}): ${href} — "${link.textContent?.trim()?.slice(0, 50) || ''}"`,
              });
            }
          } catch (err) {
            issues.push({
              severity: 'error',
              category: 'links',
              message: `Broken link (fetch error): ${href} — ${errMsg(err) || 'unknown'}`,
            });
          }
        }
      }

      const viewport = document.querySelector('meta[name="viewport"]');
      if (!viewport) {
        issues.push({ severity: 'warning', category: 'mobile', message: 'Missing viewport meta tag' });
      }

      if (!document.documentElement.lang) {
        issues.push({ severity: 'warning', category: 'accessibility', message: 'Missing lang attribute on <html>' });
      }

      return { issues, url: location.href, title: document.title };
    }, { checkLinks: p.checkLinks, checkImages: p.checkImages, checkMeta: p.checkMeta, maxLinks: p.maxLinks });

    const errors = result.issues.filter((i) => i.severity === 'error').length;
    const warnings = result.issues.filter((i) => i.severity === 'warning').length;

    return ok({
      url: result.url,
      title: result.title,
      passed: errors === 0,
      totalIssues: result.issues.length,
      errors,
      warnings,
      info: result.issues.filter((i) => i.severity === 'info').length,
      issues: result.issues,
      summary: `${result.issues.length} issues found (${errors} errors, ${warnings} warnings)`,
    });
  },
});
