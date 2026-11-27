# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；由 `npm run lint:changelog` 约束（版本条目齐全、格式、去重、降序）。

## [1.38.0] - 2026-11-27

### Added
- **chrome-bridge `setFiles` 上传命令**：文件上传一等命令——`Runtime.evaluate(returnByValue:false)` 拿 objectId → `DOM.setFileInputFiles` → 回读 `fileCount` 自证；objectId 失效自动重取一次；`files[]` 为本机绝对路径，参数不合法返回 400；守卫对该命令设计上放行（chrome-bridge 插件 1.1.2）（#499、#500）。
- **守卫 file-input 规则**：evaluate 里对 `input[type=file]` 的合成点击直接拦截，替代指引从「真实鼠标点击」（对 file input 只会弹系统文件对话框）改为 `DOM.setFileInputFiles` 上传配方；普通元素的点击指引不变（#499）。
- **`waitForHuman` fail-closed**：插件等待人工协助不再阻塞——命令立即以结构化 `NEEDS_HUMAN` 结束，托管会话带 `viewerUrl`、桥接会话带 `taskName`（任务组标红「需要协助」，粘性）；插件把该错误吞掉后报成功会被运行时强制转回 `NEEDS_HUMAN`；CLI 收到 `NEEDS_HUMAN` 后不再在本地重复执行一遍插件（#494、#495）。
- **登录命令统一「先检查、再交还」**：新增 `shared/login-handoff.ts`（已登录直接成功；未登录才打开登录页并以 `NEEDS_HUMAN` 结束、不写登录态），15 个站点迁移；写法规范见 AGENTS §7.5（#496）。
- **媒体配额守卫**：同 provider 的视频提交默认串行（`--allow-parallel-quota` 显式放行），避免并发提交同时消耗多份额度；媒体 preflight 报告显式 `promptSubmitted:false` 与 `siteChecks:"skipped"`，拒绝纯空白提示词（#494、#495）。
- **大截图直接写盘**：`chrome-bridge cdp --method Page.captureScreenshot --output <file>` 返回 `{path, bytes}`，不再被 CLI 文本输出截断（#495）。
- **任务分组状态机**：分组标题按动作实时刷新（`任务名 · 状态`），新增 `chrome-bridge task --action status`；`needs-human` 为粘性状态，自动动作不冲掉（#492）。

### Changed
- **`--json` / `--yaml`（破坏性）**：浏览器类插件命令的**成功**结果也走统一信封 `{success, command, data, error, meta}`——此前成功时直接打印裸 data、失败才打印信封；直接读最外层字段的脚本改为读 `data` 字段。文本模式不变（#489）。

### Fixed
- **daemon 独立端口互踢**：带 `XBROWSER_DAEMON_PORT` 启动独立 daemon 会把 9224 上的主 daemon 关掉——登记文件全局只有一份，任何端口的启动都把别人当成「端口不一致」；现在每个端口各记一份登记（缺省端口位置不变），查状态、启停、构建不一致重启都只看当前端口那份（#490）。
- **juejin `draft` / `publish` 后台输入**：页面收不到按键（tab 在后台、窗口被遮挡）时标题自动改走 fill 通道写入，不再直接失败；页面可见时仍逐键输入（juejin 插件 4.0.2）（#491）。
- **oschina bridge 登录探测**：登出标记（如 `a[href*="/home/login"]`）命中即判未登录——登出时停在公开首页不再被误判成已登录（#493）。
- **xiaohongshu 采集假成功**：等过人工协助仍 0 条时返回 fail（含 `blocked`），不再 `ok({total:0})`（#493）。
- **doubao 视频模式判定**：只认输入框 placeholder 或模式按钮文本，不再被底部菜单的「视频生成」入口骗过（#493）。
- **任务组泄漏**：`gemini music`、`csdn draft` 失败路径与 `article-pipeline` 封面超时补收尾（#493）。
- **bridge 会话**：`eval --bridge`、后台 tab `fill('')`、插件命令 `--bridge` 路由、daemon 重启后 `session close` 收组、跨任务组劫持（#492）。
- **profile 清理静默失败**：ESM bundle 里 `require('node:fs')` 让清理空跑；`killChrome` 清理加重试；daemon health/RPC 统一 `127.0.0.1`；51CTO 登录 URL 修正（#492）。
- **运行时临时目录泄漏**：每进程每插件一份的 `xbrowser-<pid>/` 临时目录改为进程退出自清、daemon 分批清理 pid 已失效的残留；采集器 `chromium-collect-<端口>.pid` 启动时清失效条目（#498）。
- **发布类命令**：移除 18 个发布命令里无效的 `waitForHuman`，按用户决策直接发布；`seo login` / `seo register` 按页面标记判定登录态，不再写假 `loggedIn:true`（#492）。
- **仓库/文档门禁**：`lint:docs` 按插件注册表核对文档命令（修掉 28 条不存在的命令）；`npm run validate` 先自检 husky 钩子是否安装；`lint:architecture` 全仓拒绝「已跟踪却被忽略」的文件（#496、#497）。

### Removed
- **不再跟踪已忽略的数据/报告**：85 个文件退出 git（本地文件原样保留；恢复用 `git checkout 33c21d7 -- <path>`）；`scripts/` 只保留 `release/` 与 5 个白名单工具（#496、#497）。

## [1.37.0] - 2026-11-24

### Added
- **convert：四类交互步骤**：双击、右键、拖拽（指针 / HTML5 拖放）与文件选择现在都转成可回放步骤（JS / Python / Bash）；录制数据不足以回放的步骤保留为 `NOTE` 注释而不是消失（#483）。
- **媒体生成 `--preflight-only`**：gemini `generate-image` / `generate-video` / `music` 与 doubao `image` / `image-cutout` / `image-vary` / `video` / `music` 支持只做本地预检（提示词、附件存在 / 可读 / 可解码 / 像素尺寸），不打开页面、不上传、不提交、不消耗额度（#485）。
- **chrome-bridge `input-health`**：诊断目标 tab 能否收到点击 / 按键（#480）。
- **`--` 分隔符**：`xbrowser fill -- '#q' '- item'`——`--` 之后一律是位置参数，以 `-` 开头的值不再无解；全局选项（如 `--session`）要写在 `--` 之前（#479、#487）。

### Fixed
- **CLI 参数值**：值里含链分隔符时被误拆成多条命令（`fill '#q' 'x ; title'` 退出码 0 却只填了 `x`）；`"goto url;title"` 与 `"goto url ;title"` 静默丢掉后半条；带 `;` 的 URL 在引号命令串里被截断；负数坐标（`mouse move -10 -20` 报用法错误、`mouse --x -10` 静默变成 1）；crawl / scrape 的布尔参数（`--verbose`、`--allow-external-links true`、`--only-main-content false`）全部不生效（#479）。
- **鼠标驱动**：松开事件带着按键位，页面收不到 `pointerup`（指针滑块收不了尾、拖拽被录成点击）；一次右键之后所有左键按下丢失 `pointerdown`；`dblclick` 实际按了四下（#482）。
- **录制器**：默认模式丢弃右键；同一毫秒到达的 `dblclick` 信号被当作重复丢掉；CLI 的右键命令在录制里留下一条无按键信息的 `cdp-click`（#482）。
- **chrome-bridge 输入门**：页面不可见（后台 tab / 窗口被遮挡，页面 `outerWidth=0`）时点击与按键被 Chrome 丢弃却没有任何报错——现在直接返回 `[bridge-input]` 错误与补救命令；复用任务 tab 前先探活；分组不支持时降级而不是整体失败（#480）。
- **chrome-bridge 隔离开关**：`XBROWSER_BRIDGE_HTTP` 此前只对驱动层和 daemon 生效，插件命令、发布层、控制台面板等 13 处写死 9347——现在全部跟随同一个开关（#481、#484）。
- **验收命令**：`chrome-bridge acceptance` 的点击探针失败时吞掉原因、页面不可见时照样点击、版本匹配时空等到超时（#481）。
- **发版流水线**：审批门拒绝签发票据时不再吞掉 HTTP 状态码与原因（#478）。
- **doubao `image --ref`**：参考图文件缺失、按钮找不到或注入失败时不再提交任务（#485）。
- **juejin `draft` / `publish`**：重试时标题与正文被叠加输入；正文未写入却报成功；失败时不报告已创建的草稿（#486）。
- **oschina 登录判定**：未登录时被放行到编辑器步骤才报「标题输入框未找到」（#486）。
- **AGENTS**：新增「`XBROWSER_BRIDGE_HTTP` 是 bridge 的唯一隔离开关，跑有副作用的 bridge 命令前先证明路由」与「页面不可见时点击 / 按键被丢弃」两节（#484）。

## [1.36.1] - 2026-11-24

### Fixed
- **login-state 插件 marketplace 上架**：补顶层 `package.json` description（缺失导致 1.36.0 发布流水线的插件上架失败），版本 1.1.0 → 1.1.1（#476）。

## [1.36.0] - 2026-11-24

### Added
- **README 首屏与品牌**：首页开头改为「一句话问题陈述 + Features/特性 + Quick start」；统一命令/插件计数口径并接入 `lint:docs` 校验；新增 GitHub Social Preview 分享图（`branding/social-preview-1280x640.png` + 可重渲源文件）；修正 20 余处照抄会失败的示例（#465）。
- **convert：Bash 回放脚本**：经 xbrowser CLI 在单一会话内回放，任何一步失败即停止并通过 trap 关闭会话（#472）。

### Fixed
- **CLI 路由**：命令行带 `--session` / `--json` 等参数时 `;` 命令链只执行第一条；`eval --help` / `-e --help` 不再把帮助文本当脚本执行（#466、#473）。
- **CLI 参数**：kebab-case 旗标（如 `crawl --max-depth`）此前被静默丢弃，现按 schema 键映射生效；单条引号命令不再残留引号（`"click '#btn'"` 的选择器曾是 `#'#btn'`）；`eval` 帮助隐藏内部参数 `--script-b64`；`filter` 用法提示补上输出文件（#473）。
- **crawl**：`--limit` 此前会被超出「并发数 − 1」个页面（`--limit 10` 实抓 12），改为 worker 开始抓取即占名额（#468）。
- **daemon**：构建指纹不同的 CLI 不再无条件重启 daemon——daemon 持有会话时拒绝并给出出路（`XBROWSER_DAEMON_PORT` / `XBROWSER_DAEMON_SKIP_BUILD_CHECK`），`/health` 新增 `activeSessions`，旧 daemon 经 `session:list` RPC 回退查询（#470）。
- **convert**：按当前录制格式（`actions` / `cdp-fill` / `cdp-click` / `navigation`）生成脚本——此前填表与中间跳转全部丢失；JS 产物改用真实存在的 Playwright 导入（此前 import 不存在的 `launch`，运行即报错）；真实录制里一个动作的多条记录归一为一步（#472）。
- **录制器**：失败的命令不再作为动作入档；一次 CLI 点击不再同时记为 `cdp-click` 与 `click`（去重登记提前到命令执行前）（#474）。
- **npm 包描述**：还原 `@xbrowser/cli` 顶层 description（#463 误覆盖为 npm 插件的描述）（#465）。
- **content 插件**：内置推广 case 的命令/插件计数更新为 59 命令 / 125+ 插件（#469）。
- **AGENTS**：提交标题长度按字节计（含 GitHub 追加的 ` (#N)`）；新 worktree 先装 husky 钩子；worktree 内跑 `dist/` 须带独立 daemon 端口（#467、#471）。

## [1.35.0] - 2026-11-21

### Added
- **login-state 插件**：离线提取 Chrome 登录态（Cookies + Keychain 解密）导出 storageState；`login-state run` 注入无头会话。
- **托管无头会话与并发运行**：`run jobs.json --parallel N` 按会话并行并同步汇总；命令链内 `handoff` 暂停等待人工接管后继续；`session save/restore` 登录态快照；`session errors` 错题本聚合。
- **Viewer 浏览工作区**：标签页/地址栏/前进后退刷新（限本机回环 + 自启动会话）；人工接管等待状态与「继续任务」按钮；手机触控适配。
- **npm 插件 token 生命周期**：`create-token` / `list-tokens` / `delete-token`（网页登录 + 邮件 OTP + granular token 表单自动化，含中文 schema 问卷）。
- **OIDC Trusted Publishing**：`publish-npm` 迁移至 npm Trusted Publishing（`id-token: write`、node 24、移除 NPM_TOKEN 依赖），v1.35.0 起发布带签名 provenance。

### Fixed
- **CDP 页注册去重**：context 页表按 targetId 唯一化——同一 Chromium 标签此前最多产生 3 个包装对象。
- **前进/后退历史**：`goBack`/`goForward` 改用 `Page.navigateToHistoryEntry`，不再以重新导航销毁前进历史。
- **同文档导航**：`goto` 对 `#hash` 类导航按 loaderId 缺失即时完成，不再空等 15 秒超时。
- **Viewer 裁剪/二维码**：裁剪视图画面在面板尺寸变化后保持不清屏；二维码验收改按显示尺寸判定。
- **net-routes 测试 mock**：补 `SessionStore` 导出（会话重构引入的导入链断裂）。

## [1.34.0] - 2026-10-27

### Added
- **Blogger publishing protocol**：新增 Blogger 站点发布适配，覆盖新建博文、标题/正文写入、iframe 交互与发布结果验收。
- **Chrome Bridge zero-human acceptance**：新增 `xbrowser chrome-bridge acceptance`，自动完成扩展 reload、重连与版本校验、窗口/tab 诊断、真实 trusted click 探针和任务组清理；失败时返回机器可读的 Computer Use 恢复指令。
- **Login Bridge direct cookie read**：新增 `get-site-cookies` executor，可按授权域名直读 cookie，不再必须先归档到 9355 服务。
- **Release hardening**：发布流水线增加 E2E 硬门禁、dry-run 演练、console 补测与更完整的发布证据。

### Fixed
- **Publishing reliability**：修复 CSDN 双份粘贴、OBS 空 body、bridge 登录误判、知乎雪花 id 精度丢失，以及 Blogger CSP/窗口/renderer 导致的真机发布失败。
- **Gemini media flow**：修复视频生成管线、SPA URL 跟踪、提交按钮合成点击被 CDP-Guard 拦截、拒绝检测选择器漏检，以及 history-list 任务组名泄漏。
- **Chrome task windows**：任务 tab 显式挂载到真实用户窗口，并在激活后测量窗口尺寸，避免 CDP 输入静默丢弃。

## [1.23.1] - 2026-09-10

### Added
- **MCP Server**：`xbrowser mcp` 启动 stdio Model Context Protocol 服务器——Claude Desktop / Cursor / 任何 MCP 客户端可直接驱动浏览器。7 个工具（navigate / act / read / snapshot / screenshot / network / replay），薄壳设计直接复用 executor，JSON-RPC 2.0 协议层手写零新依赖。接入：`claude mcp add xbrowser -- xbrowser mcp`

## [1.23.0] - 2026-09-10

### Added
- **content 内容营销插件**：`xbrowser content cases/draft/cover`——内置自推广 case 库（自愈回放/CLI for AI agents/stealth，中英双语），模板渲染 + 浏览器自渲染 OG 封面（零绘图库），与 18 个平台 publish 插件正交组合
- **chrome-bridge attach/finish 显式接管生命周期**：`attach --task "任务名"` 把用户当前 tab 打入 🤖 任务分组（可见标签），后续命令 `--tab-id` 显式路由；`finish` 收尾——桥自建 tab 关闭、用户 tab 只脱组保留绝不关闭
- **🤖 任务分组与空闲回收**：桥的命令自动落入带任务名的后台 tab 分组，10 分钟空闲自动回收；S207 防当面换页（用户盯着任务 tab 时另起新 tab 执行）
- **quality gates 双盲区根治**：tests/（256 文件）首次纳入 ESLint 与 typecheck 覆盖，458 处存量债务清零，`typecheck:tests` 接入 pre-commit 与 CI

### Fixed
- **chrome-bridge --args JSON 丢参**：CLI 层 parsePluginParams 把 JSON 解析成对象后 handler 拼成 `[object Object]`（cdp 分支静默丢参）——双形态归一化修复
- **桥接管用户 tab 事故**（S205）：无任务组时 navigate/evaluate 直接改写用户正在看的页面——永不 fallback 到用户活跃 tab
- **幽灵依赖**：`.xcli/plugins/node_modules` 反复带回 xcli-core 0.9.x 旧版（ensure-deps 声明 ^0.9.2 永不升级）→ 升 ^0.19.0 根治

## [1.9.9] - 2026-07-24

### Added
- **录制器自动快照**：关键动作（click / navigation / input / submit / popup_appear）后自动捕获 viewport 截图 + 紧凑 accessibility tree
  - 截图存到 `.tmp/snapshots/step-N.png`（独立目录，`rm -rf .tmp/` 即可清理，不影响核心数据）
  - accessibility tree 以文本字符串 inline 到 action 上（`snapshots.aria`），可 `grep` / `jq` 搜索
  - 新增 `recording.jsonl` — 每行一个 action，便于流式搜索和按行清理
  - 数据结构：`UserAction.snapshots = { png?: string; aria?: string }`
- **`snapshotsDir` getter** — 统一管理 `.tmp/snapshots/` 路径

### Changed
- **录制器降噪**（用户反馈"hover 全是噪音"）：
  - Hover 过滤增强：仅保留触发了**实质弹窗**（有菜单项）的 hover；tooltip 类小弹窗不再记录
  - `popup_appear` 去重窗口 500ms → **3s**，且只保留 `userTriggered`（hover/click 触发），过滤掉 `auto` 检测的
  - `__xb_seen_popups` 过期时间 5s → 10s，减少同弹窗重复触发
  - 微调滚动过滤：`< 50px` 的滚动不再记录
- **输出格式**：`recording.json` 之外新增 `recording.jsonl`（每行一个 action，便于流式搜索）

### Fixed
- **#daemon-kill-browser**：CDP 模式（连接外部浏览器）下，daemon 重启/进程退出不再误杀用户的浏览器进程
  - `cdp-driver/browser.ts` 的 `close()` 现在根据 `childProcess` 区分：自启动 → 杀进程清理；外部 CDP → 仅断开 WebSocket
  - `src/browser.ts` 的 `process.on('exit')` / `destroyBrowser` / `ensureProcessCanExit` 不再调用 `browser.close()`，只清理引用
  - CDP 模式 `closeSessionByName` / `closeAllSessions` 不关用户页面，仅断开连接
- **#session-new-tab**：每次 CLI 命令不再新开浏览器 tab
  - `rpc-handlers.ts` 的 `handleSessionCreate` 优先复用同名 session（不再无条件 `createSession`）
- **#anti-bot-false-positive**：验证码检测误判 — 页面上隐藏的（off-screen / display:none）captcha 容器不再被误判为"检测到验证码"并阻止 click
  - `lib/anti-bot.ts` 现在检查 `isVisible()` + off-screen 位置（`y < -1000` 或 `x < -1000`）才报告检测到验证码
  - 修复了腾讯防水墙（tencent-captcha-dy）等"DOM 常驻但隐藏"型验证码容器的误判

## [1.9.8] - 2026-07-07

### Fixed
- **#233**: `title` 命令在 cdp-tunnel/extension 模式返回空 — `page.title()` 加 polling 重试（最多 1s）+ `Target.getTargetInfo` 兜底
- **#234**: `elementScreenshot` 经常缺失 — 超时 2s→3s + waitForSelector 重试 + viewport 截图兜底
- **#235**: replay result shape 不稳定 — 新增 `normalizeReplayResult` 统一所有返回路径，修 `eventIndex` 硬编码 `-1` 问题

## [1.9.7] - 2026-07-07

### Fixed
- **#231**: `plugin search` 命名归一化 — 新增本地已安装插件搜索（`normalizePluginName` 去 `@xbrowser/` / `xbrowser-plugin-` 前缀），按 exact > prefix > substring 排序，结果去重

## [1.9.6] - 2026-07-04

### Fixed
- **#225**: 重复 click/fill 事件去重 — `dedupMap` 替代 `cdpActionDedup` 单条目，双向去重覆盖 race condition
- **#226**: 更稳定的 selector 策略 — 删除无效的 `:has-text`，新增 `data-*` / `[role][name]` / `[role][aria-label]` / `tag[aria-label]` 策略
- **#227**: 录制源头降噪 — 默认过滤 hover/focus/scroll 等 ambient 动作，支持 `--stream raw` 保留全部
- **#228**: 成功信号 — `verifyAction()` 在 click/submit/input 后收集 URL change / 2xx-3xx network / dialog 信号，写入 `RecordingStep.signals`

## [1.9.0] - 2026-06-26

### Added
- **#185**: 录制时自动截取元素截图 — 关键操作（click/input/change/dblclick + CDP 变体 + filechooser）后自动截取目标元素，base64 PNG 存入 `action.elementScreenshot`，供 Browser Agent 工作台渲染可视化操作时间线

### Changed
- 移除死代码 `RECORDING_INJECT_JS` 注入路径（无 client 消费）
  - 删除 `RECORDING_INJECT_JS` 脚本 + `injectRecording()` + 2 处调用
  - 删除 4 个 legacy `recording:status/events/clear/save` RPC handler + dispatch
  - 移除 `__xb_rec`/`__xb_evts`/`__xb_t0` window 类型声明（保留 `__xb_describe`）
  - 每个录制页面减少一个 MutationObserver + 6 个 capture-phase 事件监听的开销
- `recordCommandAction()` 改为 async 以支持截图

## [1.4.0] - 2026-06-24

### Changed
- 升级 `@dyyz1993/xcli-core` 0.15.0 → 0.16.0
  - `ok()` 现在自动接受 `string[]` 和 `Tip[]` tips（向后兼容）
  - `PluginLoader` 支持热重载
  - 移除了 xbrowser 核心层手动 `normalizeTips()` 的必要性（保留用于安全）

## [1.3.1] - 2026-06-24

### Fixed — Critical regressions from 1.3.0
- **#71 B4**: `||` 命令链空输出 — `isChainInput` 正则缺少 `||` 匹配
- **#71 B5**: `tab` 命令需要 `--subcommand` — 现在支持位置参数 (`tab list` / `tab new url`)
- 链式输出修复 — `||` 链现在正确显示 [OK]/[FAIL] + 数据

## [1.3.0] - 2026-06-24

### Fixed
- **#62/#58**: 插件安装后缺少 `shared/` 依赖导致加载失败
  - 安装器新增 `fixSharedDeps()` — 自动扫描 `../shared/` import 并从本地仓库复制缺失文件
  - 插件加载失败不再静默 — 始终显示警告 + 修复建议
  - 影响 douyin/xiaohongshu 等 import `shared/ssr-detect.js` 的插件

- **#59**: zhihu trending/search 选择器更新（知乎改版导致 0 条结果）
  - 兼容新旧 DOM 结构
  - waitForTimeout 增至 3000ms

### Changed
- 插件加载器：默认显示加载失败警告（不再需要 XBROWSER_DEBUG）

## [1.2.2] - 2026-06-23

### Fixed
- `record stop `--output` 现在写入指定路径 (#57)
- `replay` 支持 YAML 文件（JSON.parse 失败后 fallback yaml.parse）(#57)
- `setCookie` 数字值类型校验 — `z.coerce.string()` 自动转换 (#59)
- daemon 插件缓存 — 新增 `plugins:reload` RPC + `resetPluginLoader()` (#58)
- `plugin install` 后自动通知 daemon 重新扫描插件 (#58)

## [1.2.1] - 2026-06-23

### Fixed
- 与 [1.2.0] 同日发布（该条目内容见下）。

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

## [0.1.4] - 2026-05-30

### Added
- Initial CLI release
