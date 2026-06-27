import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';

const SCREENSHOTS_DIR = join(homedir(), '.xbrowser', 'screenshots');

function ensureScreenshotsDir(): void {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

/**
 * Ensure the parent directory of `filePath` exists (created recursively).
 * Lets users pass `--output output/sub/shot.png` without pre-creating the dir.
 * Returns an error message on failure instead of throwing.
 */
function ensureParentDir(filePath: string): string | null {
  const dir = dirname(filePath);
  if (dir === '.' || dir === '/') return null; // current dir / root — nothing to do
  try {
    mkdirSync(dir, { recursive: true });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
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

    // --output: save to specified path (creates parent dirs as needed)
    if (p.output) {
      const dirErr = ensureParentDir(p.output);
      if (dirErr) {
        return fail(`Cannot create directory for --output "${p.output}": ${dirErr}`);
      }
      try {
        writeFileSync(p.output, buffer, 'binary');
      } catch (err) {
        return fail(`Failed to write screenshot to "${p.output}": ${err instanceof Error ? err.message : String(err)}`);
      }
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
    writeFileSync(screenshotPath, buffer, 'binary');
    return ok({
      output: screenshotPath,
      format,
      size: buffer.length,
    });
  },
});
