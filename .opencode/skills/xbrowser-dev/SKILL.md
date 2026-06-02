---
name: xbrowser-dev
description: >
  xbrowser project development guide — plugin conventions, lint rules,
  marketplace publishing, config architecture, session lifecycle, and testing patterns.
  Use when: developing xbrowser itself, writing/modifying plugins,
  running lint scripts, publishing to marketplace, working on the xbrowser codebase,
  adding new commands, fixing plugin issues, or understanding project architecture.
  Triggers: "xbrowser plugin", "plugin convention", "lint script", "marketplace publish",
  "xbrowser dev", "xbrowser development", "xbrowser build", "xbrowser test",
  "ok fail pattern", "result schema", "requiresLogin", "loginConfig".
---

# xbrowser Development Guide

Development reference for the xbrowser project (`@xbrowser/cli`) — a Playwright-based
browser automation CLI with 50+ commands, 70 site plugins, and marketplace publishing.

## Project Structure

```
xbrowser/
├── src/                       # Core source
│   ├── cli/                   # CLI route handlers (output formatting, help)
│   ├── commands/              # Built-in commands (goto, click, fill, scrape, etc.)
│   ├── plugin/                # Plugin system (loader, installer, publisher, marketplace)
│   ├── builtins/              # Built-in plugins (marketplace, admin, config, recorder)
│   ├── daemon/                # Daemon process, session management, viewer
│   ├── config.ts              # Single source of truth: marketplace URL, registry URL
│   └── utils/                 # Shared utilities
├── .xcli/plugins/             # 70 site-specific plugins (douyin, baidu, github, etc.)
├── lint-scripts/              # Pre-commit lint checks (10 rules)
│   ├── RULES.md               # Complete rule documentation
│   ├── check-plugin-code.mjs
│   ├── check-plugin-metadata.mjs
│   ├── check-result-schema.mjs
│   └── ...
├── tests/                     # Vitest tests (113 files, ~1959 tests)
├── scripts/
│   └── batch-marketplace-publish.sh
├── docs/
├── package.json               # @xbrowser/cli v0.16.0
└── tsconfig.json
```

## Build & Test

```bash
npm run build          # Build with tsup
npm run dev            # Watch mode (tsup --watch)
npm run lint           # ESLint (max-warnings 0)
npm run typecheck      # TypeScript check (tsc --noEmit)
npm run test           # Vitest run (~1959 tests)
npm run test:watch     # Vitest watch mode
npm run test:e2e       # E2E tests only
npm run validate       # Full pipeline: typecheck + lint + build + test
```

### Pre-commit Hooks

Commits trigger 10 checks via `.husky/pre-commit`:

```
typecheck → ESLint → any-count → command-params → help-auto-gen →
result-schema → output-convention → plugin-metadata → plugin-code → requiresLogin
```

### Pre-push

Pushes run `npm run test` (full test suite).

## Config Architecture

**`src/config.ts`** is the single source of truth for all URLs and configuration:

```typescript
// src/config.ts — all config in one place
getMarketplaceUrl()  // env XBROWSER_MARKETPLACE_URL → config file → default
getRegistryUrl()     // CLI --registry → env XBROWSER_REGISTRY → saved auth → default
```

**Never hardcode URLs.** Always import from `config.ts`:

```typescript
// ✅ Correct
import { getMarketplaceUrl } from '../config.js';
const url = getMarketplaceUrl();

// ❌ Wrong — hardcoded
const url = 'https://marketplace.xbrowser.dev';
```

### Config Priority

```
CLI flag > env var > config file (~/.xbrowser/config.json) > default
```

### Setting Config

```bash
npx xbrowser config set cdp_port 9221
npx xbrowser config set chromium_path /path/to/chromium
npx xbrowser config set daemon_port 9224
npx xbrowser config list
```

## Session Lifecycle

All browser interactions follow: **session open → commands → session close**.

```bash
# 1. Create session (auto-starts daemon)
npx xbrowser session open https://example.com --name mytask

# 2. Execute commands
npx xbrowser click --selector '.btn' --session mytask
npx xbrowser scrape https://example.com --json --session mytask

# 3. Close session
npx xbrowser session close --name mytask
```

### Mandatory Rules

1. Always create a **new** session — never reuse stale sessions
2. Always **close** when done — unclosed sessions leak resources
3. Use `npx xbrowser kill` for nuclear cleanup
4. **Kill → rebuild → session open** after any code changes

```bash
# ✅ Correct
npx xbrowser kill && npm run build
npx xbrowser session open https://example.com --name test

# ❌ Wrong — old daemon + new code = bugs
npm run build
npx xbrowser session open ...
```

### CDP Connection Modes

| Mode | Flag | Use Case |
|------|------|----------|
| CDP (user browser) | `--cdp http://localhost:9221` | **Needs login** — Douyin, Weibo |
| Headless | `--cdp http://localhost:9222` | Public pages |
| Auto | no `--cdp` | Auto-launch headless |

See [references/session-lifecycle.md](references/session-lifecycle.md) for full details.

## Plugin Convention Summary

### Plugin Structure

```
.xcli/plugins/<name>/
├── index.ts          # export default function(api: XCLIAPI): void
└── package.json      # metadata + xbrowser config
```

### Minimal Plugin Example

```typescript
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { z } from 'zod';
import { ok, fail } from '@dyyz1993/xcli-core';

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
    }),
    result: z.object({
      items: z.array(z.object({ title: z.string(), url: z.string() })),
      total: z.number(),
    }).passthrough(),
    handler: async (params, ctx) => {
      try {
        const page = (ctx as unknown as Record<string, unknown>).page as Page;
        const items = await doSearch(params.keyword, page);
        return ok({ items, total: items.length }, `Found ${items.length} results`);
      } catch (e) {
        return fail({ reason: 'Search failed' }, e instanceof Error ? e.message : String(e));
      }
    },
  });
}
```

### Key API Reference

| API | Purpose |
|-----|---------|
| `api.createSite(config)` | Create site namespace |
| `site.command(name, config)` | Register a command |
| `site.login(handler)` | Register login flow |
| `site.logout(handler)` | Register logout flow |
| `ctx.storage.get/set/delete` | Plugin-persistent key-value store |

### Code Quality Rules

| Rule | Requirement |
|------|------------|
| Return pattern | MUST use `ok()`/`fail()` — never bare `return` |
| Result schema | Every command MUST have `result: z.object({...}).passthrough()` |
| No `z.any()` | Replace with specific schema (L0→L1→L2 migration) |
| No `page: z.any()` | Page comes from `ctx`, not parameters |
| No empty catch | Must log or comment why error is ignored |
| No hardcoded creds | Use `process.env.*` |
| loginConfig | Website plugins MUST have login detection |

See [references/plugin-convention.md](references/plugin-convention.md) for the complete guide.

## Marketplace Commands

```bash
# Register (one-time)
npx xbrowser marketplace register --username <user> --email <email> --password <pass>

# Login
npx xbrowser marketplace login --email <email> --password <pass>

# Publish single plugin
npx xbrowser marketplace publish --dir .xcli/plugins/<name>

# Publish all (dry-run first)
bash scripts/batch-marketplace-publish.sh --dry-run
bash scripts/batch-marketplace-publish.sh

# Status
npx xbrowser marketplace whoami
```

Marketplace URL: `https://marketplace.xbrowser.dev`
Plugin pages: `https://xbrowser.dev/plugins/<slug>`

## Lint Rules Quick Reference

| # | Rule | Script | Severity |
|---|------|--------|----------|
| 1 | Output convention | `check-output-convention.mjs` + ESLint | ERROR |
| 2 | Command param consumption | `check-command-params.mjs` | ERROR |
| 3 | Result schema required | `check-result-schema.mjs` | ERROR |
| 4 | Plugin metadata | `check-plugin-metadata.mjs` | ERROR |
| 5 | Help auto-generation | `check-help-auto-gen.mjs` | ERROR |
| 6 | Plugin code quality (6a-6h) | `check-plugin-code.mjs` | ERROR/WARN |
| 7 | Metadata completeness | `check-plugin-metadata.mjs` | ERROR |
| 8 | loginConfig guide | (development guide) | — |
| 9 | requiresLogin declaration | `check-plugin-requires-login.js` | ERROR |
| 10 | Result schema migration | (strategy guide) | — |

```bash
# Run individual lint
node lint-scripts/check-plugin-code.mjs       # Code quality for all 70 plugins
node lint-scripts/check-plugin-metadata.mjs   # Metadata for all plugins
node lint-scripts/check-result-schema.mjs     # Result schema compliance

# Run full pre-commit without committing
bash .husky/pre-commit
```

See [references/lint-rules.md](references/lint-rules.md) for all rules with pass/fail examples.

## Utility Plugins

Exempt from `xbrowser-plugin-` name prefix and `xbrowser.site` URL requirement:

| Plugin | Purpose |
|--------|---------|
| `diff` | Visual diff between pages/screenshots |
| `assert` | Assertion commands for testing |
| `image` | Image search across 28 sites |
| `testsuite` | Run test suites |
| `ai-search` | AI-powered search aggregation |
| `geo-analysis` | Geographic SEO analysis |
| `backlink-auto` | Automated backlink analysis |
| `web-automation` | Generic web automation scripts |

## Testing

- **Framework**: Vitest
- **Scale**: 113 test files, ~1959 tests
- **Location**: `tests/` (e.g., `tests/plugins/<name>.test.ts`)
- **Pre-push**: full test suite
- **Mock pattern**: `vi.mock('../config.js')` for config, `vi.mock('@dyyz1993/xcli-core')` for ok/fail

```bash
npx vitest run                          # All tests
npx vitest run tests/plugins/           # Plugin tests only
npx vitest run tests/plugins/douyin.test.ts  # Single file
npm run validate                        # Full pipeline
```

See [references/testing-patterns.md](references/testing-patterns.md) for mock patterns and examples.

## Reference Docs

| Doc | Content |
|-----|---------|
| [Plugin Convention](references/plugin-convention.md) | Directory structure, package.json, ok/fail, result schema, loginConfig, isLogin |
| [Lint Rules](references/lint-rules.md) | All 10 rules with pass/fail examples, running instructions |
| [Session Lifecycle](references/session-lifecycle.md) | Session open/close, daemon auto-start, CDP modes, viewer, kill vs close |
| [Testing Patterns](references/testing-patterns.md) | Vitest setup, mock patterns, plugin test examples, pre-commit hooks |
