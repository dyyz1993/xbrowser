
## [1.1.0] - 2026-08-31

### Added
- screenshot 执行器支持 tabId：debugger Page.captureScreenshot 可截后台任务 tab（旧版 captureVisibleTab 只能截用户激活页，曾误截无关页面）

### Fixed
- 生图链路配套：task-close 先行防旧会话污染（配合 article-pipeline S161-162 修复）
