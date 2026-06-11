import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { dispatchPromo } from '../promo/index.js';

const promoParams = z.object({
  platform: z.enum(['devto', 'medium', 'csdn', 'juejin', 'quora']).describe('Target platform for promotion'),
  file: z.string().describe('Path to Markdown file to publish'),
  tags: z.string().optional().describe('Comma-separated tags'),
  title: z.string().optional().describe('Custom title (default: extracted from file first heading)'),
  search: z.string().optional().describe('Quora: search query to find questions'),
  cdpEndpoint: z.string().optional().describe('CDP endpoint for xbrowser'),
  session: z.string().optional().describe('xbrowser session name'),
}).refine(
  (data) => data.platform !== 'quora' || !!data.search,
  { message: 'Quora platform requires --search parameter' },
).refine(
  (data) => existsSync(resolve(data.file)),
  { message: 'File does not exist' },
);

export const promoCommand = registerCommand({
  name: 'promo',
  description: 'Publish promotional articles to various platforms (devto, medium, csdn, juejin, quora)',
  scope: 'project',
  parameters: promoParams,
  result: z.object({
    success: z.boolean(),
    url: z.string().optional(),
    error: z.string().optional(),
    platform: z.string(),
  }),
  handler: async (p, _ctx: BrowserCommandContext) => {
    const filePath = resolve(p.file);
    const content = readFileSync(filePath, 'utf-8');

    if (content.trim().length === 0) {
      return ok({
        success: false,
        error: `File is empty: ${filePath}`,
        platform: p.platform,
      });
    }

    const result = await dispatchPromo({
      platform: p.platform,
      file: filePath,
      tags: p.tags,
      title: p.title,
      search: p.search,
      cdpEndpoint: p.cdpEndpoint ?? _ctx.cdpEndpoint,
      session: p.session ?? p.platform,
    });

    return ok(result);
  },
});
