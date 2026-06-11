# Plugin Development Guide

Complete reference for creating xbrowser plugins — from minimal to full-featured.

**Related**: [../SKILL.md](../SKILL.md) for overview, [plugin-testing.md](plugin-testing.md) for tests, [plugin-publishing.md](plugin-publishing.md) for publishing.

## Contents

- [Plugin Structure](#plugin-structure)
- [Naming Convention](#naming-convention)
- [Minimal Plugin](#minimal-plugin)
- [Full Plugin Template](#full-plugin-template)
- [package.json Fields](#packagejson-fields)
- [ok()/fail() Return Pattern](#okfail-return-pattern)
- [Result Schema Migration (L0→L1→L2)](#result-schema-migration-l0l1l2)
- [Login Configuration](#login-configuration)
- [isLogin Detection Patterns](#islogin-detection-patterns)
- [Page Object Access](#page-object-access)
- [CDP-Safe Helper Functions](#cdp-safe-helper-functions)
- [Scaffold with create Command](#scaffold-with-create-command)
- [Common Anti-Patterns](#common-anti-patterns)

---

## Plugin Structure

```
.xcli/plugins/<name>/
├── index.ts            # Entry: export default function(api: XCLIAPI): void
├── package.json        # Metadata + xbrowser config
├── helpers.ts          # Optional shared helpers
└── types.ts            # Optional type definitions
```

Publishing additionally requires: `README.md`, `CHANGELOG.md`, `MARKET_DESCRIPTION.md`, `LICENSE`.

---

## Naming Convention

- **One site = one plugin** — directory name = domain or brand name
- **No prefix** — use `devto` not `promo-devto`, `juejin` not `publish-juejin`
- **Commands = actions** — `xbrowser devto publish`, `xbrowser juejin fetch-articles`

```
✅ .xcli/plugins/github/         → xbrowser github list-issues
✅ .xcli/plugins/devto/          → xbrowser devto publish
✅ .xcli/plugins/juejin/         → xbrowser juejin fetch-articles
❌ .xcli/plugins/promo-devto/    → redundant prefix
❌ src/promo/devto.ts            → wrong location (must be in .xcli/plugins/)
```

---

## Minimal Plugin

```typescript
// .xcli/plugins/my-site/index.ts
import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'my-site',
    url: 'https://example.com',
    description: 'Example site plugin',
    requiresLogin: false,
  });

  site.command('hello', {
    description: 'Say hello',
    scope: 'project',
    parameters: z.object({
      name: z.string().default('World'),
    }),
    result: z.object({ message: z.string() }).passthrough(),
    handler: async (params) => {
      return ok({ message: `Hello, ${params.name}!` }, 'Done');
    },
  });
}
```

---

## Full Plugin Template

```typescript
import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page } from 'playwright';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'my-site',
    url: 'https://example.com',
    description: 'My site plugin',
    requiresLogin: true,
    isLogin: async (ctx) => {
      const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
      if (!page) return false;
      const url = page.url();
      if (url.includes('/login')) return false;
      return true;
    },
  });

  site.command('search', {
    description: 'Search on site',
    scope: 'page',
    parameters: z.object({
      keyword: z.string().describe('Search keyword'),
      limit: z.number().default(10).describe('Max results'),
    }),
    result: z.object({
      items: z.array(z.object({ title: z.string(), url: z.string() })),
      total: z.number(),
    }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = (ctx as Record<string, unknown>).page as Page;
        if (!page) return fail({ reason: 'no page' }, '需要浏览器页面');
        await page.goto(`https://example.com/search?q=${encodeURIComponent(params.keyword)}`);
        await page.waitForSelector('.result-item', { timeout: 10000 });
        const items = await page.evaluate((limit: number) => {
          return Array.from(document.querySelectorAll('.result-item'))
            .slice(0, limit)
            .map(el => ({
              title: el.querySelector('h3')?.textContent?.trim() || '',
              url: (el.querySelector('a') as HTMLAnchorElement)?.href || '',
            }));
        }, params.limit);
        return ok({ items, total: items.length }, `Found ${items.length} results`);
      } catch (e) {
        return fail(
          { reason: e instanceof Error ? e.message : String(e) },
          'Search failed'
        );
      }
    },
  });

  site.login(async (ctx) => {
    const page = (ctx as Record<string, unknown>).page as Page;
    if (!page) return;
    await page.goto('https://example.com/login');
    // Use ctx.waitForHuman() for complex login flows
    await ctx.storage.set('auth_token', { loggedIn: true, at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('auth_token');
  });
}
```

---

## package.json Fields

```json
{
  "name": "xbrowser-plugin-my-site",
  "version": "1.0.0",
  "type": "module",
  "description": "My site plugin description",
  "main": "index.ts",
  "keywords": ["xbrowser", "xbrowser-plugin", "my-site"],
  "dependencies": { "zod": "^3.24.0" },
  "peerDependencies": { "@dyyz1993/xcli-core": ">=1.0.0" },
  "xbrowser": {
    "name": "my-site",
    "slug": "my-site",
    "version": "1.0.0",
    "author": "your-name",
    "description": "My site plugin",
    "site": "https://example.com",
    "requiresLogin": true,
    "commands": ["search", "publish", "draft"]
  }
}
```

### Required Fields

| Field | Rule |
|-------|------|
| `name` | `xbrowser-plugin-<slug>` (utility plugins exempt) |
| `version` | Semver format |
| `type` | Must be `"module"` |
| `main` | Must be `"index.ts"` |
| `keywords` | Must include `"xbrowser"` and `"xbrowser-plugin"` |
| `xbrowser.site` | Primary website URL |
| `xbrowser.commands` | Array of registered command names |
| `xbrowser.requiresLogin` | `true` or `false` |

---

## ok()/fail() Return Pattern

All command handlers MUST use `ok()` / `fail()` wrappers:

```typescript
import { ok, fail } from '@dyyz1993/xcli-core';

// Success
return ok({ items, total: items.length }, `Found ${items.length} results`);
return ok({ url, title }, ['Page loaded', `Title: ${title}`]);

// Failure
return fail({ reason: 'timeout' }, 'Page load timed out after 30s');

// ❌ Wrong — bare return
return { data: items, tips: ['Done'] };
```

### Tips Quality

| Tier | Example |
|------|---------|
| Rich | `[API] Found 15 items, 3 with coupons` |
| Standard | `Found 15 results for "react hooks"` |
| Minimal | `15 items` |
| Forbidden | `Data collected`, `Complete` |

---

## Result Schema Migration (L0→L1→L2)

All commands MUST declare a `result` field:

| Level | Schema | Lint | Target |
|-------|--------|------|--------|
| L0 | `z.any()` | ERROR | Forbidden |
| L1 | `z.record(z.any())` | WARNING | Temporary |
| L2 | `z.object({...}).passthrough()` | PASS | Required |

```typescript
// L1 → L2 migration
// Before: result: z.record(z.any())
// After:
result: z.object({
  items: z.array(z.object({ title: z.string(), url: z.string() })),
  total: z.number(),
}).passthrough(),
```

---

## Login Configuration

```typescript
const site = xcli.createSite({
  name: 'example',
  url: 'https://example.com',
  requiresLogin: true,
  loginConfig: {
    loginUrls: ['/login', '/auth', '/signin'],
    loginSelectors: ['[class*="login-modal"]', '#login-panel'],
    captchaSelectors: ['[class*="captcha"]', '[class*="verify"]'],
    loginKeywords: ['登录', '注册'],
    loggedInSelectors: ['[class*="avatar"]', '[data-testid="user-menu"]'],
    loginPrompt: '请使用 --cdp 连接已登录的浏览器',
  },
});
```

Detection priority: URL redirect → DOM selectors → Body keywords → Positive confirmation.

---

## isLogin Detection Patterns

### Pattern A: Full Detection (Recommended for high-value sites)

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

### Pattern B: URL + Body (Simpler)

```typescript
isLogin: async (ctx) => {
  try {
    const page = (ctx as unknown as Record<string, unknown>).page as Page | undefined;
    if (!page) return false;
    if (page.url().includes('/login')) return false;
    const body = await page.evaluate(() =>
      document.body?.textContent?.trim().slice(0, 200) || ''
    );
    return !(body.includes('登录') && body.includes('注册'));
  } catch { return false; }
},
```

---

## Page Object Access

```typescript
// ✅ Correct — unknown narrowing
const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
if (!page) return fail({ reason: 'no page' }, '需要浏览器页面');

// ❌ Wrong — using any
const page = (ctx as any).page;  // ESLint rejects this
```

---

## CDP-Safe Helper Functions

### safeClickSelector — Avoid context destruction

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
  if (!page.url().includes(domain)) {
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

---

## Scaffold with create Command

```bash
xbrowser create my-plugin --template static    # Basic (no browser)
xbrowser create my-plugin --template dynamic   # Browser interaction
xbrowser create my-plugin --template login     # With login/logout
xbrowser create my-plugin --template api       # API integration
```

After scaffolding: move to `.xcli/plugins/<name>/`, customize fields, add business logic.

---

## Common Anti-Patterns

| Anti-Pattern | Why Wrong | Fix |
|---|---|---|
| Plugin in `src/` | Violates first principle: all automation → plugins | Move to `.xcli/plugins/<name>/` |
| `execSync(\`xbrowser fill ...\`)` | Shell out to CLI instead of using API | Use `ctx.page.locator().fill()` |
| `promo-devto` directory name | Redundant prefix | Use `devto` directly |
| One command dispatching multiple sites | Breaks isolation | One site = one plugin |
| `document.cookie.match()` | httpOnly cookies invisible to JS | Use DOM detection |
| No try/catch in isLogin | Page crash → unhandled rejection | Always wrap, return false |
| Empty `catch {}` | Silent failures | At least `console.error` |
| `z.any()` result schema | No type constraint | Migrate to `z.object({...}).passthrough()` |
