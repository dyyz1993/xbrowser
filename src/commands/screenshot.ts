import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

const SCREENSHOTS_DIR = join(homedir(), '.xbrowser', 'screenshots');

function ensureScreenshotsDir(): void {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function generateScreenshotPath(format: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  return join(SCREENSHOTS_DIR, `screenshot-${timestamp}-${random}.${ext}`);
}

export const screenshotCommand = registerCommand({
  name: 'screenshot',
  description: 'Take a screenshot of the page or element',
  scope: 'page',
  selectorParams: ['selector'],
  parameters: z.object({
    selector: z.string().optional(),
    type: z.enum(['png', 'jpeg']).optional(),
    fullPage: z.boolean().optional(),
    output: z.string().optional(),
    base64: z.boolean().optional().describe('Return base64 data instead of file path'),
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
    const format = p.type || 'png';
    const options: Record<string, unknown> = {
      type: format,
      fullPage: p.fullPage || false,
    };
    let buffer: Buffer;
    if (p.selector) {
      buffer = await ctx.page.locator(p.selector).first().screenshot(options);
    } else {
      buffer = await ctx.page.screenshot(options);
    }

    // --output: save to specified path
    if (p.output) {
      writeFileSync(p.output, buffer);
      return ok({
        output: p.output,
        format,
        size: buffer.length,
      });
    }

    // --base64: return inline data (for programmatic use, not recommended for CLI)
    if (p.base64) {
      return ok({
        data: buffer.toString('base64'),
        format,
        size: buffer.length,
      });
    }

    // Default: save to ~/.xbrowser/screenshots/ and return file path
    ensureScreenshotsDir();
    const screenshotPath = generateScreenshotPath(format);
    writeFileSync(screenshotPath, buffer);
    return ok({
      output: screenshotPath,
      format,
      size: buffer.length,
    });
  },
});
