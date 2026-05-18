import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import { writeFileSync } from 'fs';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

export const screenshotCommand = registerCommand({
  name: 'screenshot',
  description: 'Take a screenshot of the page or element',
  scope: 'page',
  parameters: z.object({
    selector: z.string().optional(),
    type: z.enum(['png', 'jpeg']).optional(),
    fullPage: z.boolean().optional(),
    output: z.string().optional(),
  }),
  result: z.union([
    z.object({
      data: z.string(),
      format: z.string(),
      size: z.number(),
    }),
    z.object({
      output: z.string(),
      format: z.string(),
      size: z.number(),
    }),
  ]),
  handler: async (p, ctx: BrowserCommandContext) => {
    const options: Record<string, unknown> = {
      type: p.type || 'png',
      fullPage: p.fullPage || false,
    };
    let buffer: Buffer;
    if (p.selector) {
      buffer = await ctx.page.locator(p.selector).first().screenshot(options);
    } else {
      buffer = await ctx.page.screenshot(options);
    }
    if (p.output) {
      writeFileSync(p.output, buffer);
      return ok({
        output: p.output,
        format: p.type || 'png',
        size: buffer.length,
      });
    }
    return ok({
      data: buffer.toString('base64'),
      format: p.type || 'png',
      size: buffer.length,
    });
  },
});

export const snapshotCommand = registerCommand({
  name: 'snapshot',
  description: 'Get a snapshot of page elements',
  scope: 'page',
  parameters: z.object({
    selector: z.string().optional(),
    interactiveOnly: z.boolean().optional(),
  }),
  result: z.object({
    elements: z.array(z.object({
      ref: z.string(),
      tag: z.string(),
      role: z.string(),
      text: z.string(),
      attrs: z.record(z.string()),
    })),
  }),
  handler: async (p, ctx: BrowserCommandContext) => {
    const elements = await ctx.page.evaluate(
      (args) => {
        const { selector, interactiveOnly } = args;
        const root = selector ? document.querySelector(selector) : document.body;
        if (!root) return [];

        const interactiveTags = new Set([
          'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'DETAILS',
        ]);
        const interactiveRoles = new Set([
          'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
          'searchbox', 'slider', 'switch', 'tab', 'menuitem', 'option',
        ]);

        const result: Array<{
          ref: string;
          tag: string;
          role: string;
          text: string;
          attrs: Record<string, string>;
        }> = [];
        let idx = 0;

        function walk(el: Element, path: string): void {
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role') ?? '';
          const text = (el.textContent ?? '').substring(0, 200).trim();
          const attrs: Record<string, string> = {};
          for (const attr of Array.from(el.attributes)) {
            if (['class', 'style'].includes(attr.name)) continue;
            attrs[attr.name] = attr.value;
          }

          const isInteractive =
            interactiveTags.has(el.tagName) ||
            interactiveRoles.has(role) ||
            el.hasAttribute('tabindex') ||
            el.hasAttribute('onclick') ||
            tag === 'a' ||
            tag === 'button';

          if (!interactiveOnly || isInteractive) {
            result.push({ ref: path, tag, role, text, attrs });
          }

          for (const child of Array.from(el.children)) {
            idx++;
            walk(child, `@${idx}`);
          }
        }

        walk(root, '@0');
        return result;
      },
      { selector: p.selector || 'body', interactiveOnly: p.interactiveOnly || false }
    );
    return ok({ elements });
  },
});
