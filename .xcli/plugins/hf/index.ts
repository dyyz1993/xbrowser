import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { JsonObject } from '../shared/json-types.js';


export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'hf',
    url: 'https://huggingface.co',
    description: 'Hugging Face - ML 模型、数据集、Spaces',
    requiresLogin: false,
  });
  site.command('models', {
    description: 'Search Hugging Face models',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search keyword'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://huggingface.co/api/models?search=${encodeURIComponent(p.query)}&sort=downloads&direction=-1&limit=${p.limit || 20}`;
            const data = await fetch(url, { headers: { 'User-Agent': 'xbrowser/1.0' } }).then(r => r.json()) as JsonObject;
            const models = Array.isArray(data) ? data : [];
            if (models.length === 0) return fail(`No models matched "${p.query}"`);
            return ok(models.slice(0, p.limit).map((m: any, i: number) => ({
              rank: i + 1,
              modelId: m.modelId ?? m.id ?? '',
              pipelineTag: m.pipeline_tag ?? '',
              downloads: m.downloads ?? 0,
              likes: m.likes ?? 0,
              lastModified: m.lastModified?.slice(0, 10) ?? '',
              url: `https://huggingface.co/${m.modelId ?? m.id}`,
            })));
    },
  });
  site.command('datasets', {
    description: 'Search Hugging Face datasets',
    loginRequired: 'none',
    scope: 'project',
    parameters: z.object({
      query: z.string().describe('Search keyword'),
            limit: z.coerce.number().optional().default(20).describe('Max results')
    }),
    handler: async (p, _ctx) => {
      const url = `https://huggingface.co/api/datasets?search=${encodeURIComponent(p.query)}&sort=downloads&direction=-1&limit=${p.limit || 20}`;
            const data = await fetch(url, { headers: { 'User-Agent': 'xbrowser/1.0' } }).then(r => r.json()) as JsonObject;
            const datasets = Array.isArray(data) ? data : [];
            if (datasets.length === 0) return fail(`No datasets matched "${p.query}"`);
            return ok(datasets.slice(0, p.limit).map((d: any, i: number) => ({
              rank: i + 1,
              id: d.id ?? '',
              downloads: d.downloads ?? 0,
              likes: d.likes ?? 0,
              lastModified: d.lastModified?.slice(0, 10) ?? '',
              url: `https://huggingface.co/datasets/${d.id}`,
            })));
    },
  });
}
