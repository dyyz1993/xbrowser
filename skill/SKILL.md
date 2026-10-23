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
       ├─ commands/  — built-in commands (count: see `xbrowser --help`)
       ├─ cli/       — subcommand routing (session, plugin, record, run, viewer)
       ├─ daemon/    — background daemon + WebSocket preview server (port 9224)
       └─ plugin/    — plugin loader (.xcli/plugins/ → count: see `xbrowser plugin list`)
```

### Key Paths

| What you change | Where |
|----------------|-------|
| Built-in commands | `src/commands/` (50 commands in 24 files) |
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

### Media Generation Plugins

媒体/音乐/生图/生视频插件必须复用统一契约：

```typescript
import {
  buildMediaDownload,
  buildMediaTask,
  mediaCommandDownloadSchema,
  mediaCommandResultSchema,
} from '../shared/media-plugin-template.js';
```

- 任务/状态命令：`result: mediaCommandResultSchema()`
- 下载命令：`result: mediaCommandDownloadSchema()`
- 状态：`submitted / processing / completed / failed / timeout`
- 本地路径只有在真实写盘成功后才能返回
- 关键 UI 用真实鼠标事件，不用 `element.click()`
- 受保护媒体用页面上下文 `fetch(..., { credentials: 'include' })`

完整头部、命令模板、禁忌和测试模板见
[docs/media-plugin-template.md](../../docs/media-plugin-template.md)。

---

## CLI Usage

### Browser Sessions

```bash
xbrowser goto https://example.com                       # Auto-start
xbrowser --cdp 9222 title                               # Connect existing browser
xbrowser --cdp auto title                               # Auto-discover
```

### Browser Session Priority (决策顺序，实战经验)

**第一判断：用户说的「现有/当前/我的浏览器」指哪个？**——这是最容易走错的一步：

| 用户的话 | 指的是什么 | 正确通道 |
|---------|-----------|---------|
| 「用我现有的浏览器」「我当前浏览器」「别开新的」「复用我的登录态」「在我浏览器里操作」 | **用户正在使用的那个 Chrome 窗口**（全部登录态 + 全部标签页） | **chrome-bridge 扩展通道**（不是 `--cdp`！`--cdp` 连不上没开调试端口的浏览器） |
| 「连 9221 / 9222」「连调试实例」 | 带 `--remote-debugging-port` 启动的实例 | `xbrowser --cdp <port>` |
| 没提浏览器 + 纯公开页面 | 无所谓 | headless 自起兜底 |

**「现有浏览器」三步探活（听到这句话必走，按序执行）：**

```bash
xbrowser chrome-bridge status   # ① running=true? clients>0?（clients=扩展已连上用户 Chrome）
xbrowser chrome-bridge serve    # ② status 报未启动 → 起服务（独立常驻进程）
xbrowser chrome-bridge revive   # ③ 服务在但 clients=0 → 唤醒扩展 SW（只开一个新标签页）
```

通了之后，按场景选入口：

```bash
xbrowser chrome-bridge task open --name <task> --url <url>  # 新建受控 tab（后台采集/发布任务首选，可 finish 清理）
xbrowser chrome-bridge attach --task "描述"                  # 接管用户当前 tab（需要用户看得见的操作）
xbrowser chrome-bridge exec --cmd evaluate --args '{...}' --tab-id <id>  # 在被接管 tab 上执行
xbrowser chrome-bridge finish                               # 收尾：自建 tab 关闭，用户 tab 脱组保留
```

**用户没提「现有浏览器」时**，再按登录态决策——大多数站需要登录态，headless 新起必败：

```bash
# 先探活调试端口实例
curl -s -m 3 http://localhost:9222/json/version   # 自动化实例
curl -s -m 3 http://localhost:9221/json/version   # 用户日常浏览器（开了调试端口才有）
# 活着 → --cdp 连它；死了 → bridge 通道（见上）或重启实例
```

| 场景 | 正确选择 |
|------|---------|
| 用户说「现有/我的/当前浏览器」 | **chrome-bridge**，见上，先 `status` 探活 |
| 需要登录态（知乎/微博/淘宝/ASC） | bridge 优先；不行再连 CDP 实例——headless 新起必败 |
| cookie 已迁移到 CDP 实例 | 连实例（与用户浏览器解耦，可并发） |
| 纯公开页面 | 随意，headless 兜底 |

注意：CDP trusted 输入要求目标 tab **visible**（`document.visibilityState`），tab 被遮挡时点击/键入被静默丢弃——操作前先查。bridge 通道同理，后台 tab 的可信输入会被静默丢弃，`insertText` 前先 `bringToFront`。

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
| File upload (CDP mode) | `el.click()` / click file input | `page.mouse.click(trigger)` + `page.setInputFiles` |
| Synthetic events (CDP Firewall) | `el.click()` in `page.evaluate` | `page.mouse.click(x, y)` (`isTrusted=true`) |

See [references/cdp-pitfalls.md](references/cdp-pitfalls.md) for detailed explanations, and **[file-upload/SKILL.md](file-upload/SKILL.md)** for the full file-upload decision tree (5 patterns, 豆包 reference-image 实战, helper function, recorder integration, debugger checklist).

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
| [command-reference.md](references/command-reference.md) | All 50 commands with parameters, scope, options | Looking up command usage |
| [session-lifecycle.md](references/session-lifecycle.md) | Session management, CDP modes, viewer | Debugging session issues |
| [cdp-pitfalls.md](references/cdp-pitfalls.md) | CDP driver pitfalls and solutions | CDP-related bugs |
| [file-upload/SKILL.md](file-upload/SKILL.md) | File upload decision tree (5 patterns), CDP Firewall avoidance, `setInputFiles` 实战, `shared/file-upload.ts` helper | Writing plugin handlers that upload files (image / attachment / avatar) |
| [lint-rules.md](references/lint-rules.md) | All 10 lint rules in detail | Lint errors |
| [testing-patterns.md](references/testing-patterns.md) | Core test patterns, mock strategies | Testing core modules |
| `AGENTS.md` (repo root) | Complete project manual (workspace rules) | Onboarding, full feature reference |
