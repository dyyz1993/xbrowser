
## [1.1.0] - 2026-08-31

### Added
- screenshot 执行器支持 tabId：debugger Page.captureScreenshot 可截后台任务 tab（旧版 captureVisibleTab 只能截用户激活页，曾误截无关页面）

### Fixed
- 生图链路配套：task-close 先行防旧会话污染（配合 article-pipeline S161-162 修复）

## [1.2.0] - 2026-08-31

### Added
- **L1 可见性一致性层**：task-open 自动预置 document_start 伪装（visibilityState/hidden/hasFocus 恒 visible + visibilitychange 重断言 + rAF 垫片），任务 tab 持久 attach，evaluate/trustedClick/screenshot 复用不再反复 attach/detach（顺带根治 "Another debugger already attached" 残留）
- **L2 warmup 预热执行器**：trusted 鼠标轨迹（变速曲线+过冲回修+抖动）+ 停顿 + 小幅滚轮，为防守方事件数组铺垫自然前排数据

### Fixed
- 任务 tab 上 screenshot 走持久 attach，不再每次 detach-first

## [1.3.0] - 2026-08-31

### Added
- **win-open/win-close 执行器（L0 真渲染模式）**：任务放进 400x300 可见 popup 小窗（focused:false 不抢焦点）——实测 rAF 帧距 17ms（hidden 模式 ~1000ms）、trusted mousemove 到达率 98.9%（hidden 0.6%）、visibilityState 天然 visible；L1 伪装保留作防御纵深

### Fixed（1.3.1）
- **L1 原型逃逸封堵**：实例 defineProperty 覆写可被 `getOwnPropertyDescriptor(Document.prototype,...).get.call(document)` 一行拿真值——getter 现于原型与实例两层同步覆写，toString 伪装 native

## [1.4.0] - 2026-08-31

### Added
- **ext-reload 执行器**：WS 消息直达 SW 调 chrome.runtime.reload()——热更新不再依赖 popup 页面绑定（时好时坏）与 GUI 点击；ping 响应带 manifest version（激活验证闭环）

### Fixed（1.4.1）
- 端到端验证 ext-reload：bridge 命令 → SW 重启 → ping 带磁盘版本号，8 秒闭环零 GUI

## [1.4.2] - 2026-09-12

### Fixed
- 「No current window」：SW 上下文 tabs.create/captureVisibleTab 显式解析 windowId（getLastFocused → 首个 normal 窗口兜底），不再依赖"当前窗口"隐式语义

### Added
- WS 连上即上报 hello（extId + 版本）→ bridge 持久化 `~/.xbrowser/chrome-bridge-ext.json`（revive 命令据此唤醒）
- CONNECTING 卡死 >15s 强制 close 重连（半开 TCP 时 onclose 永不触发，是 SW 死透根因之一）
- 应用层 ka 帧早退处理（配合 bridge 25s 心跳给 SW 续命）
