import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'web-automation',
    url: '',
    description: '通用网页自动化 - 搜索、提取、分页采集',
    requiresLogin: false,
  });

  site.command('extract', {
    description: '从指定URL提取页面结构化内容',
    scope: 'browser',
    result: z.array(z.object({ tag: z.string(), text: z.string(), href: z.string().optional(), src: z.string().optional() }).passthrough()),
    parameters: z.object({
      url: z.string().describe('目标页面URL'),
      selector: z.string().optional().default('body').describe('CSS选择器，默认body'),
      fields: z
        .array(
          z.object({
            name: z.string().describe('字段名'),
            selector: z.string().describe('CSS选择器'),
            attribute: z.string().optional().describe('提取属性值(如href)，留空则取textContent'),
          })
        )
        .optional()
        .describe('自定义提取字段列表'),
    }),
    examples: [
      {
        cmd: 'xbrowser web-automation extract --url "https://news.ycombinator.com" --fields \'[{"name":"title","selector":".titleline > a"},{"name":"link","selector":".titleline > a","attribute":"href"}]\'',
        description: '提取 Hacker News 标题和链接',
      },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      const { url, selector, fields } = params;

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle');

      if (fields && fields.length > 0) {
        const data = await page.evaluate((fieldDefs: typeof fields) => {
          return fieldDefs.map((field) => {
            const elements = document.querySelectorAll(field.selector);
            return {
              field: field.name,
              values: Array.from(elements).map((el) => {
                if (field.attribute) {
                  return el.getAttribute(field.attribute) || '';
                }
                return el.textContent?.trim() || '';
              }),
            };
          });
        }, fields);

        return {
          data,
          tips: [`从 ${url} 提取了 ${fields.length} 个字段`],
        };
      }

      const content = await page.evaluate((sel: string) => {
        const root = document.querySelector(sel) || document.body;
        const items: Array<{ tag: string; text: string; href?: string; src?: string }> = [];

        const walk = (el: Element) => {
          const tag = el.tagName.toLowerCase();
          const text = el.textContent?.trim().slice(0, 500) || '';
          const item: (typeof items)[0] = { tag, text };

          if (tag === 'a') item.href = (el as HTMLAnchorElement).href;
          if (tag === 'img') item.src = (el as HTMLImageElement).src;

          if (text && !['script', 'style', 'noscript'].includes(tag)) {
            items.push(item);
          }
        };

        root.querySelectorAll('*').forEach(walk);
        return items;
      }, selector);

      return ok(content, [`从 ${url} 的 "${selector}" 中提取了 ${content.length} 个元素`]);
    },
  });

  site.command('paginate', {
    description: '分页采集：自动翻页并提取数据',
    scope: 'browser',
    result: z.array(z.record(z.string())),
    parameters: z.object({
      url: z.string().describe('起始页URL'),
      nextSelector: z
        .string()
        .default('.n, .next, [rel="next"]')
        .describe('下一页按钮选择器'),
      itemSelector: z.string().describe('每条数据的容器选择器'),
      fields: z
        .array(
          z.object({
            name: z.string(),
            selector: z.string(),
            attribute: z.string().optional(),
          })
        )
        .describe('要提取的字段'),
      maxPages: z.number().optional().default(5).describe('最大翻页数'),
      delay: z.number().optional().default(1000).describe('翻页间隔(ms)'),
    }),
    examples: [
      {
        cmd: 'xbrowser web-automation paginate --url "https://example.com/list" --item-selector ".item" --fields \'[{"name":"title","selector":"h3"}]\' --max-pages 3',
        description: '翻页采集3页数据',
      },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      const { url, nextSelector, itemSelector, fields, maxPages, delay } = params;
      const allData: Record<string, string>[] = [];

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      for (let p = 1; p <= maxPages; p++) {
        const pageData = await page.evaluate(
          (opts: { itemSel: string; fieldDefs: typeof fields }) => {
            const items = document.querySelectorAll(opts.itemSel);
            return Array.from(items).map((item) => {
              const row: Record<string, string> = {};
              for (const field of opts.fieldDefs) {
                const el = item.querySelector(field.selector);
                if (el) {
                  row[field.name] = field.attribute
                    ? el.getAttribute(field.attribute) || ''
                    : el.textContent?.trim() || '';
                } else {
                  row[field.name] = '';
                }
              }
              return row;
            });
          },
          { itemSel: itemSelector, fieldDefs: fields }
        );

        allData.push(...pageData);

        if (p < maxPages) {
          const nextBtn = page.locator(nextSelector).first();
          const isVisible = await nextBtn.isVisible().catch(() => false);
          if (!isVisible) break;

          await nextBtn.click();
          await page.waitForLoadState('domcontentloaded');
          await page.waitForTimeout(delay);
        }
      }

      return ok(allData, [
          `采集 ${Math.min(maxPages, Math.ceil(allData.length / 10))} 页，共 ${allData.length} 条数据`,
          `字段: ${fields.map((f) => f.name).join(', ')}`,
        ]);
    },
  });

  site.command('fill-and-submit', {
    description: '填写表单并提交',
    scope: 'browser',
    result: z.object({ submittedUrl: z.string(), resultUrl: z.string(), resultTitle: z.string(), fieldsFilled: z.number() }).passthrough(),
    parameters: z.object({
      url: z.string().describe('表单页面URL'),
      fields: z
        .array(
          z.object({
            selector: z.string().describe('输入框选择器'),
            value: z.string().describe('填入值'),
          })
        )
        .describe('表单字段列表'),
      submitSelector: z
        .string()
        .default('button[type="submit"], input[type="submit"]')
        .describe('提交按钮选择器'),
      waitForNavigation: z.boolean().optional().default(true).describe('是否等待页面跳转'),
    }),
    examples: [
      {
        cmd: 'xbrowser web-automation fill-and-submit --url "https://example.com/form" --fields \'[{"selector":"#name","value":"John"},{"selector":"#email","value":"john@test.com"}]\' --submit-selector "#submit"',
        description: '填写并提交表单',
      },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      const { url, fields: formFields, submitSelector, waitForNavigation } = params;

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle');

      for (const field of formFields) {
        await page.fill(field.selector, field.value);
      }

      if (waitForNavigation) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
          page.click(submitSelector),
        ]);
      } else {
        await page.click(submitSelector);
      }

      await page.waitForLoadState('networkidle');

      const resultUrl = page.url();
      const resultTitle = await page.title();

      return ok({
          submittedUrl: url,
          resultUrl,
          resultTitle,
          fieldsFilled: formFields.length,
        }, [`表单已提交，跳转到: ${resultUrl}`]);
    },
  });

  site.command('screenshot', {
    description: '截取网页截图',
    scope: 'browser',
    result: z.object({ url: z.string(), fullPage: z.boolean(), imageBase64: z.string(), size: z.number() }).passthrough(),
    parameters: z.object({
      url: z.string().describe('目标URL'),
      fullPage: z.boolean().optional().default(false).describe('是否全页截图'),
      selector: z.string().optional().describe('只截取指定元素'),
    }),
    examples: [
      {
        cmd: 'xbrowser web-automation screenshot --url "https://example.com" --full-page true',
        description: '全页截图',
      },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page | undefined;
      if (!page) throw new Error('需要浏览器页面上下文');

      const { url, fullPage, selector } = params;

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle');

      let base64: string;

      if (selector) {
        const element = page.locator(selector);
        const buffer = await element.screenshot();
        base64 = buffer.toString('base64');
      } else {
        const buffer = await page.screenshot({ fullPage });
        base64 = buffer.toString('base64');
      }

      return ok({
          url,
          fullPage,
          imageBase64: base64,
          size: base64.length,
        }, [`截图完成，大小 ${(base64.length / 1024).toFixed(1)}KB`]);
    },
  });
}
