import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

interface SsrDetectionResult {
  detected: boolean;
  framework?: string;
  variable?: string;
  dataKeys?: string[];
  tip?: string;
}

const SSR_VARIABLE_TO_FRAMEWORK: Record<string, string> = {
  __NEXT_DATA__: 'Next.js',
  __NUXT__: 'Nuxt.js',
  RENDER_DATA: 'Douyin/ByteDance',
  __INITIAL_STATE__: 'Generic SSR',
  __APP_DATA__: 'Generic SSR',
  __PRELOADED_STATE__: 'Generic SSR',
  __DATA__: 'Generic SSR',
  __SSR_DATA__: 'Generic SSR',
  __remixContext: 'Remix',
  __vite_ssr_data__: 'Vite SSR',
};

const SSR_VARIABLES = Object.keys(SSR_VARIABLE_TO_FRAMEWORK);

function buildTip(framework: string, variable: string): string {
  return `检测到 ${framework} SSR 页面，数据在 ${variable} 中，可直接提取`;
}

async function detectSsr(page: import('playwright').Page): Promise<SsrDetectionResult | undefined> {
  try {
    const result = await page.evaluate((vars) => {
      for (const varName of vars) {
        const value = (window as unknown as Record<string, unknown>)[varName];
        if (value != null && typeof value === 'object') {
          const keys = Object.keys(value as Record<string, unknown>).slice(0, 10);
          return { variable: varName, keys };
        }
      }
      return null;
    }, SSR_VARIABLES);

    if (!result) return undefined;

    const framework = SSR_VARIABLE_TO_FRAMEWORK[result.variable] ?? 'Unknown';
    return {
      detected: true,
      framework,
      variable: result.variable,
      dataKeys: result.keys,
      tip: buildTip(framework, result.variable),
    };
  } catch {
    return undefined;
  }
}

export const gotoCommand = registerCommand({
  name: 'goto',
  description: 'Navigate to URL',
  scope: 'page',
  parameters: z.object({
    url: z.string(),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const response = await ctx.page.goto(p.url, {
      waitUntil: p.waitUntil || 'domcontentloaded',
    });

    const ssr = await detectSsr(ctx.page);

    return ok({ url: p.url, status: response?.status(), ...(ssr ? { ssr } : {}) });
  },
});

export const backCommand = registerCommand({
  name: 'back',
  description: 'Go back in browser history',
  scope: 'page',
  handler: async (_p, ctx: BrowserCommandContext) => {
    await ctx.page.goBack();
    return ok({ url: ctx.page.url() });
  },
});

export const forwardCommand = registerCommand({
  name: 'forward',
  description: 'Go forward in browser history',
  scope: 'page',
  handler: async (_p, ctx: BrowserCommandContext) => {
    await ctx.page.goForward();
    return ok({ url: ctx.page.url() });
  },
});

export const refreshCommand = registerCommand({
  name: 'refresh',
  description: 'Refresh current page',
  scope: 'page',
  handler: async (_p, ctx: BrowserCommandContext) => {
    await ctx.page.reload();
    return ok({ url: ctx.page.url() });
  },
});

export const titleCommand = registerCommand({
  name: 'title',
  description: 'Get page title',
  scope: 'page',
  handler: async (_p, ctx: BrowserCommandContext) => {
    const title = await ctx.page.title();
    return ok({ title });
  },
});

export const urlCommand = registerCommand({
  name: 'url',
  description: 'Get current page URL',
  scope: 'page',
  handler: async (_p, ctx: BrowserCommandContext) => {
    return ok({ url: ctx.page.url() });
  },
});
