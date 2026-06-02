# Plugin Convention — Complete Development Guide

Detailed reference for xbrowser plugin development. Covers directory structure, package.json,
entry file patterns, result schema migration, loginConfig, and utility plugin exemptions.

**Related**: [../SKILL.md](../SKILL.md) for project overview, [lint-rules.md](lint-rules.md) for quality rules.

## Contents

- [Plugin Directory Structure](#plugin-directory-structure)
- [package.json Required Fields](#packagejson-required-fields)
- [index.ts Template](#indexts-template)
- [ok()/fail() Return Pattern](#okfail-return-pattern)
- [Result Schema: L0→L1→L2 Gradual Migration](#result-schema-l0l1l2-gradual-migration)
- [loginConfig for Website Plugins](#loginconfig-for-website-plugins)
- [requiresLogin Declaration](#requireslogin-declaration)
- [isLogin Detection Patterns](#islogin-detection-patterns)
- [Utility Plugins (Exempt from Naming Rules)](#utility-plugins-exempt-from-naming-rules)
- [Helper Functions](#helper-functions)

---

## Plugin Directory Structure

Plugins live in three scan directories (loaded in order):

```
./.xcli/plugins/          # Project-local plugins (primary)
~/.xcli/plugins/          # User-global plugins
~/.xbrowser/plugins/      # Legacy path (still scanned)
```

Each plugin is a directory containing at minimum `index.ts` and `package.json`:

```
.xcli/plugins/<name>/
├── index.ts          # Entry: export default function(api: XCLIAPI): void
└── package.json      # Metadata + xbrowser config
```

Complex plugins may have additional files:

```
.xcli/plugins/douyin/
├── index.ts          # Site setup + all commands
├── package.json      # Full metadata
├── shared.ts         # Shared helpers (optional)
└── types.ts          # Type definitions (optional)
```

**Naming rules**:
- Site plugins: `xbrowser-plugin-<slug>` (e.g. `xbrowser-plugin-douyin`)
- Utility plugins: exempt from prefix (e.g. `diff`, `assert`, `image`)
- Directory name = command prefix for site commands

---

## package.json Required Fields

Every plugin MUST have a `package.json` with these fields:

```json
{
  "name": "xbrowser-plugin-douyin",
  "version": "1.0.0",
  "type": "module",
  "description": "抖音数据采集插件",
  "main": "index.ts",
  "keywords": ["xbrowser", "xbrowser-plugin", "douyin", "tiktok"],
  "dependencies": {
    "zod": "^3.24.0"
  },
  "peerDependencies": {
    "@dyyz1993/xcli-core": ">=1.0.0"
  },
  "xbrowser": {
    "site": "https://www.douyin.com",
    "commands": ["search", "video"],
    "slug": "douyin",
    "name": "抖音",
    "description": "抖音数据采集",
    "version": "1.0.0",
    "author": "xbrowser",
    "tags": ["social", "video"],
    "sites": ["douyin.com"],
    "requiresLogin": true
  }
}
```

### Field Validation Rules

| Field | Required | Validation |
|-------|----------|------------|
| `name` | ✅ | Must be `xbrowser-plugin-<slug>` (utility plugins exempt) |
| `version` | ✅ | Semver format |
| `type` | ✅ | Must be `"module"` |
| `description` | ✅ | Non-empty string |
| `main` | ✅ | Must be `"index.ts"` |
| `keywords` | ✅ | Must include `"xbrowser"` and `"xbrowser-plugin"` |
| `dependencies.zod` | Conditional | Required if `index.ts` imports `zod` |
| `peerDependencies` | Conditional | Required if `index.ts` imports `@dyyz1993/xcli-core` |
| `xbrowser` | ✅ | Object with site metadata |
| `xbrowser.site` | ✅ | Primary website URL |
| `xbrowser.commands` | ✅ | Array of command names registered by plugin |
| `xbrowser.requiresLogin` | ✅ | `true` or `false` |

### ❌ Common Mistakes

```json
{
  "name": "my-plugin",
  "version": "1.0",
  "description": ""
}
```

**Problems**: (1) Missing `xbrowser-plugin-` prefix, (2) version not semver, (3) empty description,
(4) missing `type`, `keywords`, `xbrowser` fields.

---

## index.ts Template

Every plugin follows this pattern:

```typescript
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { z } from 'zod';
import type { Page } from 'playwright';

export default function(api: XCLIAPI): void {
  const site = api.createSite({
    name: 'my-site',
    url: 'https://example.com',
    description: 'My site plugin',
    requiresLogin: false,
  });

  site.command('search', {
    description: 'Search on My Site',
    scope: 'page',
    parameters: z.object({
      keyword: z.string().describe('Search keyword'),
      limit: z.number().default(10).describe('Max results'),
    }),
    result: z.object({
      items: z.array(z.object({
        title: z.string(),
        url: z.string(),
      })),
      total: z.number(),
    }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page;
        await page.goto(`https://example.com/search?q=${encodeURIComponent(params.keyword)}`);
        await page.waitForSelector('.result-item', { timeout: 10000 });

        const items = await page.evaluate((limit: number) => {
          const els = document.querySelectorAll('.result-item');
          return Array.from(els).slice(0, limit).map(el => ({
            title: el.querySelector('h3')?.textContent?.trim() || '',
            url: (el.querySelector('a') as HTMLAnchorElement)?.href || '',
          }));
        }, params.limit);

        return ok({ items, total: items.length }, [`Found ${items.length} results`]);
      } catch (e) {
        return fail(
          { reason: e instanceof Error ? e.message : String(e) },
          'Search failed'
        );
      }
    },
  });
}
```

### Getting the Page Object

The framework doesn't export a typed context, so you must cast:

```typescript
// ✅ Correct casting pattern
const page = (ctx as unknown as Record<string, unknown>).page as Page;

// ❌ Wrong — using `any`
const page = ctx.page as any;
```

### Scope Levels

| Scope | Needs browser? | Typical commands |
|-------|---------------|------------------|
| `project` | No | config, file operations |
| `browser` | Browser instance | setViewport, session |
| `page` | Active page | goto, wait, screenshot |
| `element` | Specific element | click, fill, type |

---

## ok()/fail() Return Pattern

All command handlers MUST use `ok()` / `fail()` wrappers. Never bare `return`.

```typescript
import { ok, fail } from '@dyyz1993/xcli-core';

// ✅ Correct — ok() for success
return ok({ items, total: items.length }, `Found ${items.length} results`);

// ✅ Correct — fail() for errors
return fail({ reason: 'request failed' }, error.message);

// ❌ Wrong — bare return
return { data: items, tips: ['Done'] };

// ❌ Wrong — no wrapper function
return { data: null, message: 'error' };
```

### ok() / fail() Signature

```typescript
// ok(data, tips?) — data must be object literal, tips is string or string[]
ok({ items, total: items.length }, `Found ${items.length} results`);
ok({ url, title }, ['Page loaded', `Title: ${title}`]);

// fail(data, tips?) — same signature, but marks result as failure
fail({ reason: 'timeout' }, 'Page load timed out after 30s');
```

### Tips Quality Tiers

| Tier | Format | Example |
|------|--------|---------|
| **Rich** | Source tag + count + detail | `[API] Found 15 items, 3 with coupons` |
| **Standard** | Count + key metric | `Found 15 results for "react hooks"` |
| **Minimal** | Count only | `15 items` |
| **Vague** (forbidden) | No info | `Data collected`, `Complete` |

---

## Result Schema: L0→L1→L2 Gradual Migration

All `registerCommand()` and `site.command()` MUST declare a `result` field.

### Migration Levels

| Level | Schema | Lint | Meaning |
|-------|--------|------|---------|
| L0 | `z.any()` | ERROR | No type constraint |
| L1 | `z.record(z.any())` | WARNING | At least an object |
| L2 | `z.object({...}).passthrough()` | PASS ✅ | Precise type |

### Migration Path

```
L0: z.any()  →  L1: z.record(z.any())  →  L2: z.object({...}).passthrough()
   (forbidden)    (temporary safety net)      (target for all commands)
```

### How to Migrate L1→L2

1. Run lint: `node lint-scripts/check-result-schema.mjs`
2. Look at the handler's `ok(data, tips)` call
3. Write the corresponding `z.object({...})` matching `data`'s shape
4. Add `.passthrough()` for forward compatibility

```typescript
// L1 → L2 example
// Before: result: z.record(z.any())
// Handler returns: ok({ items: [...], total: 5 }, tips)
// After:
result: z.object({
  items: z.array(z.object({
    id: z.string(),
    title: z.string(),
    url: z.string(),
  })),
  total: z.number(),
}).passthrough(),
```

**Why `.passthrough()`?** Allows extra fields from API responses without breaking schema validation.

---

## loginConfig for Website Plugins

Website plugins (douyin, xiaohongshu, zhihu, etc.) MUST configure `loginConfig` in `createSite()`:

```typescript
const site = api.createSite({
  name: 'example',
  url: 'https://example.com',
  description: 'Example site plugin',
  requiresLogin: true,
  loginConfig: {
    loginUrls: ['/login', '/auth', '/passport', '/signin'],
    loginSelectors: [
      '[class*="login-modal"]',
      '[class*="login-dialog"]',
      '#login-panel',
    ],
    captchaSelectors: [
      '[class*="captcha"]',
      '[class*="verify"]',
      '[class*="slider"]',
    ],
    loginKeywords: ['登录', '注册'],
    loggedInSelectors: [
      '[class*="avatar"]',
      '[data-testid="user-menu"]',
    ],
    loginPrompt: '请使用 --cdp 连接已登录的浏览器（CDP 9221）',
  },
});
```

### Detection Strategy Priority

1. **URL redirect** (most reliable): URL contains `/login` etc.
2. **DOM selectors**: Login modal/panel exists on page
3. **Body text keywords**: Contains "登录" + "注册"
4. **Positive confirmation**: Logged-in avatar/menu elements present

### When loginConfig is NOT needed

Simple public data plugins (search engines, image sites) with `requiresLogin: false` can skip `loginConfig`.

---

## requiresLogin Declaration

Every `createSite()` MUST declare `requiresLogin: true|false`:

| requiresLogin | Meaning | Typical plugins |
|---|---|---|
| `true` | Needs login for core features | douyin, xiaohongshu, zhihu, AI assistants |
| `false` | Public API, no login needed | Search engines, image sites, tools |

This affects:
- `plugin list` display: `[need login]` / `[logged in]` status
- Framework `checkGuard()` login protection
- User expectations about setup requirements

```typescript
// ✅ Correct
const site = api.createSite({
  name: 'douyin',
  requiresLogin: true,
});

// ❌ Wrong — actually needs login but declared false
const site = api.createSite({
  name: 'douyin',
  requiresLogin: false,
});
```

---

## isLogin Detection Patterns

### Pattern A: URL + Body + DOM (Recommended for high-value sites)

```typescript
isLogin: async (ctx) => {
  try {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    if (!page) return false;
    const url = page.url();
    if (url.includes('/login') || url.includes('/auth')) return false;
    const body = await page.evaluate(() =>
      document.body?.textContent?.trim().slice(0, 300) || ''
    );
    if (body.includes('登录') && body.includes('注册')) return false;
    return await page.evaluate(() =>
      !!document.querySelector('.user-avatar, [data-testid="user-menu"]')
    );
  } catch { return false; }
},
```

### Pattern B: URL + Body (Simpler, most sites)

```typescript
isLogin: async (ctx) => {
  try {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    if (!page) return false;
    const url = page.url();
    if (url.includes('/login')) return false;
    const body = await page.evaluate(() =>
      document.body?.textContent?.trim().slice(0, 200) || ''
    );
    if (!body || (body.includes('登录') && body.includes('注册'))) return false;
    return true;
  } catch { return false; }
},
```

### Anti-Patterns

| Anti-Pattern | Why it fails | Fix |
|---|---|---|
| `document.cookie.match(/SESSDATA/)` | httpOnly cookies invisible to JS | Use DOM detection |
| No try/catch | Page crash → unhandled rejection | Always wrap, return false |
| Checking before page loads | Empty DOM → false negative | Use `ensurePage()` first |

---

## Utility Plugins (Exempt from Naming Rules)

Utility plugins are generic tools, not tied to specific websites. They are exempt from:
- `xbrowser-plugin-` name prefix
- `xbrowser.site` / `xbrowser.sites` URL fields

### Current Utility Plugins

| Plugin | Purpose |
|--------|---------|
| `diff` | Visual diff between pages/screenshots |
| `assert` | Assertion commands for testing |
| `image` | Image search across multiple sites |
| `testsuite` | Run test suites |
| `ai-search` | AI-powered search aggregation |
| `geo-analysis` | Geographic SEO analysis |
| `backlink-auto` | Automated backlink analysis |
| `web-automation` | Generic web automation scripts |

### Utility Plugin package.json Example

```json
{
  "name": "diff",
  "version": "1.0.0",
  "type": "module",
  "description": "Visual diff between pages",
  "main": "index.ts",
  "keywords": ["xbrowser", "xbrowser-plugin", "diff", "testing"],
  "dependencies": { "zod": "^3.24.0" },
  "xbrowser": {
    "name": "diff",
    "description": "Visual diff tool",
    "version": "1.0.0",
    "commands": ["diff"]
  }
}
```

---

## Helper Functions

### safeClickSelector — CDP-safe clicking

In CDP mode, `locator().click()` can cause context destruction. Use this instead:

```typescript
async function safeClickSelector(page: Page, selector: string): Promise<boolean> {
  const handle = await page.evaluateHandle((sel: string) =>
    document.querySelector(sel), selector);
  const element = handle.asElement();
  if (!element) return false;
  const box = await element.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}
```

### ensurePage — Smart navigation

```typescript
async function ensurePage(page: Page, url: string, domain: string) {
  const current = page.url();
  if (!current.includes(domain)) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }
}
```

### clickByText — Text-based clicking

```typescript
async function clickByText(page: Page, text: string, timeout = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await page.evaluate((t: string) => {
      const btns = document.querySelectorAll('button, [role="button"], a');
      for (const btn of btns) {
        if (btn.textContent?.trim().includes(t)) { btn.click(); return true; }
      }
      return false;
    }, text);
    if (found) return true;
    await page.waitForTimeout(500);
  }
  return false;
}
```
