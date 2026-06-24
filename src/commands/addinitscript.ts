import { z } from 'zod';
import { ok } from '@dyyz1993/xcli-core';
import { readFileSync } from 'node:fs';
import type { BrowserCommandContext } from '../context.js';
import { registerCommand } from './command-registry.js';
import { registerCommandDefinition } from '../chain-parser.js';

const InitScriptParams = z.object({
  script: z.string().optional(),
  file: z.string().optional(),
  stdin: z.boolean().optional(),
  name: z.string().optional(),
  list: z.boolean().optional(),
  remove: z.union([z.string(), z.boolean()]).optional(),
  base64: z.string().optional(),
});

type InitScriptParamType = z.infer<typeof InitScriptParams>;

const registeredScripts = new Map<string, string>();

function resolveScriptContent(params: InitScriptParamType): string | null {
  if (params.base64) {
    return Buffer.from(params.base64, 'base64').toString('utf-8');
  }

  if (params.file) {
    return readFileSync(params.file, 'utf-8');
  }

  if (params.stdin) {
    return null;
  }

  if (params.script) {
    return params.script;
  }

  return null;
}

async function readStdin(): Promise<string> {
  const { createReadStream } = await import('node:fs');
  const { createInterface } = await import('node:readline');
  return new Promise<string>((resolve, reject) => {
    const lines: string[] = [];
    const rl = createInterface({ input: createReadStream('/dev/stdin') });
    rl.on('line', (line: string) => lines.push(line));
    rl.on('close', () => resolve(lines.join('\n')));
    rl.on('error', reject);
  });
}

export const addInitScriptCommand = registerCommand({
  name: 'addinitscript',
  description: 'Add an initialization script that runs on every page load',
  scope: 'page',
  parameters: InitScriptParams,
  result: z.object({
    scripts: z.array(z.object({ name: z.string(), size: z.number(), preview: z.string() })).optional(),
    removed: z.string().optional(),
    existed: z.boolean().optional(),
    error: z.string().optional(),
    registered: z.string().optional(),
    hint: z.string().optional(),
    executedImmediately: z.boolean().optional(),
  }).passthrough(),
  handler: async (params: InitScriptParamType, ctx: BrowserCommandContext): Promise<unknown> => {
    if (params.list) {
      const scripts = Array.from(registeredScripts.entries()).map(([n, content]) => ({
        name: n,
        size: content.length,
        preview: content.slice(0, 80),
      }));
      return ok({ scripts });
    }

    if (params.remove && typeof params.remove === 'string') {
      const existed = registeredScripts.delete(params.remove);
      return ok({ removed: params.remove, existed });
    }

    // Also support: --remove (boolean) + --name <name>
    const removeTarget = (typeof params.remove === 'string' ? params.remove : null) ||
      (params.name && !resolveScriptContent(params) ? params.name : null);
    if (removeTarget && !resolveScriptContent(params)) {
      const existed = registeredScripts.delete(removeTarget);
      return ok({ removed: removeTarget, existed });
    }

    let content = params.stdin ? await readStdin() : resolveScriptContent(params);

    if (!content) {
      return ok({ error: 'No script content provided. Use --script, --file, --stdin, or --base64' });
    }

    const scriptName = params.name ?? `script-${Date.now()}`;
    registeredScripts.set(scriptName, content);

    await ctx.browserContext.addInitScript(content);

    try {
      await ctx.page.evaluate(content);
    } catch {
      return ok({
        registered: scriptName,
        hint: 'Script registered for future page loads; immediate execution skipped (page may not be ready)',
      });
    }

    return ok({ registered: scriptName, executedImmediately: true });
  },
});

registerCommandDefinition('addinitscript', ['script']);
