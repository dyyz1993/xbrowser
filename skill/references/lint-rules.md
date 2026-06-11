# Lint Rules Reference

All code quality rules enforced by pre-commit hooks and standalone lint scripts.

**Related**: [../SKILL.md](../SKILL.md) for project overview, [plugin-convention.md](plugin-convention.md) for plugin dev guide.

## Contents

- [Overview](#overview)
- [Rule 1: Output Convention](#rule-1-output-convention)
- [Rule 2: Command Parameter Consumption](#rule-2-command-parameter-consumption)
- [Rule 3: Result Schema](#rule-3-result-schema)
- [Rule 4: Plugin Metadata](#rule-4-plugin-metadata)
- [Rule 5: Help Auto-Generation](#rule-5-help-auto-generation)
- [Rule 6: Plugin Code Quality (6a–6h)](#rule-6-plugin-code-quality-6a6h)
- [Rule 7: Plugin Metadata Completeness](#rule-7-plugin-metadata-completeness)
- [Rule 8: loginConfig (Development Guide)](#rule-8-loginconfig-development-guide)
- [Rule 9: requiresLogin Declaration](#rule-9-requireslogin-declaration)
- [Rule 10: Gradual Result Schema Optimization](#rule-10-gradual-result-schema-optimization)
- [Running Lint Scripts](#running-lint-scripts)
- [Adding New Rules](#adding-new-rules)

---

## Overview

Pre-commit hook execution order:

```
git commit → .husky/pre-commit
  1. TypeScript typecheck (tsc --noEmit)
  2. ESLint (with custom rules)
  3. `any` count check (max 100 in src/)
  4. check-command-params.mjs
  5. check-help-auto-gen.mjs
  6. check-result-schema.mjs
  7. check-output-convention.mjs
  8. check-plugin-metadata.mjs
  9. check-plugin-code.mjs
  10. check-plugin-requires-login.js
```

---

## Rule 1: Output Convention

**Script**: `eslint-no-raw-output.mjs` (ESLint) + `check-output-convention.mjs` (pre-commit)

**Rule**: `src/cli/` must NOT use `console.log(JSON.stringify(...))`. Use `outputResult()` instead.

```typescript
// ✅ Pass — use outputResult
import { outputResult } from './output.js';
outputResult({ plugins }, mode);

// ❌ Fail — raw JSON output
console.log(JSON.stringify(plugins, null, 2));
```

**Why**: xcli-core provides `OutputFormatter` with mode-aware formatting (text/json/yaml). Raw JSON breaks `--yaml` mode.

---

## Rule 2: Command Parameter Consumption

**Script**: `check-command-params.mjs`

**Rule**: All parameters declared in Zod schema must be used in the handler. Parameters prefixed with `_` are exempt.

```typescript
// ✅ Pass — all params consumed
registerCommand({
  name: 'click',
  parameters: z.object({
    selector: z.string().describe('CSS selector'),
  }),
  handler: async (params, ctx) => {
    await ctx.page.click(params.selector); // ✅ used
  },
});

// ❌ Fail — timeout declared but unused
registerCommand({
  name: 'click',
  parameters: z.object({
    selector: z.string(),
    timeout: z.number().optional(), // ❌ never used
  }),
  handler: async (params, ctx) => {
    await ctx.page.click(params.selector);
  },
});

// ✅ Pass — _ prefix means intentionally unused
parameters: z.object({
  selector: z.string(),
  _debug: z.boolean().optional(), // ✅ allowed to ignore
}),
```

**Why**: Unused params = misleading API contract.

---

## Rule 3: Result Schema

**Script**: `check-result-schema.mjs`

**Rule**: Every `registerCommand()` / `site.command()` MUST have a `result` field (Zod schema).

```typescript
// ✅ Pass — has result schema
registerCommand({
  name: 'search',
  parameters: z.object({ query: z.string() }),
  result: z.object({
    items: z.array(z.object({ title: z.string(), url: z.string() })),
    total: z.number(),
  }),
  handler: async (params, ctx) => {
    const items = await doSearch(params.query);
    return ok({ items, total: items.length });
  },
});

// ❌ Fail — no result schema
registerCommand({
  name: 'search',
  parameters: z.object({ query: z.string() }),
  // ❌ missing result field
  handler: async (params, ctx) => {
    return { data: items };
  },
});
```

**Why**: Result schema = runtime validation + auto-generated help + inter-plugin data contracts.

---

## Rule 4: Plugin Metadata

**Script**: `check-plugin-metadata.mjs`

**Rule**: All plugins must have `package.json` with `xbrowser` field.

```bash
# ✅ Correct — use create command
npx xbrowser create my-plugin --template static
```

```json
// ✅ Pass — complete metadata
{
  "name": "xbrowser-plugin-my-plugin",
  "version": "1.0.0",
  "description": "My plugin description",
  "xbrowser": {
    "site": "https://example.com",
    "description": "My plugin description"
  }
}
```

```bash
# ❌ Fail — no package.json
.xcli/plugins/my-plugin/
├── index.ts
# Missing package.json!
```

---

## Rule 5: Help Auto-Generation

**Script**: `check-help-auto-gen.mjs`

**Rule**: No hand-written help files. `--help` is auto-generated from Zod schema.

```typescript
// ✅ Pass — Zod schema drives --help
registerCommand({
  name: 'screenshot',
  parameters: z.object({
    selector: z.string().optional(),
    type: z.enum(['png', 'jpeg']).optional(),
  }),
  handler: async (params, ctx) => { /* ... */ },
});
// "xbrowser screenshot --help" → auto-generated from schema

// ❌ Fail — hand-written help
export function showMainHelp(): void {
  console.log(`screenshot [--full-page]  Take screenshot`);
  // Missing --selector, --type — already out of date!
}
```

---

## Rule 6: Plugin Code Quality (6a–6h)

**Script**: `check-plugin-code.mjs`

| Sub-rule | Severity | Rule |
|----------|----------|------|
| 6a | ERROR | Entry must be `index.ts` (JS → warning) |
| 6b | ERROR | Must have `export default` function |
| 6c | ERROR | Must use `ok()`/`fail()`, no bare `return { data: ... }` |
| 6d | ERROR | `ok()`/`fail()` must use object literal: `ok({...}, tips)` |
| 6e | WARNING | `result: z.any()` → replace with specific schema |
| 6f | WARNING | `page: z.any()` in parameters → Page from `ctx` only |
| 6g | WARNING | Empty `catch {}` → at least log error |
| 6h | ERROR | No hardcoded credentials |

```typescript
// ✅ Pass — all rules followed
import { ok, fail } from '@dyyz1993/xcli-core';

export default async function handler(params, ctx) {
  try {
    const data = await fetchData(params.url, ctx);
    return ok({ items: data }, '获取成功');
  } catch (err) {
    ctx.logger?.error('fetch failed:', err);
    return fail({ reason: '请求失败' }, err.message);
  }
}

// ❌ Rule 6c: bare return
return { data: items };

// ❌ Rule 6e: z.any()
result: z.any()

// ❌ Rule 6g: empty catch
try { ... } catch {}

// ❌ Rule 6h: hardcoded credential
const API_KEY = 'sk-abc123';
```

---

## Rule 7: Plugin Metadata Completeness

**Script**: `check-plugin-metadata.mjs`

Enhanced validation beyond Rule 4:

| Check | Requirement |
|-------|------------|
| Name format | `xbrowser-plugin-{slug}` (utility plugins exempt) |
| `type` | Must be `"module"` |
| Dependencies | If `index.ts` imports `zod`, must declare in `dependencies` |
| Peer dependencies | If imports `@dyyz1993/xcli-core`, must declare in `peerDependencies` |
| Keywords | Must include `"xbrowser"` and `"xbrowser-plugin"` |
| xbrowser fields | `site`, `commands`, `slug`, `name`, `description` recommended |

---

## Rule 8: loginConfig (Development Guide)

**Not a lint rule** — a development guideline for website plugins.

Configure in `createSite()` to unify login detection:

```typescript
const site = api.createSite({
  name: 'example',
  loginConfig: {
    loginUrls: ['/login', '/auth'],
    loginSelectors: ['[class*="login-modal"]'],
    captchaSelectors: ['[class*="captcha"]'],
    loginKeywords: ['登录', '注册'],
    loggedInSelectors: ['[class*="avatar"]'],
    loginPrompt: '请使用 --cdp 连接已登录的浏览器（CDP 9221）',
  },
});
```

See [plugin-convention.md](plugin-convention.md#loginconfig-for-website-plugins) for full details.

---

## Rule 9: requiresLogin Declaration

**Script**: `check-plugin-requires-login.js`

**Rule**: All `createSite()` must declare `requiresLogin: true|false`.

| requiresLogin | Meaning | Examples |
|---|---|---|
| `true` | Needs login for core features | douyin, xiaohongshu, zhihu |
| `false` | Public, no login needed | Search engines, image sites |

```typescript
// ✅ Correct
const site = api.createSite({ name: 'douyin', requiresLogin: true });

// ❌ Wrong — needs login but declared false
const site = api.createSite({ name: 'douyin', requiresLogin: false });
```

---

## Rule 10: Gradual Result Schema Optimization

**Not a lint rule** — strategy for migrating `z.any()` to precise schemas.

| Level | Schema | Lint Level | Target |
|-------|--------|------------|--------|
| L0 | `z.any()` | ERROR | Forbidden — must at least reach L1 |
| L1 | `z.record(z.any())` | WARNING | Temporary safety net |
| L2 | `z.object({...}).passthrough()` | PASS ✅ | Target for all commands |

Migration steps:
1. Run `node lint-scripts/check-result-schema.mjs` to find L1 warnings
2. Look at handler's `ok(data, tips)` to see actual return shape
3. Write `z.object({...}).passthrough()` matching that shape

---

## Running Lint Scripts

### Individual Scripts

```bash
node lint-scripts/check-command-params.mjs       # Rule 2
node lint-scripts/check-result-schema.mjs          # Rule 3
node lint-scripts/check-output-convention.mjs      # Rule 1
node lint-scripts/check-plugin-metadata.mjs        # Rules 4 + 7
node lint-scripts/check-plugin-code.mjs            # Rule 6
node lint-scripts/check-plugin-requires-login.js   # Rule 9
```

### Full Pre-commit Simulation

```bash
# Runs all checks without committing
bash .husky/pre-commit
```

### Full Validation Pipeline

```bash
npm run validate    # typecheck + lint + build + test
```

---

## Adding New Rules

1. Create script in `lint-scripts/`:
   - `check-xxx.mjs` for pre-commit checks
   - `eslint-xxx.mjs` for ESLint rules
2. Register:
   - ESLint rules → `eslint.config.js`
   - Pre-commit checks → `.husky/pre-commit`
3. Document in `lint-scripts/RULES.md`
4. Test: `node lint-scripts/check-xxx.mjs` should pass on all 69 plugins
