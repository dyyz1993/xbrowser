import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { detectCaptcha, waitForCaptchaSolved } from '../lib/captcha.js';
import type { Page } from '../browser-shim.js';

export const clickCommand = registerCommand({
  name: 'click',
  description: 'Click on element',
  scope: 'element',
  selectorParams: ['selector'],
  parameters: z.object({
    selector: z.string(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    clickCount: z.number().optional(),
    delay: z.number().optional(),
    waitCaptcha: z.boolean().optional().default(false).describe('点击后检测 captcha 并等待解决'),
    waitCaptchaTimeout: z.number().int().optional().default(180000).describe('Captcha 等待超时（毫秒）'),
  }),
  result: z.object({
    selector: z.string(),
    newTab: z.object({ url: z.string(), title: z.string() }).optional(),
    captcha: z.any().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    // 用 Promise 监听新 Tab 打开事件（target="_blank" 链接等）
    let detectedNewPage: Page | undefined;
    let cleanup: (() => void) | undefined;

    if (ctx.browserContext?.on) {
      const pagePromise = new Promise<Page | undefined>((resolve) => {
        const timer = setTimeout(() => {
          ctx.browserContext.off('page', handler);
          resolve(undefined);
        }, 3000);
        const handler = (page: Page) => {
          clearTimeout(timer);
          ctx.browserContext.off('page', handler);
          resolve(page);
        };
        ctx.browserContext.on('page', handler);
      });
      cleanup = () => {
        // Force resolve to clean up timer if click throws
      };
      await ctx.page.click(p.selector, {
        button: p.button,
        clickCount: p.clickCount,
        delay: p.delay,
        force: true,
        timeout: 10000,
      });
      detectedNewPage = await pagePromise;
    } else {
      await ctx.page.click(p.selector, {
        button: p.button,
        clickCount: p.clickCount,
        delay: p.delay,
        force: true,
        timeout: 10000,
      });
    }

    void cleanup;

    const page = ctx.page;

    if (detectedNewPage) {
      const np = detectedNewPage;
      await np.waitForLoadState('domcontentloaded').catch(() => {});
      const newUrl = np.url();
      const newTitle = (await np.title().catch(() => '')) as string;
      const result = ok({
        selector: p.selector,
        newTab: { url: newUrl, title: newTitle },
      });
      result.tips = [`新 Tab 已打开: ${newTitle ? newTitle + ' — ' : ''}${newUrl}`];
      return result;
    }

    const captchaInfo = await detectCaptcha(page);
    if (captchaInfo) {
      const tips: string[] = [
        `⚠️ CAPTCHA detected: ${captchaInfo.type}`,
        `Please solve it in the browser or viewer`,
      ];
      if (p.waitCaptcha) {
        const solved = await waitForCaptchaSolved(page, captchaInfo, p.waitCaptchaTimeout || 180000);
        tips.push(solved ? '✅ CAPTCHA solved!' : '❌ CAPTCHA timeout');
      }
      const result = ok({ selector: p.selector, captcha: captchaInfo });
      result.tips = tips;
      return result;
    }

    return ok({ selector: p.selector });
  },
});

export const fillCommand = registerCommand({
  name: 'fill',
  description: 'Fill input field',
  scope: 'element',
  selectorParams: ['selector'],
  parameters: z.object({
    selector: z.string(),
    value: z.string(),
    clear: z.boolean().optional(),
  }),
  result: z.object({
    selector: z.string(),
    value: z.string(),
    cleared: z.boolean(),
    reactMode: z.boolean().optional(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const page = ctx.page;

    if (p.clear) {
      await page.fill(p.selector, '', { force: true, timeout: 10000 });
    }

    const isReact = await page.evaluate(() => {
      if (document.querySelector('[data-reactroot]') || document.querySelector('[data-reactid]')) return true;
      if ((window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__) return true;
      const scripts = document.querySelectorAll('script[src]');
      for (const s of scripts) {
        const src = s.getAttribute('src') || '';
        if (src.includes('react') || src.includes('react-dom')) return true;
      }
      const sample = Array.from(document.querySelectorAll('*')).slice(0, 50);
      return sample.some(el => {
        const keys = Object.keys(el);
        return keys.some(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      });
    }).catch(() => false);

    if (isReact) {
      await page.click(p.selector, { force: true, timeout: 10000 });
      await page.fill(p.selector, '', { force: true, timeout: 10000 });
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Backspace');
      await page.type(p.selector, p.value, { delay: 10 });
    } else {
      await page.fill(p.selector, p.value, { force: true, timeout: 10000 });
    }

    return ok({ selector: p.selector, value: p.value, cleared: p.clear || false, reactMode: !!isReact });
  },
});

export const typeCommand = registerCommand({
  name: 'type',
  description: 'Type text into element',
  scope: 'element',
  selectorParams: ['selector'],
  parameters: z.object({
    selector: z.string(),
    text: z.string(),
    delay: z.number().optional(),
  }),
  result: z.object({
    selector: z.string(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.type(p.selector, p.text, { delay: p.delay, timeout: 10000 });
    return ok({ selector: p.selector });
  },
});

export const pressCommand = registerCommand({
  name: 'press',
  description: 'Press a key',
  scope: 'element',
  selectorParams: ['selector'],
  parameters: z.object({
    selector: z.string().optional(),
    key: z.string(),
    delay: z.number().optional(),
  }),
  result: z.object({
    key: z.string(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.press(p.selector || 'body', p.key, { timeout: 10000 });
    return ok({ key: p.key });
  },
});

export const selectCommand = registerCommand({
  name: 'select',
  description: 'Select option in dropdown',
  scope: 'element',
  selectorParams: ['selector'],
  parameters: z.object({
    selector: z.string(),
    value: z.union([z.string(), z.array(z.string())]),
  }),
  result: z.object({
    selector: z.string(),
    value: z.union([z.string(), z.array(z.string())]),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const values = typeof p.value === 'string' ? [p.value] : p.value;
    await ctx.page.selectOption(p.selector, values);
    return ok({ selector: p.selector, value: p.value });
  },
});

export const checkCommand = registerCommand({
  name: 'check',
  description: 'Check checkbox or radio',
  scope: 'element',
  selectorParams: ['selector'],
  parameters: z.object({
    selector: z.string(),
  }),
  result: z.object({
    selector: z.string(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.check(p.selector, { timeout: 10000 });
    return ok({ selector: p.selector });
  },
});

export const hoverCommand = registerCommand({
  name: 'hover',
  description: 'Hover over element',
  scope: 'element',
  selectorParams: ['selector'],
  parameters: z.object({
    selector: z.string(),
    modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).optional(),
  }),
  result: z.object({
    selector: z.string(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.hover(p.selector, { timeout: 10000 });
    return ok({ selector: p.selector });
  },
});

export const dblclickCommand = registerCommand({
  name: 'dblclick',
  description: 'Double click on element',
  scope: 'element',
  selectorParams: ['selector'],
  parameters: z.object({
    selector: z.string(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    delay: z.number().optional(),
  }),
  result: z.object({
    selector: z.string(),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    await ctx.page.dblclick(p.selector, {
      button: p.button,
      delay: p.delay,
      force: true,
      timeout: 10000,
    });
    return ok({ selector: p.selector });
  },
});
