# Command Reference

All 49 built-in commands with parameters, scope, and options.

**Related**: [../SKILL.md](../SKILL.md) for overview, [cdp-pitfalls.md](cdp-pitfalls.md) for CDP issues.

## Contents

- [Navigation](#navigation)
- [Interaction](#interaction)
- [Query](#query)
- [Wait](#wait)
- [Screenshot](#screenshot)
- [Scroll](#scroll)
- [Scrape & Crawl](#scrape--crawl)
- [Snapshot & Find](#snapshot--find)
- [Storage](#storage)
- [Viewport & Frame](#viewport--frame)
- [Agent](#agent)
- [Debug](#debug)
- [Script & Actions](#script--actions)
- [CLI Subcommands](#cli-subcommands)

---

## Navigation

| Command | Scope | Parameters | Result |
|---------|-------|-----------|--------|
| `goto` | page | `url` (string, auto-prefix https), `waitUntil` (load\|domcontentloaded\|networkidle) | `{ url, status?, ssr? }` |
| `open` | page | Same as `goto` (alias) | Same as `goto` |
| `back` | page | — | `{ url }` |
| `forward` | page | — | `{ url }` |
| `refresh` | page | — | `{ url }` |
| `title` | page | — | `{ title }` |
| `url` | page | — | `{ url }` |

---

## Interaction

| Command | Scope | Parameters | Result |
|---------|-------|-----------|--------|
| `click` | element | `selector`, `button` (left\|right\|middle), `clickCount`, `delay`, `waitCaptcha` (bool), `waitCaptchaTimeout` (ms) | `{ selector, newTab?, captcha? }` |
| `fill` | element | `selector`, `value`, `clear` (bool) | `{ selector, value, cleared, reactMode? }` |
| `type` | element | `selector`, `text`, `delay` | `{ selector }` |
| `press` | element | `selector` (default body), `key`, `delay` | `{ key }` |
| `select` | element | `selector`, `value` (string\|string[]) | `{ selector, value }` |
| `check` | element | `selector` | `{ selector }` |
| `hover` | element | `selector`, `modifiers` (Alt\|Control\|Meta\|Shift[]) | `{ selector }` |
| `dblclick` | element | `selector`, `button`, `delay` | `{ selector }` |

All interaction commands support `-s`/`--selector` flag and `-v`/`--value` flag as alternatives to positional args.

---

## Query

| Command | Scope | Parameters | Result |
|---------|-------|-----------|--------|
| `text` | page | `selector` (optional, default body) | `{ text }` |
| `html` | page | `selector` (optional, default full page) | `{ html }` |
| `eval` | page | `expression` (JS code) | `{ result }` |

---

## Wait

| Command | Scope | Parameters | Result |
|---------|-------|-----------|--------|
| `wait` | page | `selector`, `state` (attached\|detached\|visible\|hidden, default visible), `timeout` (ms, default 30000) | `{ selector, found }` |

---

## Screenshot

| Command | Scope | Parameters | Result |
|---------|-------|-----------|--------|
| `screenshot` | page | `selector` (optional), `type` (png\|jpeg), `fullPage` (bool), `output` (path), `base64` (bool) | `{ output, format, size }` or `{ data, format, size }` |

Default save: `~/.xbrowser/screenshots/`

---

## Scroll

| Command | Scope | Parameters | Result |
|---------|-------|-----------|--------|
| `scroll` | page | `direction` (up\|down\|left\|right), `distance` (px, default 500), `selector` (optional) | `{ direction, distance }` |

---

## Scrape & Crawl

| Command | Scope | Parameters | Result |
|---------|-------|-----------|--------|
| `scrape` | project | `url`, `selector`, `timeout` (default 30000), `format` (markdown\|html\|text), `onlyMainContent` (bool), `retries` (0-5), `waitAfterLoad` (ms), `mode` (raw\|clean\|compact\|smart) | `{ url, title, ... }` |
| `crawl` | project | `url`, `limit` (default 10), `maxDepth` (default 3), `includePaths`, `excludePaths`, `allowSubdomains`, `format`, `concurrency` (1-10), `retries` | `{ pages, total, errors? }` |
| `search` | project | `query`, `engine` (bing\|google\|baidu), `limit` (default 10), `full` (bool), `format`, `recency` (hour\|day\|week\|month\|year), `site` | `{ query, engine, results, total }` |
| `map` | project | `url`, `search` (filter), `sitemap` (include\|only), `includeSubdomains`, `limit` | `{ links, success }` |
| `network` | project | `url`, `filter`, `match`, `search`, `console` (bool), `timeout`, `wait`, `limit`, `format` (summary\|json), `ws` (bool), `listen` (bool), `duration` | Network summary/JSON |

---

## Snapshot & Find

| Command | Scope | Parameters | Result |
|---------|-------|-----------|--------|
| `snapshot` | page | `type` (aria\|text\|dom\|all, default aria), `selector`, `depth` (default 6), `interactive`/`i` (bool), `compact`/`c` (bool), `selectors` (bool) | `{ url, title, aria?, text?, dom? }` |
| `structure` | page | `selector` (default body), `depth` | `{ structure }` |
| `find` | page | `strategy` (text\|role\|label\|placeholder\|testid\|alt\|title\|first\|last\|nth), `value`, `exact` (bool), `action` (click\|fill\|type\|select\|hover\|check), `actionValue`, `timeout` | `{ matched, selector, action? }` |

---

## Storage

| Command | Scope | Parameters | Result |
|---------|-------|-----------|--------|
| `get-cookies` | page | — | `{ cookies }` |
| `set-cookie` | page | `name`, `value`, `domain`, `path`, `expires`, `httpOnly`, `secure`, `sameSite` | `{ name }` |
| `clear-cookies` | page | — | `{ cleared }` |
| `get-local-storage` | page | `key` (optional) | `{ key, value }` or `{ data }` |
| `set-local-storage` | page | `key`, `value` | `{ key }` |
| `clear-local-storage` | page | — | `{ cleared }` |

---

## Viewport & Frame

| Command | Scope | Parameters | Result |
|---------|-------|-----------|--------|
| `set-viewport` | browser | `width`, `height`, `deviceScaleFactor`, `isMobile`, `hasTouch` | `{ width, height, ... }` |
| `frames` | page | — | `{ frames: [{ index, name, url }] }` |
| `frame` | page | `index` or `name` | `{ name, url }` |
| `mouse` | page | `action` (move\|down\|up\|click\|dblclick), `x`, `y`, `button`, `steps` | `{ action, x, y }` |
| `tab` | page | `subcommand` (list\|new\|close\|switch), `url`, `index` | `{ success, data }` |

---

## Agent

| Command | Scope | Parameters | Result |
|---------|-------|-----------|--------|
| `observe` | page | `includeHidden` (bool), `limit` (1-300, default 80), `compact` (bool), `selectors` (bool) | `{ targets, selectors?, compact? }` |
| `act` | element | `action` (click\|fill\|type\|press\|select\|check\|hover), `ref` (observe ref), `selector`, `value`, `key`, `force` (bool), `timeout` | Action result |
| `waitFor` | page | `selector`, `state`, `text`, `url`, `load`, `fn` (JS predicate), `screenHashChanged`, `timeout`, `pollInterval` | Wait result |

---

## Debug

| Command | Scope | Parameters | Result |
|---------|-------|-----------|--------|
| `console` | page | `url`, `duration` (ms, default 5000), `filter` (all\|error\|warning\|info\|log), `includeStackTraces` (bool) | `{ url, total, errors, warnings, messages }` |
| `net-debug` | page | `url`, `duration`, `filter` (all\|failed\|slow\|error\|xhr\|fetch\|...), `slowThreshold` (ms) | `{ url, totalRequests, failedRequests, ... }` |
| `perf` | page | `url`, `iterations` (default 1) | `{ url, metrics: { TTFB, FCP, LCP, ... } }` |
| `health` | page | `url`, `checkLinks` (bool), `checkImages` (bool), `checkMeta` (bool), `maxLinks` | `{ url, passed, totalIssues, issues }` |

---

## Script & Actions

| Command | Scope | Parameters | Result |
|---------|-------|-----------|--------|
| `actions` | page | `url`, `actions` (array of {type, ...}, max 50), `output` (text\|json), `timeout` (seconds) | Sequence results |
| `add-init-script` | page | `script`, `file`, `stdin`, `name`, `list` (bool), `remove`, `base64` | `{ scripts?, removed?, registered? }` |

---

## CLI Subcommands

These are handled by the router, not the command registry:

| Subcommand | Handler | Description |
|-----------|---------|-------------|
| `session open/close/list/kill` | handleSession | Browser session management |
| `plugin list/schema/install/uninstall/reload` | handlePlugin | Plugin management |
| `create <name> --template <type>` | handleCreate | Scaffold new plugin |
| `config get/set/list` | handleConfig | Configuration management |
| `record start/stop/status` | handleRecord | Recording control |
| `replay <file>` | handleReplay | Replay recording |
| `convert <yaml> <out>` | handleConvert | Convert recording to script |
| `run <file>` | handleRun | Execute command file |
| `serve [--port]` | handleServe | HTTP server for remote access |
| `remote <url>` | handleRemote | Proxy to remote server |
| `viewer` | handleViewer | Open viewer for human takeover |
| `preview` | builtin | Preview browser state |

### Global Flags

| Flag | Purpose |
|------|---------|
| `--json` | Output as JSON |
| `--yaml` | Output as YAML |
| `--session <name>` | Session name (default: `XBROWSER_SESSION` env or `"default"`) |
| `--cdp <endpoint>` | CDP connection (default: `XBROWSER_CDP` env or auto-launch) |
| `--help` / `-h` | Show help |
| `--version` / `-v` | Show version |
