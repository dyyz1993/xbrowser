/**
 * Shared schemas and helpers for search-image plugins.
 *
 * All image search plugins share the same result schema and most of the
 * parameter schema. This module eliminates ~420 lines of duplication
 * across 28+ plugins.
 */
import { z } from 'zod/v4';
import { ok, fail } from '@dyyz1993/xcli-core';

// ─── Result Schema ──────────────────────────────────────────────────────────

/** Single image result item */
export const imageResultItemSchema = z.object({
  title: z.string(),
  thumbnailUrl: z.string(),
  sourceUrl: z.string(),
  originalUrl: z.string().optional(),
  width: z.number(),
  height: z.number(),
  format: z.string().optional(),
  sourceSite: z.string(),
  fileSize: z.string().optional(),
}).passthrough();

/** Standard search-image result envelope */
export const searchImageResultSchema = z.object({
  query: z.string(),
  engine: z.string(),
  results: z.array(imageResultItemSchema),
  total: z.number().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
}).passthrough();

// ─── Parameter Schemas ──────────────────────────────────────────────────────

/** Base parameters shared by all search-image plugins */
export const baseSearchParams = {
  query: z.string().describe('Search query'),
  limit: z.number().optional().default(10),
  timeout: z.number().optional().default(20000),
};

/** Extended parameters for plugins that support color/size/type filters */
export const extendedSearchParams = {
  ...baseSearchParams,
  color: z.string().optional(),
  size: z.enum(['any', 'large', 'medium', 'small', 'icon']).optional().default('any'),
  type: z.enum(['photo', 'clipart', 'lineart', 'animated', 'vector']).optional(),
};

// ─── Helpers ────────────────────────────────────────────────────────────────

type Page = import('../types').Page;

/** Extract the Page object from params or context */
export function getPage(params: Record<string, unknown>, ctx: Record<string, unknown>): Page {
  const page = (params.page as Page) || (ctx as Record<string, unknown>).page as Page;
  if (!page) throw new Error('需要浏览器页面');
  return page;
}

/** Scroll the page to load more content */
export async function scrollPage(page: Page, times: number, delay = 800): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(delay);
  }
}

/** Build a standard ok() result for search-image commands */
export function buildResult(
  query: string,
  engine: string,
  results: Array<Record<string, unknown>>,
  tip?: string,
) {
  return ok(
    { query, engine, results, total: results.length, timestamp: Date.now() },
    tip ?? `${engine} "${query}"，共 ${results.length} 张`,
  );
}

/** Build a standard fail() result for search-image commands */
export function buildFail(error: unknown, engine: string) {
  const msg = error instanceof Error ? error.message : '未知错误';
  return fail({ reason: msg }, `${engine} 搜索失败: ${msg}`);
}
