---
name: xbrowser-plugin-dev
description: Develop and publish xbrowser browser automation plugins with best practices
version: 1.0.0
---

# xbrowser Plugin Development Skill

Enable AI coding agents to create, test, and publish xbrowser browser automation plugins.

## Quick Start

### 1. Create plugin directory

```bash
mkdir my-plugin && cd my-plugin
```

### 2. Create `index.ts`

```typescript
import { z } from 'zod';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'my-plugin',
    url: 'https://example.com',
  });

  site.command('hello', {
    description: 'Say hello',
    scope: 'project',
    parameters: z.object({ name: z.string().default('world') }),
    handler: async (params, _ctx) => ({
      ok: true as const,
      message: `Hello, ${params.name}!`,
    }),
  });
}
```

### 3. Create `package.json`

```json
{
  "name": "xbrowser-plugin-my-plugin",
  "version": "1.0.0",
  "description": "My xbrowser plugin",
  "main": "index.ts",
  "xbrowser": {
    "name": "My Plugin",
    "slug": "my-plugin",
    "description": "My xbrowser plugin",
    "commands": ["hello"],
    "tags": ["example"],
    "sites": ["example.com"]
  }
}
```

### 4. Test locally

```bash
xbrowser plugin install ./my-plugin
xbrowser plugin reload my-plugin
```

### 5. Publish to marketplace

```bash
xbrowser plugin login --token <api-key>
xbrowser plugin publish --dry-run   # validate first
xbrowser plugin publish             # publish for real
```

## Plugin Structure

```
my-plugin/
├── index.ts          # Entry point (required)
├── package.json      # Package metadata (required)
└── README.md         # Documentation (recommended)
```

### Entry Point Convention

The entry file must export a default function:

```typescript
import type { XCLIAPI } from '@dyyz1993/xbrowser';

export default function (xcli: XCLIAPI): void {
  // Register sites and commands here
}
```

### package.json xbrowser Metadata

The `xbrowser` field in package.json provides marketplace metadata:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | yes | Display name |
| slug | string | yes | URL-safe identifier (lowercase, hyphens) |
| description | string | yes | One-line description |
| version | string | no | Override package version |
| author | string | no | Author name |
| commands | string[] | no | List of command names |
| tags | string[] | no | Searchable tags |
| sites | string[] | no | Target website domains |
| homepage | string | no | Plugin homepage URL |
| license | string | no | Default: MIT |
| screenshot | string | no | Screenshot URL |

## Command Definition

### Basic Command

```typescript
site.command('command-name', {
  description: 'What this command does',
  scope: 'project',  // project | browser | page | element
  parameters: z.object({
    url: z.string().url(),
    selector: z.string().optional(),
  }),
  handler: async (params, ctx) => {
    return { ok: true as const, data: {} };
  },
});
```

### Scope Levels

- **project**: No browser needed, workspace-level operations
- **browser**: Requires a browser instance
- **page**: Requires an active page
- **element**: Requires a specific element selector

### Return Values

Always use discriminated union with `ok` field:

```typescript
// Success
return { ok: true as const, data: result };

// Failure
return { ok: false as const, error: 'Something went wrong' };
```

Never throw errors in handlers. Use `ok: false` instead.

## Page Operations

Inside page-scoped commands, access the browser page:

```typescript
handler: async (params, ctx) => {
  const page = ctx.page;
  
  await page.goto(params.url);
  await page.waitForSelector(params.selector);
  
  const title = await page.title();
  const content = await page.evaluate(() => document.body.innerText);
  
  return { ok: true as const, title, content };
}
```

## Best Practices

### 1. Use Zod for Parameters

Always define parameters with Zod schemas for validation:

```typescript
parameters: z.object({
  selector: z.string().min(1),
  timeout: z.number().positive().default(5000),
  verbose: z.boolean().default(false),
})
```

### 2. Handle Errors Gracefully

```typescript
handler: async (params, ctx) => {
  try {
    const result = await doSomething(ctx.page, params);
    return { ok: true as const, data: result };
  } catch (e) {
    return { 
      ok: false as const, 
      error: e instanceof Error ? e.message : 'Unknown error' 
    };
  }
}
```

### 3. Use Storage API for State

```typescript
// Read state
const state = await ctx.storage.get<PluginState>('my-key');

// Write state
await ctx.storage.set('my-key', { lastRun: Date.now() });
```

### 4. Type Safety

Never use `any`. Always provide specific types:

```typescript
// BAD
handler: async (params: any, ctx: any) => { ... }

// GOOD
handler: async (params: { url: string }, ctx: CommandContext) => { ... }
```

### 5. Keep Plugins Focused

One plugin per website/domain. Each command should do one thing well.

## Publishing Workflow

### Prerequisites

1. Register at the marketplace website
2. Get an API key from your developer settings

### Login

```bash
# Interactive login
xbrowser plugin login

# Token-based login
xbrowser plugin login --token your-api-key-here

# Custom registry
xbrowser plugin login --registry https://marketplace.xbrowser.dev
```

### Validate Before Publishing

```bash
xbrowser plugin publish --dry-run
```

This validates:
- `index.ts` exists and has default export
- `package.json` has required fields
- `xbrowser` metadata is complete
- Files are within size limits

### Publish

```bash
xbrowser plugin publish
```

The CLI will:
1. Read plugin files (excluding node_modules, .git, etc.)
2. Validate metadata
3. Package and upload to the marketplace
4. Return the marketplace URL

### Publish New Version

After updating your plugin:

1. Update `version` in `package.json`
2. Run `xbrowser plugin publish` again (auto-detects existing plugin)

### Check Status

```bash
xbrowser plugin whoami     # Check logged-in user
xbrowser plugin list       # List locally installed plugins
```

## Common Patterns

### Scraping Pattern

```typescript
site.command('scrape', {
  description: 'Scrape product data',
  scope: 'page',
  parameters: z.object({
    selector: z.string(),
    fields: z.array(z.string()),
  }),
  handler: async (params, ctx) => {
    const elements = await ctx.page.$$(params.selector);
    const results = [];
    
    for (const el of elements) {
      const item: Record<string, string> = {};
      for (const field of params.fields) {
        item[field] = await el.$eval(`[data-${field}]`, (e: Element) => 
          (e as HTMLElement).textContent?.trim() || ''
        ).catch(() => '');
      }
      results.push(item);
    }
    
    return { ok: true as const, data: results };
  },
});
```

### Form Filling Pattern

```typescript
site.command('fill-form', {
  description: 'Fill a form with data',
  scope: 'page',
  parameters: z.object({
    fields: z.record(z.string()),
    submit: z.boolean().default(false),
  }),
  handler: async (params, ctx) => {
    for (const [selector, value] of Object.entries(params.fields)) {
      await ctx.page.fill(selector, value);
    }
    
    if (params.submit) {
      await ctx.page.click('button[type="submit"]');
      await ctx.page.waitForNavigation();
    }
    
    return { ok: true as const };
  },
});
```

### Screenshot Pattern

```typescript
site.command('screenshot-element', {
  description: 'Screenshot a specific element',
  scope: 'page',
  parameters: z.object({
    selector: z.string(),
    fullPage: z.boolean().default(false),
  }),
  handler: async (params, ctx) => {
    const buffer = await ctx.page.screenshot({
      fullPage: params.fullPage,
    });
    
    return { 
      ok: true as const, 
      size: buffer.length,
      mimeType: 'image/png',
    };
  },
});
```

## File Size Limits

- Maximum plugin package: 5MB
- Maximum single file: 1MB
- Maximum files: 100

## Marketplace API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register developer account |
| POST | /api/auth/login | Login and get API token |
| GET | /api/auth/verify | Verify current token |
| POST | /api/plugins/publish | Publish plugin (multipart) |
| POST | /api/plugins/:slug/versions | Publish new version |
| GET | /api/plugins/:slug/tarball | Get tarball download info |
