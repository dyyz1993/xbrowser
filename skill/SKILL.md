---
name: xbrowser
description: >
  xbrowser — browser automation CLI with plugin system, CDP driver, recording/replay,
  viewer/captcha interaction, and marketplace publishing.
  Use when: developing xbrowser plugins, writing/modifying .xcli/plugins/,
  publishing plugins to marketplace, building/testing xbrowser core, debugging CDP connections,
  recording/replaying browser flows, implementing login/captcha handling, adding new commands,
  understanding project architecture, writing plugin tests.
  Triggers: "xbrowser plugin", "plugin convention", "marketplace publish",
  "xbrowser dev", "xbrowser development", "xbrowser build/test", "plugin contract",
  "result schema", "loginConfig", "requiresLogin", "CDP driver",
  "xbrowser viewer", "preview", "captcha", "recording", "replay", "plugin test",
  "open url", "XBROWSER_CDP", "XBROWSER_SESSION".
---

# xbrowser Development Guide

> **Stack**: TypeScript, CDP driver (Playwright alternative), xcli-core plugin framework, zod, vitest, tsup

---

## Architecture Overview

```
CLI (bin/cli.ts)
  └─ router.ts — single command / chain (&& , ->) / heredoc / stdin
       ├─ commands/  — 49 built-in commands (49 registered via registerCommand)
       ├─ cli/       — subcommand routing (session, plugin, record, run, viewer)
       ├─ daemon/    — background daemon + WebSocket preview server (port 9224)
       └─ plugin/    — plugin loader (.xcli/plugins/ → 69 site plugins)
```

### Key Paths

| What you change | Where |
|----------------|-------|
| Built-in commands | `src/commands/` (49 commands in 24 files) |
| CLI subcommands | `src/cli/` |
| CDP driver | `src/cdp-driver/` |
| New plugin | `.xcli/plugins/<name>/index.ts` |
| Plugin lint | `lint-scripts/` |
| Recording/replay | `src/commands/record.ts`, `replay.ts` |
| Viewer/preview | `src/cli/viewer-routes.ts`, `src/daemon/` |

See [references/architecture.md](references/architecture.md) for startup flow, request lifecycle, and module dependencies.

---

## Build & Test

```bash
npm install && npm run build && npm link   # Setup
npm run typecheck && npm run lint          # Pre-commit minimum
npm run test                               # vitest (~2200 tests)
npm run validate                           # typecheck + lint + build + test
npm run lint:plugin-contract               # Plugin contract check (~30s)
```

---

## Plugin Development (Quick Start)

### Minimal Plugin

```typescript
// .xcli/plugins/my-site/index.ts
import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'my-site',
    url: 'https://example.com',
    description: 'Example site plugin',
    requiresLogin: false,
  });

  site.command('search', {
    description: 'Search on site',
    scope: 'page',
    parameters: z.object({
      keyword: z.string().describe('Search keyword'),
    }),
    result: z.object({ items: z.array(z.object({ title: z.string() })), total: z.number() }).passthrough(),
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) return fail({ reason: 'no page' }, '需要浏览器页面');
      await page.goto(`https://example.com/search?q=${params.keyword}`);
      return ok({ items: [], total: 0 }, '搜索完成');
    },
  });
}
```

### Scope Selection

| Scope | Browser? | Page? | Use for |
|-------|----------|-------|---------|
| `project` | No | No | API, files, data |
| `browser` | Yes | No | Multi-tab, viewport, cookies |
| `page` | Yes | Yes | Navigate, DOM, screenshot, JS |
| `element` | Yes | Yes | click, fill, hover |

### Naming Convention

- **One site = one plugin** — directory name = domain/brand (e.g. `devto`, `juejin`, `medium`)
- **Command = action** — no site prefix (e.g. `xbrowser devto publish`, not `xbrowser devto devto-publish`)
- Use `xbrowser create <name> --template <type>` to scaffold

See [references/plugin-development.md](references/plugin-development.md) for full guide (loginConfig, isLogin patterns, result schema migration, helpers).

---

## CLI Usage

### Browser Sessions

```bash
xbrowser goto https://example.com                       # Auto-start
xbrowser --cdp 9222 title                               # Connect existing browser
xbrowser --cdp auto title                               # Auto-discover
```

### Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `XBROWSER_SESSION` | Default session name (overridden by `--session`) | `export XBROWSER_SESSION=my-task` |
| `XBROWSER_CDP` | Default CDP endpoint (overridden by `--cdp`) | `export XBROWSER_CDP=http://localhost:9221` |

### Command Chains

```bash
xbrowser "goto https://example.com && title && screenshot"
xbrowser "open https://example.com , title , screenshot"     # open = goto alias
xbrowser "goto https://example.com -> title -> click btn"
```

### Recording & Replay

```bash
xbrowser record start --url https://example.com --name flow
# ... manual operations ...
xbrowser record stop --output recordings/flow.yaml
xbrowser replay recordings/flow.yaml --slow-mo 200
```

### Viewer (Human Takeover)

```bash
xbrowser viewer                # Open viewer for captcha/login/2FA
xbrowser preview --session s1  # Preview specific session
```

---

## Built-in Commands (49 total)

| Category | Commands |
|----------|----------|
| Navigate | `goto`/`open`, `back`, `forward`, `refresh`, `title`, `url` |
| Interact | `click`, `fill`, `type`, `press`, `select`, `check`, `hover`, `dblclick` |
| Query | `text`, `html`, `eval` |
| Wait | `wait`, `waitFor`, `observe`, `act` |
| Screenshot | `screenshot` |
| Scrape | `scrape`, `crawl`, `search`, `map`, `network` |
| Snapshot | `snapshot`, `structure`, `find` |
| Storage | `get-cookies`, `set-cookie`, `clear-cookies`, `get-local-storage`, `set-local-storage`, `clear-local-storage` |
| Viewport | `set-viewport`, `frame`, `frames`, `mouse`, `tab` |
| Debug | `console`, `net-debug`, `perf`, `health` |
| Agent | `observe`, `act`, `waitFor` |
| Script | `actions`, `add-init-script` |
| Subcommands | `session`, `plugin`, `create`, `config`, `record`, `replay`, `convert`, `run`, `serve`, `remote`, `viewer`, `preview` |

See [references/command-reference.md](references/command-reference.md) for full parameters and options.

---

## CDP Pitfalls (Critical)

| Scenario | Wrong | Right |
|----------|-------|-------|
| contenteditable input | `page.fill()` | `page.keyboard.type({ delay: 30 })` |
| Clicking elements | `locator().click()` | `evaluateHandle` + `mouse.click(x,y)` |
| Closing browser | `browser.close()` | Handler auto-disconnects |
| Selectors | `:has-text("xxx")` | class / id / data-testid |

See [references/cdp-pitfalls.md](references/cdp-pitfalls.md) for detailed explanations.

---

## Lint Rules

```bash
npm run lint                                 # ESLint
node lint-scripts/check-plugin-code.mjs      # Plugin code quality
node lint-scripts/check-plugin-metadata.mjs  # Plugin metadata
node lint-scripts/check-result-schema.mjs    # Result schema
npm run lint:plugin-contract                 # Full contract check
```

Key rules: no `any` (use `unknown`), no `console.log` in production, mandatory type annotations, `ok()`/`fail()` return pattern.

See [references/lint-rules.md](references/lint-rules.md) for all 10 rules.

---

## Reference Files

| File | Content | When to read |
|------|---------|-------------|
| [architecture.md](references/architecture.md) | Startup flow, request lifecycle, module deps, plugin loading | Understanding system design, debugging deep issues |
| [plugin-development.md](references/plugin-development.md) | Full plugin guide: loginConfig, isLogin, result schema, helpers | Creating or modifying plugins |
| [plugin-testing.md](references/plugin-testing.md) | Plugin test patterns, mock factories, coverage checklist | Writing plugin tests |
| [plugin-publishing.md](references/plugin-publishing.md) | Marketplace publishing flow, versioning, registry | Publishing plugins |
| [command-reference.md](references/command-reference.md) | All 49 commands with parameters, scope, options | Looking up command usage |
| [session-lifecycle.md](references/session-lifecycle.md) | Session management, CDP modes, viewer | Debugging session issues |
| [cdp-pitfalls.md](references/cdp-pitfalls.md) | CDP driver pitfalls and solutions | CDP-related bugs |
| [lint-rules.md](references/lint-rules.md) | All 10 lint rules in detail | Lint errors |
| [testing-patterns.md](references/testing-patterns.md) | Core test patterns, mock strategies | Testing core modules |
| `AGENTS.md` (repo root) | Complete project manual (workspace rules) | Onboarding, full feature reference |
