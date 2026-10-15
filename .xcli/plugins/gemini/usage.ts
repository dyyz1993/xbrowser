import { z } from 'zod/v4';
import type { CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

type Page = import('../types').Page;

export const usageResultSchema = z.object({
  plan: z.string().optional(),
  current: z.object({
    usedPercent: z.number(),
    resetAt: z.string().optional(),
  }),
  weekly: z.object({
    usedPercent: z.number(),
    resetAt: z.string().optional(),
  }),
  updatedAt: z.string().optional(),
  sourceUrl: z.string(),
}).passthrough();

interface UsageInfo {
  plan?: string;
  current: { usedPercent: number; resetAt?: string };
  weekly: { usedPercent: number; resetAt?: string };
  updatedAt?: string;
  sourceUrl: string;
}

export function parseUsageText(text: string, sourceUrl: string): UsageInfo {
  const compact = text.replace(/\s+/g, ' ');
  const between = (start: string, end: string): string => {
    const from = compact.indexOf(start);
    if (from < 0) return '';
    const to = compact.indexOf(end, from + start.length);
    return to < 0 ? '' : compact.slice(from + start.length, to);
  };
  const currentBlock = between('当前用量', '每周限额') || compact;
  const weeklyBlock = between('每周限额', 'Pro\n') || compact.slice(compact.indexOf('每周限额'));
  const percent = (value: string): number => {
    const match = value.match(/已使用\s*(\d+(?:\.\d+)?)\s*%/);
    return match ? Number(match[1]) : Number.NaN;
  };
  const reset = (value: string): string | undefined => {
    const match = value.match(/重置时间[:：]\s*([^%]+?)(?=\s*已使用|$)/);
    return match?.[1]?.trim();
  };

  const currentPercent = percent(currentBlock);
  const weeklyPercent = percent(weeklyBlock);
  if (!Number.isFinite(currentPercent) || !Number.isFinite(weeklyPercent)) {
    throw new Error('未能解析 Gemini 用量页，请确认已登录并停留在 /usage');
  }
  const plan = compact.match(/用量限额\s*(PRO|FREE|ULTRA)/i)?.[1];
  const updatedAt = compact.match(/(?:更新时间|刚刚更新)[:：]?\s*([^%]+?)(?=\s*当前用量|$)/)?.[1]?.trim();

  const info: UsageInfo = {
    current: { usedPercent: currentPercent, resetAt: reset(currentBlock) },
    weekly: { usedPercent: weeklyPercent, resetAt: reset(weeklyBlock) },
    sourceUrl,
  };
  if (plan) info.plan = plan;
  if (updatedAt) info.updatedAt = updatedAt;
  return info;
}

export async function usageCommandHandler(
  _params: Record<string, never>,
  ctx: CommandContext,
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
  if (!page) throw new Error('需要浏览器页面');
  try {
    const currentUrl = page.url() ?? '';
    if (!currentUrl.includes('gemini.google.com/usage')) {
      await page.goto('https://gemini.google.com/usage', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    const text = await page.evaluate(() => document.body?.innerText || '');
    const info = parseUsageText(text, page.url() ?? 'https://gemini.google.com/usage');
  return ok(info, ['数据来自当前登录的 Gemini 用量页']);
  } catch (error) {
    return fail(error instanceof Error ? error.message : '读取 Gemini 用量失败', [
      '请确认当前 Chrome 已登录 Gemini',
      '如页面结构变化，请重新打开 https://gemini.google.com/usage',
    ]);
  }
}
