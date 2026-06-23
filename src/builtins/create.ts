import * as fs from 'fs';
import * as path from 'path';
import type { BuiltinCommand, BuiltinContext } from './session.js';

export interface TemplateFile {
  path: string;
  content: string;
  skipIfExists?: boolean;
}

export interface ScaffoldTemplate {
  name: string;
  description: string;
  files: TemplateFile[];
}

const TEMPLATES: Record<string, ScaffoldTemplate> = {
  static: {
    name: 'static',
    description: 'Static page plugin with basic commands',
    files: [
      {
        path: 'index.ts',
        content: [
          `import { z } from 'zod';`,
          `import { ok } from '@dyyz1993/xcli-core';`,
          `import type { XCLIAPI } from '@dyyz1993/xcli-core';`,
          ``,
          `export default function (xcli: XCLIAPI): void {`,
          `  const site = xcli.createSite({`,
          `    name: '{{projectName}}',`,
          `    url: '',`,
          `  });`,
          ``,
          `  site.command('scrape', {`,
          `    description: 'Scrape data from the page',`,
          `    scope: 'page',`,
          `    parameters: z.object({ selector: z.string().optional() }),`,
          `    handler: async (params, ctx) => {`,
          `      const text = await ctx.page.evaluate(`,
          `        (sel: string) => document.querySelector(sel)?.textContent ?? '',`,
          `        params.selector || 'body'`,
          `      );`,
          `      return ok({ text });`,
          `    },`,
          `  });`,
          `}`,
        ].join('\n'),
      },
      {
        path: 'package.json',
        content: [
          `{`,
          `  "name": "xbrowser-plugin-{{projectName}}",`,
          `  "version": "1.0.0",`,
          `  "main": "index.ts",`,
          `  "type": "module",`,
          `  "dependencies": { "zod": "^3.24.0" },`,
          `  "peerDependencies": { "@dyyz1993/xcli-core": ">=1.0.0" },`,
          `  "xbrowser": {`,
          `    "name": "{{projectName}}",`,
          `    "description": "A static page plugin",`,
          `    "commands": ["scrape"]`,
          `  }`,
          `}`,
        ].join('\n'),
      },
    ],
  },
  dynamic: {
    name: 'dynamic',
    description: 'Dynamic plugin with navigation and interaction',
    files: [
      {
        path: 'index.ts',
        content: [
          `import { z } from 'zod';`,
          `import { ok } from '@dyyz1993/xcli-core';`,
          `import type { XCLIAPI } from '@dyyz1993/xcli-core';`,
          ``,
          `export default function (xcli: XCLIAPI): void {`,
          `  const site = xcli.createSite({`,
          `    name: '{{projectName}}',`,
          `    url: '',`,
          `  });`,
          ``,
          `  site.command('navigate', {`,
          `    description: 'Navigate to a URL',`,
          `    scope: 'browser',`,
          `    parameters: z.object({ url: z.string() }),`,
          `    handler: async (params, ctx) => {`,
          `      await ctx.page.goto(params.url);`,
          `      return ok({ url: params.url });`,
          `    },`,
          `  });`,
          ``,
          `  site.command('interact', {`,
          `    description: 'Interact with page elements',`,
          `    scope: 'page',`,
          `    parameters: z.object({ selector: z.string(), action: z.enum(['click', 'fill', 'hover']) }),`,
          `    handler: async (params, ctx) => {`,
          `      const page = ctx.page;`,
          `      switch (params.action) {`,
          `        case 'click': await page.click(params.selector); break;`,
          `        case 'fill': await page.fill(params.selector, ''); break;`,
          `        case 'hover': await page.hover(params.selector); break;`,
          `      }`,
          `      return ok({ action: params.action, selector: params.selector });`,
          `    },`,
          `  });`,
          `}`,
        ].join('\n'),
      },
      {
        path: 'package.json',
        content: [
          `{`,
          `  "name": "xbrowser-plugin-{{projectName}}",`,
          `  "version": "1.0.0",`,
          `  "main": "index.ts",`,
          `  "type": "module",`,
          `  "dependencies": { "zod": "^3.24.0" },`,
          `  "peerDependencies": { "@dyyz1993/xcli-core": ">=1.0.0" },`,
          `  "xbrowser": {`,
          `    "name": "{{projectName}}",`,
          `    "description": "A dynamic page plugin",`,
          `    "commands": ["navigate", "interact"]`,
          `  }`,
          `}`,
        ].join('\n'),
      },
    ],
  },
  login: {
    name: 'login',
    description: 'Plugin with login/logout support',
    files: [
      {
        path: 'index.ts',
        content: [
          `import { z } from 'zod';`,
          `import { ok } from '@dyyz1993/xcli-core';`,
          `import type { XCLIAPI } from '@dyyz1993/xcli-core';`,
          ``,
          `export default function (xcli: XCLIAPI): void {`,
          `  const site = xcli.createSite({`,
          `    name: '{{projectName}}',`,
          `    url: '',`,
          `    requiresLogin: true,`,
          `  });`,
          ``,
          `  site.command('check', {`,
          `    description: 'Check login status',`,
          `    scope: 'project',`,
          `    parameters: z.object({}),`,
          `    handler: async () => {`,
          `      const loggedIn = await site.isLoggedIn();`,
          `      return ok({ loggedIn });`,
          `    },`,
          `  });`,
          ``,
          `  site.login(async (ctx) => {`,
          `    await ctx.storage.set('auth_token', 'dummy');`,
          `  });`,
          ``,
          `  site.logout(async (ctx) => {`,
          `    await ctx.storage.delete('auth_token');`,
          `  });`,
          `}`,
        ].join('\n'),
      },
      {
        path: 'package.json',
        content: [
          `{`,
          `  "name": "xbrowser-plugin-{{projectName}}",`,
          `  "version": "1.0.0",`,
          `  "main": "index.ts",`,
          `  "type": "module",`,
          `  "dependencies": { "zod": "^3.24.0" },`,
          `  "peerDependencies": { "@dyyz1993/xcli-core": ">=1.0.0" },`,
          `  "xbrowser": {`,
          `    "name": "{{projectName}}",`,
          `    "description": "A plugin with login/logout support",`,
          `    "requiresLogin": true,`,
          `    "commands": ["check"]`,
          `  }`,
          `}`,
        ].join('\n'),
      },
    ],
  },
  api: {
    name: 'api',
    description: 'API integration plugin',
    files: [
      {
        path: 'index.ts',
        content: [
          `import { z } from 'zod';`,
          `import { ok } from '@dyyz1993/xcli-core';`,
          `import type { XCLIAPI } from '@dyyz1993/xcli-core';`,
          ``,
          `export default function (xcli: XCLIAPI): void {`,
          `  const site = xcli.createSite({`,
          `    name: '{{projectName}}',`,
          `    url: '',`,
          `  });`,
          ``,
          `  site.command('fetch', {`,
          `    description: 'Fetch data from API',`,
          `    scope: 'project',`,
          `    parameters: z.object({ endpoint: z.string(), method: z.enum(['GET', 'POST']).optional() }),`,
          `    handler: async (params) => {`,
          `      const method = params.method || 'GET';`,
          `      return ok({ endpoint: params.endpoint, method });`,
          `    },`,
          `  });`,
          ``,
          `  site.command('list-endpoints', {`,
          `    description: 'List available endpoints',`,
          `    scope: 'project',`,
          `    parameters: z.object({}),`,
          `    handler: async () => {`,
          `      return ok({ endpoints: ['/api/data', '/api/status'] });`,
          `    },`,
          `  });`,
          `}`,
        ].join('\n'),
      },
      {
        path: 'package.json',
        content: [
          `{`,
          `  "name": "xbrowser-plugin-{{projectName}}",`,
          `  "version": "1.0.0",`,
          `  "main": "index.ts",`,
          `  "type": "module",`,
          `  "dependencies": { "zod": "^3.24.0" },`,
          `  "peerDependencies": { "@dyyz1993/xcli-core": ">=1.0.0" },`,
          `  "xbrowser": {`,
          `    "name": "{{projectName}}",`,
          `    "description": "An API integration plugin",`,
          `    "commands": ["fetch", "list-endpoints"]`,
          `  }`,
          `}`,
        ].join('\n'),
      },
    ],
  },
};

function interpolate(tpl: string, variables: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (match, key: string) => variables[key] ?? match);
}

export const createBuiltin: BuiltinCommand = {
  name: 'create',
  description: 'Create a new plugin from template',
  help: {
    usage: 'xbrowser create <name> --template <type>',
    description: 'Scaffold a new plugin project from a template',
    options: [
      { name: '--template <type>', description: 'Template type: static, dynamic, login, api' },
      { name: '--force', description: 'Overwrite existing directory' },
    ],
    examples: [
      { cmd: 'xbrowser create my-plugin --template static', description: 'Create static plugin' },
      { cmd: 'xbrowser create my-api --template api', description: 'Create API plugin' },
    ],
  },
  execute: async (args, options, ctx: BuiltinContext) => {
    const projectName = args[0];
    if (!projectName) {
      console.error('Usage: xbrowser create <name> --template <type>');
      process.exit(1);
    }

    const templateName = (options['template'] as string) || 'static';
    const template = TEMPLATES[templateName];

    if (!template) {
      console.error(
        `Unknown template: ${templateName}. Available: ${Object.keys(TEMPLATES).join(', ')}`
      );
      process.exit(1);
    }

    const targetDir = path.isAbsolute(projectName) ? projectName : path.join(ctx.cwd, projectName);

    if (fs.existsSync(targetDir) && !options['force']) {
      console.error(`Directory "${projectName}" already exists. Use --force to overwrite.`);
      process.exit(1);
    }

    fs.mkdirSync(targetDir, { recursive: true });

    const variables: Record<string, string> = {
      projectName,
      ProjectName: projectName
        .split(/[-_\s]+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(''),
    };

    const generated: string[] = [];

    for (const file of template.files) {
      const filePath = path.join(targetDir, interpolate(file.path, variables));
      const content = interpolate(file.content, variables);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      generated.push(file.path);
    }

    console.log(`Plugin "${projectName}" created from "${templateName}" template`);
    console.log(`  Directory: ${targetDir}`);
    console.log(`  Files: ${generated.join(', ')}`);
  },
};

export function listTemplates(): Array<{ name: string; description: string }> {
  return Object.values(TEMPLATES).map((t) => ({ name: t.name, description: t.description }));
}
