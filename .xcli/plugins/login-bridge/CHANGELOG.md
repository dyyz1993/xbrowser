## [1.5.6] - 2026-11-26

### Added
- **任务分组标题显示状态**：标题 = `任务名 · 状态`。扩展按每条命令自动刷新动作级状态
  （打开页面 / 填写 #title / 点击页面 / 上传文件 / 截图…），读类命令（evaluate 等）不改标题。
  新增 `task-status` 执行器供插件 / 框架显式上报阶段与终态，`state` 决定组颜色：
  `running` 任务色 / `needs-human` 红（粘性，自动动作不冲掉）/ `awaiting-user` 黄 /
  `done` 绿 / `failed` 红。`task-open` 可带初始 `status`，`task-list` 返回
  `title` / `status` / `state` / `kind`
- **`getTaskTabId` 防跨任务串台**：带任务名的命令只认同名的显式组。此前只要有任意
  `xb-task-*` 组存在，别的任务的 `--task` 命令（不带 tabId）就会落进那个组的 tab
  （隔离 Chromium 实测：B 的命令读到了 A 的 URL）；没带任务名时沿用旧行为

### Fixed
- **清空输入框被误判**：`fill` 的 `value` 为 `''` 时回读为空是期望结果，不再当成
  「input not retained」并要求升级键盘流。CLI 的 `fill` 默认先清空，旧版在后台任务 tab 上
  每次都在这一步失败
- 自动组带状态后缀后仍按任务名复用；`attach` 同理

## [1.5.5] - 2026-11-24

### Fixed
- **页面不可见时输入静默丢失**：tab 在后台、或窗口最小化 / 被完全遮挡时（页面
  `window.outerWidth` 读作 0），Chrome 丢弃鼠标点击与原始按键事件，而
  `Page.bringToFront`/`elementFromPoint`/JS `.click()` 全"正常"——「点了没反应」「打了字
  没进去」的真因。发这类事件的执行器（trustedClick / trustedDrag / trusted-type /
  trusted-enter / type，以及 cdp 透传里的 `Input.dispatchKeyEvent` 与
  mousePressed/mouseReleased）先按页面里量到的 `outerWidth` 过输入健康门，不健康立即报
  可行动错误（tab 在后台先 `tab-activate`；窗口被遮挡用 `tab-move` 或 `win-open`）。
  mousemove、insertText 与页面脚本类执行器（click / fill / warmup）不受影响。新增
  `input-health` 诊断执行器
- **task-open 分组降级**：win-open 的 popup 窗口成为 lastFocused 后，safeCreateTab 把新
  tab 建进 popup，tabs.group 抛 "Grouping is not supported" 导致整个 task-open 失败——
  先搬 normal 窗口重试一次，仍不行裸 tab 继续，绝不整体失败（返回 `groupingDegraded`）
- **task-open zombie tab**：复用任务组 tab 前先 `chrome.tabs.get` 探活（已关/discarded
  视为死），死条目出组并剔出 taskTabs 注册表后开新 tab，不再 `reused:true` 交回死 tab

## [1.5.4] - 2026-11-19

### Fixed
- 多客户端并发串台：`getTaskTabId` 在首个 await 前同步捕获任务名（onmessage 逐帧覆写
  全局 `currentTaskName`，交错命令会解析到别人的任务组——旧代码真机 6/6 串台，修复后 6/6 隔离）

## [1.5.3] - 2026-10-26

### Added
- `get-site-cookies` executor returns authorized-site cookies directly over the bridge without archiving them to port 9355.

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

## [1.5.1] - 2026-10-15

### Fixed
- Serialize task group lifecycle operations so concurrent `task-open` calls reuse one colored group instead of creating duplicate groups
- Reuse an existing explicit task group on repeat `task-open`; added regression tests for stable colors and concurrent different-task groups

## [1.5.0] - 2026-10-15

### Changed
- Task groups are now per-task-name: concurrent tasks create separate named groups
- Group titles show `🤖 <task>` (auto) or `xb-task-<task>` (explicit), with a stable deterministic color per task name
- Attach only reuses the group for the same task name instead of any 🤖 group
## [1.5.1] - 2026-10-18

### Fixed
- **debugger 死锁**：同 tab 调试器命令按 tabId 串行化，单条命令 12s 硬超时，杜绝嵌套 enqueue 自等
- **detach/attach 洪泛**：`already attached` 改为复用现有持久 attach；不再每次 detach-first 暴露 debugger 空窗
- **registry 失效自愈**：cdp-detach / reload / 外部 DevTools detach 后，stale registry 会被 probe 或 attach 修正
- **崩溃诊断台账**：新增 diagnostics 执行器与 tab/debugger 生命周期记录（attach、detach、page loading/complete、tab removed），最多保留 200 条
- **任务 renderer 隔离**：显式 tabId navigate 且目标 active 时，先关闭旧 renderer 再开新 tab，避免 V8 堆/历史跨任务累积（BOSS V8 OOM 长跑复现根因）
- 新增 `tab-reload` 执行器

## [1.5.0] - 2026-10-17

### Added
- chrome-bridge 控制通道（WS 9346 / HTTP 9347）+ task tab groups + stealth 任务页

