# Plugin Migration Report: mpage → xbrowser

## Overview

Migrated real-site and utility plugins from `mpage/.xcli/plugins/` to `xbrowser/.xcli/plugins/`.

## Migrated Plugins (4)

| Plugin | Commands | Changes |
|--------|----------|---------|
| **baidu** | search, hotsearch, suggest, news | Import changed from `xcli` → `@dyyz1993/xcli-core`; `ctx.page` cast via `(ctx as Record<string, unknown>).page` |
| **douyin** | ai-summary, user-info, video-info | Removed `NetworkCapture` dependency (not in xcli-core); removed `videos`, `profile`, `detail`, `comments`, `net-search`, `ai-search` commands that relied on network interception; added DOM-based `user-info` and `video-info` alternatives |
| **github** | update-profile, add-social-link, create-gist, get-profile | Import changed; `ctx.page` cast via type assertion |
| **web-automation** | extract, paginate, fill-and-submit, screenshot | Removed `baidu-search` (duplicate of baidu plugin); import changed; `ctx.page` cast |

## Skipped Plugins

| Plugin | Reason |
|--------|--------|
| **doubao** | Stub plugin — all handlers return hardcoded mock data, no real browser interaction |
| **_shared** | Internal utility for mpage's crawler-practice server; not usable standalone |
| **01-static through 36-stock-trading** | Numbered practice/learning exercises, not production plugins |
| **t-* (t-list, t-form, etc.)** | Template test plugins that depend on `_shared` and localhost crawler-practice server |
| **browser-automation, site-framework, sandbox-bash, doom-overlay** | Only contain `VERIFICATION.md`, no actual code |

## Key API Differences

1. **Import source**: `xcli` → `@dyyz1993/xcli-core`
2. **Page access**: `CommandContext` in xcli-core doesn't include `page`. xbrowser extends it as `BrowserCommandContext` in `src/context.ts`. Plugins access page via `(ctx as Record<string, unknown>).page` which works when executed through xbrowser's browser session.
3. **Network interception**: xcli-core doesn't export `NetworkCapture`. The douyin plugin lost its network-dependent commands (5 of 7). Future work: add network capture to xbrowser's browser layer.
4. **No breaking changes** to `createSite()`, `command()`, `login()`, `logout()` APIs.

## Test Results

All 4 migrated plugins load successfully via `XBrowserPluginLoader.scanAndLoad()` and register their commands correctly.
