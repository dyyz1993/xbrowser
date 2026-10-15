import { z } from 'zod/v4';
import type { CommandContext } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

type Page = import('../types').Page;

interface ImageHelpers {
  clickImageMode: (page: Page) => Promise<boolean>;
  typePrompt: (page: Page, prompt: string) => Promise<void>;
  submitPrompt: (page: Page) => Promise<void>;
  collectNewImages: (page: Page, beforeUrls: string[], timeoutMs: number) => Promise<string[]>;
  downloadImages: (urls: string[]) => Promise<string[]>;
}

const helpers: ImageHelpers = {
  clickImageMode: async () => false,
  typePrompt: async () => undefined,
  submitPrompt: async () => undefined,
  collectNewImages: async () => [],
  downloadImages: async () => [],
};

export function setImageHelpers(next: ImageHelpers): void {
  Object.assign(helpers, next);
}

export function imageCommandConfig() {
  return {
    description: '快速生成图片并下载到本地',
    scope: 'page' as const,
    loginRequired: 'required' as const,
    parameters: z.object({
      prompt: z.string().describe('图片描述提示词'),
      timeout: z.number().min(15).max(300).default(180).describe('等待生成秒数'),
      ratio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional().describe('宽高比提示'),
    }),
    examples: [
      { cmd: 'xbrowser gemini image --prompt "赛博朋克城市夜景"', description: '生成并下载图片' },
      { cmd: 'xbrowser --cdp 9221 gemini image --prompt "水彩猫" --ratio 16:9', description: '指定宽高比' },
    ],
    result: z.object({
      prompt: z.string(),
      urls: z.array(z.string()),
      localPaths: z.array(z.string()),
      count: z.number(),
    }).passthrough(),
  };
}

export async function imageCommandHandler(
  params: { prompt: string; timeout: number; ratio?: string },
  ctx: CommandContext,
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
  if (!page) throw new Error('需要浏览器页面');
  const tips = ['建议使用 --cdp 9221 连接已登录 Chrome'];
  try {
    const beforeUrls = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img'))
        .map((image) => (image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src)
        .filter((src) => src.startsWith('http'));
    }).catch(() => [] as string[]);

    const currentUrl = page.url() ?? '';
    if (!currentUrl.includes('gemini.google.com/app')) {
      await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    const fullPrompt = params.ratio
      ? `${params.prompt}\n\nAspect ratio: ${params.ratio}`
      : params.prompt;
    if (await helpers.clickImageMode(page)) {
      tips.push('已切换到图片模式');
      await new Promise((resolve) => setTimeout(resolve, 800));
    } else {
      tips.push('未找到图片模式按钮，已直接发送提示词');
    }

    await helpers.typePrompt(page, fullPrompt);
    await helpers.submitPrompt(page);
    const urls = await helpers.collectNewImages(page, beforeUrls, params.timeout * 1000);
    if (urls.length === 0) {
      return fail('未检测到生成图片', [
        ...tips,
        '请确认 Gemini 已登录且支持图片生成',
        '也可以增加 --timeout 后重试',
      ]);
    }

    const localPaths = await helpers.downloadImages(urls);
    return ok({
      prompt: params.prompt,
      urls,
      localPaths,
      count: localPaths.length,
    }, localPaths.length > 0 ? tips : [...tips, '图片已找到但下载失败，URL 仍可用']);
  } catch (error) {
    return fail(error instanceof Error ? error.message : '图片生成失败', tips);
  }
}
