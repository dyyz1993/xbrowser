# Changelog

## [1.2.0] - 2026-06-23

### Fixed — 14 个 bug 修复（10 个 issue）

**插件系统**
- `plugin install` 后插件不重新加载 — 改用异步 `getGlobalPluginLoader` + `reloadPlugin` (#32)
- stdin/heredoc 模式忽略 `--session` 参数 — `handleStdinMode` 现在提取 session 名 (#32)
- `plugin uninstall` 对不存在的插件返回 ok — 现在检查插件是否存在后调用 reload (#32)

**CDP 驱动**
- `find` 命令生成无效 xpath 选择器 — 创建 `selector-utils.ts`，`xpath=` 前缀走 `document.evaluate()` (#43)
- `getByText`/`getByLabel` 的 xpath 选择器在所有 locator 方法中可用（click/fill/count/visible 等）
- `FilteredLocator`（`.first()`/`.last()`/`.nth()`）支持 xpath snapshot 索引
- alert/confirm/prompt 弹窗导致 `eval` 挂起 — 自动 dismiss 从 100ms 降到 0ms + 预评估清理 (#48)
- `evaluate()` 前先 dismiss 残留 dialog，防止 30s 超时

**命令修复**
- `health` 命令 ReferenceError — `errMsg()` 在 `page.evaluate()` 浏览器上下文中未定义，改为内联 (#41)
- `waitForTimeout` 命令恢复 — 新增 `scope:project` 的 CLI 命令 + chain-parser 定义 (#41)
- CDP 连接失败退出码为 0 — 空结果后 `process.exit(1)` (#41, #49)
- `;` 分隔符语义像 `&&` — chain-parser 对 `;` 使用 `type='sequence'`，失败继续 (#41)
- camelCase 命令名不支持 — 添加 `CAMEL_TO_KEBAB` 映射表 (getCookies→get-cookies 等 7 个) (#44)
- `screenshot` 位置参数路径被忽略 — 支持位置参数作为 `--output` (#47)
- `scrape` Element UI 表格转换不完整 — JS 提取表格 + Markdown 输出 (兼容 el-table/ant-table/MUI) (#46)

**文档与帮助**
- `plugin publish` → `marketplace publish` 文档统一 (#45)
- `--help` 子命令返回主帮助 — 添加 SUBCOMMAND_HELP 映射 (session/plugin/record/daemon 等) (#50)

### Security
- `ws` 依赖升级到 `^8.21.0`（修复 HIGH 级别漏洞：内存泄漏 + DoS）

### Changed
- CI Node.js 版本从 20 升级到 22
- E2E 测试修复 `chromium is not defined`（改用 `launch()` from browser-shim）

## [1.1.2] - 2026-06-23

### Fixed — 文档与规范修正（3 轮全量扫描）

**AGENTS.md（AI Agent 工作手册）**
- 修正子章节编号：20 处编号与父章节不匹配（如 `### 2.x` 出现在 `## 3.` 下），全部对齐
- 修正交叉引用：`触发 5.2 的` → `触发 6.2 的`
- 修正插件数：`138+` → `69`（实际目录数）
- 修正命令数：`35` → `49`（实际 `registerCommand` 调用数）
- 修正内置命令速查表：删除虚构命令 `attach`/`getProperty`，补充遗漏命令 `dblclick`/`uncheck`/`scrape`/`crawl`/`search`/`observe`/`act`/`find` 等
- 修正速查表 record 语法：`record start ... && stop` 拆分为两条独立命令
- 移除无法运行的 `marketplace publish` 示例

**docs/ — daemon 命令残留清理（19 处）**
- `docs/quickstart.md`：移除 `daemon start`/`stop`/`status` 示例，改为自动启动说明
- `docs/commands.md`：daemon 章节替换为自动启动说明；Scope 表移除 daemon
- `docs/chains.md`：daemon start 示例替换
- `docs/builtins.md`：Daemon Management 章节替换

**docs/ — 虚构命令清理**
- `docs/commands.md`：删除不存在的 `evaluateFn` 命令章节
- `docs/commands.md`：删除不存在的 `getSessionStorage`/`setSessionStorage`/`clearSessionStorage` 命令章节
- `docs/commands.md`：删除不存在的 `getProperty` 命令章节
- `docs/commands.md`：删除不存在的 `waitForTimeout` 命令章节
- `docs/quickstart.md`：`getProperty` 替换为 `eval`
- `docs/architecture.md`：移除 `getProperty` 和 `waitForTimeout` 引用

**docs/architecture.md — 过时数字修正**
- `35 个浏览器命令` → `49 个内置命令`（3 处）
- `12 个文件` → `27 个文件`（1 处）

### Fixed — 旧命令名 agent-browser → xbrowser（22 处）

- `.xcli/plugins/doubao/index.ts`：3 处
- `.xcli/plugins/qwen/index.ts`：1 处
- `.xcli/plugins/qianwen/index.ts`：2 处
- `.xcli/plugins/deepseek/index.ts`：3 处
- `.xcli/plugins/claude/index.ts`：2 处
- `.xcli/plugins/chatgpt/index.ts`：2 处
- `src/commands/detect.ts`：1 处
- `src/commands/agent.ts`：1 处（参数描述）
- `src/commands/snapshot.ts`：1 处（参数描述）
- `src/commands/promo.ts`：2 处（参数描述）
- `src/promo/quora.ts`、`juejin.ts`、`csdn.ts`、`medium.ts`、`devto.ts`：各 1 处

### Fixed — 源码规范

- `src/builtins/preview.ts`：过时提示 `xbrowser daemon start` → 自动启动说明
- `src/cli/plugin-routes.ts`：过时用法 `daemon <start|stop|status>` → 自动启动说明
- `tsconfig.json`：加入 `bin/**/*` 到 include，使 typecheck 覆盖 CLI 入口文件

### Fixed — 测试同步

- `tests/cli/plugin-routes.test.ts`：同步 daemon 用法提示断言文本

## [1.0.0] - 2026-06-05

### Milestone: Zero-Dependency CDP Driver

Complete replacement of Playwright with a custom Chrome DevTools Protocol (CDP) driver. Zero runtime dependencies for browser automation — raw `ws` + CDP protocol only.

### Changed (Breaking)
- **Removed Playwright dependency entirely** — zero runtime `playwright` imports
- **Custom CDP driver** (`src/cdp-driver/`) — 16 source files, ~4200 lines
- **Route interception** migrated from deprecated `Network.setRequestInterception` to `Fetch.enable`/`Fetch.requestPaused`/`Fetch.fulfillRequest`

### Added
- Full locator API: `click()`, `fill()`, `press()`, `hover()`, `check()`, `uncheck()`, `selectOption()`, `type()`, `pressSequentially()`
- Locator filtering: `first()`, `last()`, `nth()`, `filter({visible})`, `all()`, `focus()`
- Element handle API: `click()`, `fill()`, `hover()`, `press()`, `screenshot()`, `boundingBox()`, `isVisible()`, `isEnabled()`, `textContent()`, `innerText()`, `innerHTML()`, `getAttribute()`, `scrollIntoViewIfNeeded()`, `dispose()`
- Page API: `waitForSelector` (all states), `waitForFunction`, `waitForResponse`, `waitForRequest`, `waitForURL`, `route()`/`unroute()`, `setInputFiles`, `dragAndDrop`, `setOfflineMode`, `setExtraHTTPHeaders`
- `VisibleFilteredLocator` subclass for `filter({visible: true})`
- Chrome exit handler with tmpDir cleanup
- 115 new tests (element-handle: 45, locator-advanced: 70)
- 2032 total tests, all passing

### Fixed
- `waitForSelector(state='hidden')` now properly waits for `display:none`/`visibility:hidden` elements
- `screenshot()` clip coordinates rounded to integers, minimum 1px dimensions
- `waitForFunction` double-invoke diagnostic
- Network response/request race condition
- `createXBResponse` body methods
- `globToRegex` escaping
- Deduplicated `setExtraHTTPHeaders`
- Route handler try/catch for resilience
- `networkIdleTimer` cleared in `close()`

### Test Coverage
- `locator.ts`: 98.56% (was 39%)
- `element-handle.ts`: ~100% (was 18%)
- CDP driver overall: 75.95%

### Added
- search 命令：搜索引擎查询（Bing/Google/Baidu/DuckDuckGo）
- 自动引擎降级：Bing→Google→Baidu→DDG 依次尝试
- --full 模式：搜索结果并发抓取全文内容
- playground SearchPanel 组件：前端搜索 UI
- playground search API：/api/cdp/search 端点

## [0.5.6] - 2026-05-09

### Fixed
- 修复 SPA hash 路由爬取（#/、#!/）— 先加载基础页面再导航 hash
- 增强 GitHub 仓库页面噪音过滤（24 个选择器）
- 修复 crawl.test.ts 复制粘贴函数 → 改为 import 源码
- verbose 进度输出改用 stderr（API 模式下也可用）

### Added
- isSpaHashRoute、deduplicateUrls 测试用例
- actions timeout 测试用例

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.5] - 2026-05-09

### Fixed
- Refactored html-to-markdown: replaced regex with cheerio, built-in base64 image filtering
- Fixed convert.ts aggregateEvents logic bug (Enter/Tab event loss)
- Eliminated all `any` types

### Added
- Crawl concurrent fetching (--concurrency parameter, default 3)
- Crawl robots.txt support
- Crawl retry mechanism (--retries parameter, default 2)
- Crawl/map progress feedback (--verbose)
- Actions timeout protection (--timeout parameter)
- Unified URL utility functions in src/utils/url.ts
- Unified pluginLoader singleton
- Help text: added scrape/crawl/map commands
- husky + lint-staged + commit-msg hook (any ≤ 100 check)

### Changed
- Cross-platform compatibility: HOME → os.homedir()
- Browser lifecycle: scrape/crawl/map use ephemeral BrowserContext instead of full Browser
- Added idle timeout (5 min) for automatic browser cleanup

## [0.5.4] - 2026-05-09

### Fixed
- Refactored html-to-markdown with cheerio replacing regex HTML parsing
- Built-in base64 image filtering and expanded noise selectors

## [0.4.0] - 2026-05-06

### Changed
- Refactored `installer.ts` (638 lines) into multi-module architecture (install-sources/local, npm, git, url, marketplace + install-utils)
- Unified `DEFAULT_MARKETPLACE_URL` and `NPM_REGISTRY_URL` constants into `config.ts`
- Eliminated `any` types in `websocket-server.ts`
- Extracted `readJsonFile`/`writeJsonFile` utility functions to reduce JSON.parse duplication
- Updated ESLint config to disallow empty catch blocks
- Added `noUnusedLocals`, `noUnusedParameters`, `forceConsistentCasingInFileNames` to tsconfig
- Added vitest coverage thresholds (branches/functions 50%, lines/statements 55%)
- Added `coverage/`, `*.log`, `.DS_Store` to `.gitignore`

### Fixed
- Resolved undici dependency version conflict (removed devDependencies v8, kept optionalDependencies v7)

## [0.2.0] - 2025-05-05

### Added
- Interactive WebSocket preview with screencast support
- Plugin search with npm registry integration
- Plugin metadata parser for richer information
- Command chains with shell-safe separators (`,`, `+`, `->`)
- Pipe and file input modes for command execution
- `-e` flag for inline command execution
- WebSocket server for real-time browser interaction
- Rich documentation (quickstart, chains, preview, WebSocket)

### Changed
- Improved router architecture
- Better daemon session management
- Enhanced built-in commands structure
- Improved plugin installation workflow

### Fixed
- Command name aliases
- Double-wrap in ok() function
- Session cleanup issues

### Performance
- Optimized plugin loading
- Better command execution performance

## [0.1.4] - Previous
- Initial CLI release
