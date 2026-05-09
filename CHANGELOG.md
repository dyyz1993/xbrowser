# Changelog

## [0.5.7] - 2026-05-09

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
