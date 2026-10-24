# Learnings

> 本文件由 self-improvement 技能维护。条目格式见技能文档。

## [LRN-20261022-001] correction

**Logged**: 2026-10-22T02:35:00+08:00
**Priority**: high
**Status**: pending
**Area**: docs

### Summary
验证码/登录人机接管时必须主动给出 viewer URL，而不是让用户去找浏览器窗口

### Details
掘金拼图验证码自动化 13 连败后交还人类，我最初让用户「切到 Chromium 窗口拖滑块」，用户纠正：「我需要滑动的话，那你就给出一个 viewer 的地址，然后我自己去划就好了」。用户通过 http://localhost:9224/preview/default 一次完成滑块+登录。xbrowser 的产品哲学（AGENTS §6 验证码让出控制权）本就内建了 viewer，交还控制权时必须附上 viewer URL，不要让用户操作宿主窗口（窗口可能在别的 Space/被远控占用）。

### Suggested Action
把「人机接管交付物=viewer URL」写进 AGENTS §6.1 的显眼位置；所有 waitForHuman 提示语模板带上 viewerUrl

### Metadata
- Source: user_feedback
- Related Files: src/cli/viewer-routes.ts
- Tags: viewer, human-gate, captcha
- See Also: ERR-20261022-001
- Recurrence-Count: 1
- First-Seen: 2026-10-22
- Last-Seen: 2026-10-22

---

## [LRN-20261023-002] correction

**Logged**: 2026-10-23T10:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
xbrowser logo 草案应优先用更少的视觉元素表达 CLI 定位

### Details
用户要求查看更简洁的方向。原有三版都包含浏览器框、路径或节点，视觉元素偏多。已将草案缩减成 Mono X、Prompt 和 Tab X 三版，并在 16 px 预览中检查识别度。随后用户希望仍保留少量浏览器元素，因此增加了仅含窗口控制点与分隔线的 Prompt Chrome，以及单 tab 轮廓的 Tab Prompt；前者在 16 px 下仍清楚。用户进一步指出应有能直接认作浏览器的局部轮廓，已补 Browser Half（浏览器上半框）和 Browser Crop（裁切浏览器框）两版。用户明确否定 Browser Crop，因为框体将 prompt 包住、复杂度又回到小界面；已收敛成只保留顶部 chrome 的 Open Chrome Prompt。用户又要求以线条为主，因此做了 Line Chrome Prompt：浏览器顶栏、控制点、prompt 和光标全部由圆角描边构成。用户提供 Prompt Chrome 作为更合适的基准，并要求控制点与横线融合成一笔；已做 Fused Chrome Prompt，以一条同色 `···—` 圆角路径表达 browser chrome，并提供三种背景色调对比。用户指出整个 UI 视觉偏下，因此将 Fused Chrome Prompt 的完整主体组上移 52 px，使顶部与底部留白平衡。用户提出以 X 表达丰富能力、浏览器、插件与插件市场、以及速度；已以四段式 Ecosystem X 替换 terminal prompt，保留上方 browser chrome，并用四个交汇分支表达扩展生态。用户进一步明确四条分支各自应代表不同能力并在中心汇集；已增加显式中心核，并固定 Browser、Speed、Plugins、Marketplace 的四分支语义和色彩映射。用户修正中心的表达：四种颜色应沿各自路径融向同一混合色，而不是盖一个圆点；已删除中心圆，并让四条路径渐变汇入 `#AFCFF4`。用户指出四条独立渐变在中心仍有可见扇形分割；已改用单一 X mask 承载四源径向色场，每个分支在抵达交叉前透明过渡到共同底色，使中心成为无缝连续融合区。最后用户明确外臂从起点到接近交叉处应保持本色，不能整条渐变；已把每个色场的纯色延伸至外臂末端，只在中心线最后约 16 px 内融向共同中心色。用户确认 Ecosystem X 的结构，并要求更大胆地比较背景与四分支颜色；已输出六组高饱和候选，且固定同一分支顺序和中心融合规则，方便在不改变语义的前提下选择氛围。用户随后确认 Aurora 方案为项目 logo，并要求统一相关网站目录与 Cloudflare 部署；已将主标、四尺寸 PNG、明暗字标、marketplace 全套 Web 图标/theme/OG 图、docs favicon/theme 统一到同一主源，并在 AGENTS.md 与品牌契约中登记站点部署资产。用户再次指出页面导航栏仍是旧插件图标；已补齐可见品牌位，将 Navbar 中的 Plug 图标替换为官方 /icon.svg，并重新构建部署。上线后用户询问提交必要性；确认线上部署已可回滚，但源码必须提交，docs 旧构建产物不纳入 logo 提交。用户授权分别提交并推送；master 被保护分支拒绝后改走 codex/aurora-brand PR，marketplace 直推成功，docs 先合并远端新增 workflow 再推送，品牌源码已进入远端。

### Suggested Action
后续品牌草案先从单一轮廓或单个符号开始；若需表达产品类别，再增加一个最小浏览器 cue，而不是恢复完整窗口外框。

### Metadata
- Source: user_feedback
- Related Files: branding/concepts/mono-x.svg, branding/concepts/prompt.svg, branding/concepts/x-tab.svg, branding/concepts/prompt-chrome.svg, branding/concepts/tab-prompt.svg, branding/concepts/browser-half-prompt.svg, branding/concepts/browser-crop-prompt.svg, branding/concepts/open-chrome-prompt.svg, branding/concepts/line-chrome-prompt.svg, branding/concepts/fused-chrome-prompt.svg, branding/concepts/ecosystem-x.svg
- Tags: branding, logo, simplicity
- See Also: LRN-20261023-001
- Pattern-Key: branding.minimize_logo_elements
- Recurrence-Count: 18
- First-Seen: 2026-10-23
- Last-Seen: 2026-10-23
- Latest-Decision: User approved the Aurora Ecosystem X as the official logo; replace canonical mark, icon derivatives, and wordmarks before future product-facing use.

### Context Maintenance
- Decay-Type: decision
- Decay-Rate: durable (visual direction preference)
- Authority: user feedback; Owner: project maintainers
- Revalidation: compare against the selected identity before future asset work; revise when a final direction is chosen
- Validation: verified; Last-Validated: 2026-10-23; Evidence: eleven reduced SVG concepts, three background-tone previews, semantic branch mapping, a seamless masked color field inspected at 4x, 16 px exports after optical centering, an outer-solid/center-only blend inspection, six colorway renders, the approved Aurora mark rendered as four icon sizes plus light/dark wordmarks, and marketplace/docs deployment derivatives verified in live HTTP responses including the navbar bundle and source commit boundaries
- Disposition: retain; Application: applied

---

## [LRN-20261022-002] best_practice

**Logged**: 2026-10-22T02:35:00+08:00
**Priority**: medium
**Status**: pending
**Area**: backend

### Summary
掘金编辑器内容恢复首选 CodeMirror 5 setValue 直灌（绕过插件管线的双打字 bug）

### Details
`juejin draft` 插件超时重试导致标题被两路输入流打成交错乱码、正文为空。恢复路径：`fill` 重填标题（trusted 管线）+ 页内 `document.querySelector('.CodeMirror').CodeMirror.setValue(正文)`（base64 运输防 shell 转义），4843 字符一次到位，掘金自动保存接管。CM5 的 `.CodeMirror` API 句柄在掘金编辑器始终可用。

### Suggested Action
修 juejin draft 插件的双打字 bug（超时重试不幂等）；插件恢复场景可直接复用 setValue 管线

### Metadata
- Source: error
- Related Files: .xcli/plugins/juejin/index.ts
- Tags: juejin, codemirror, recovery
- See Also: ERR-20261022-002
- Recurrence-Count: 1
- First-Seen: 2026-10-22
- Last-Seen: 2026-10-22

---
## [LRN-20261022-003] correction

**Logged**: 2026-10-22T03:10:00+08:00
**Priority**: critical
**Status**: pending
**Area**: config

### Summary
用户说「用浏览器插件」时必须第一时间检查 chrome-bridge 通道（9346/9347），而不是死磕本地 profile

### Details
审计 gemini 插件时我在 9333 空 profile 里发现「无 Google 登录态」，直接报缺登录。用户纠正：浏览器插件（chrome-bridge 扩展）是激活的，应先 `chrome-bridge status` 确认扩展已连（WS 9346），再经扩展在**用户真实浏览器**里开任务 tab（task-open，🤖 分组+stealth），登录态天然复用。标准动作链：status → task-open --url → HTTP 9347 /exec 下发命令 → task-close 收尾。

### Suggested Action
遇「需要某站登录态」且该站登录在用户主浏览器时，判断顺序：chrome-bridge status 有扩展连接 → 走桥；无桥再考虑 9333 profile / viewer 登录

### Metadata
- Source: user_feedback
- Related Files: .xcli/plugins/chrome-bridge/README.md, .xcli/plugins/gemini/bridge.ts
- Tags: chrome-bridge, login, routing
- Recurrence-Count: 1
- First-Seen: 2026-10-22
- Last-Seen: 2026-10-22

---
## [LRN-20261022-004] correction

**Logged**: 2026-10-22T08:45:00+08:00
**Priority**: critical
**Status**: pending
**Area**: config

### Summary
旧 worktree 开发前必须先对齐 master；新开发从 origin/master 重新开干净隔离空间

### Details
在数天前的 worktree（frame-oopif）里直接开发守卫功能，基座落后主干 5 个 PR（#386-389 + v1.30.2），导致：合并三文件冲突、CI commit-message-lint 失败两处。用户纠正：动手前先看主干最近改了什么，再在现有主干上重新开 worktree——避免改到致命代码或致命操作。收尾法：git reset --soft origin/master 压成基于最新主干的单提交。

### Suggested Action
开新任务前：git fetch && git log origin/master --oneline -10 过一遍 → git worktree add -b <feat> 自 origin/master；旧 worktree 只做收尾不做新开发

### Metadata
- Source: user_feedback
- Related Files: AGENTS.md §17
- Tags: worktree, merge, git
- See Also: LRN-20261022-003
- Recurrence-Count: 1
- First-Seen: 2026-10-22
- Last-Seen: 2026-10-22

---

## [LRN-20261022-005] knowledge_gap

**Logged**: 2026-10-22T08:45:00+08:00
**Priority**: high
**Status**: pending
**Area**: config

### Summary
commit-message 规则精确形态：type 前缀后的 subject ≤80 字符（不是整行 ≤100）；merge 小写开头不在类型白名单（GitHub 的 "Merge " 大写豁免才有效）

### Details
CI regex ^(feat|fix|...)(\(.+\))?: .{1,80}——feat(guard): 后 81 字符被拒（整行 94<100 仍挂）；"merge: xxx" 非法类型。此前只记了"首行 ≤100"（memory 二犯条目），漏了 80 字符 subject 上限这条子规则

### Suggested Action
提交前 git log -1 --format=%s | awk 算 type 后缀长度 >80 即重写；AGENTS 坑谱同步精确规则

### Metadata
- Source: error
- Related Files: .github/workflows/ci.yml
- Tags: commit-lint, ci
- Recurrence-Count: 3（跨 3 个任务）
- First-Seen: 2026-09
- Last-Seen: 2026-10-22

---
## [LRN-20261022-006] correction

**Logged**: 2026-10-22T09:30:00+08:00
**Priority**: critical
**Status**: pending
**Area**: docs

### Summary
发布流程铁律：一律先存草稿 → 用户确认 → 才能点发布；禁止直发

### Details
CSDN 发布时我准备填完直接点「发布博客」，用户叫停并定规："做任何东西，最好是先发草稿，之后再说。然后给我确认，确认完之后再发布，否则的话，可能会出现差异。" 自动化填充的内容可能有差异（图没传上/格式错/标题错），草稿确认门是唯一兜底。

### Suggested Action
所有发布管线改为三段：自动填+存草稿 → 交用户确认（给 tab URL/viewer）→ 确认后再执行发布点击；插件 publish 命令考虑加 --draft-only 默认态

### Metadata
- Source: user_feedback
- Related Files: .xcli/plugins/*/index.ts
- Tags: publish, draft, human-gate
- Recurrence-Count: 1
- First-Seen: 2026-10-22
- Last-Seen: 2026-10-22

---

## [LRN-20261022-007] best_practice

**Logged**: 2026-10-22T23:55:00+08:00
**Priority**: high
**Status**: pending
**Area**: docs

### Summary
多平台发文必须差异化（不同话术/角度/配图），否则同稿多发=营销号特征容易被限流

### Details
用户指出：五站发同一篇稿 + 文中有 URL，容易被平台判定营销内容。重构为三篇独立稿件：
- v1（51CTO，《滑块验证码拖不动？两个反直觉的原因》）— 排查叙事体，深色科技风配图
- v2（博客园，《一次 CDP 调试协议的实战》）— 技术深度体，架构图风格配图
- v3（OSChina，《自动化踩坑：跨域 iframe 按钮点不动》）— 教程科普体，浅色简洁插画
每篇标题/结构/语气/配图全不同，正文零 URL（仅保留代码块内的技术路径，化名为"某个手机绑定页面"）

### Suggested Action
后续多平台分发一律按"一站一稿"原则；配图必须重新生成（不复用）；标题避免同质

### Metadata
- Source: user_feedback
- Related Files: output/articles/version-51cto,cnblogs,oschina}.md
- Tags: content, multi-platform, anti-marketing
- Recurrence-Count: 1
- First-Seen: 2026-10-22
- Last-Seen: 2026-10-22

---

## [LRN-20261022-008] best_practice

**Logged**: 2026-10-22T23:55:00+08:00
**Priority**: medium
**Status**: pending
**Area**: infra

### Summary
三站图片上传通道各不相同——paste 事件是通用解（博客园/OSChina 都吃），51CTO 需 file input + 手动插 URL

### Details
实测结论：
- **博客园**：`#md-editor` textarea 上派发 ClipboardEvent paste（DataTransfer 带 File）→ 自动上传 → 返回 `img2024.cnblogs.com/blog/...png` 并插入 markdown
- **OSChina**：`.tiptap.ProseMirror` 上同样 paste → 自动上传 → 返回 `oscimg.oschina.net/oscnet/transfer/up-*.png`
- **51CTO**：`input.upload_input` 设 files + change → getoss 签名 + COS 上传 → **但编辑器不自动插入**，需手动把 COS URL 做成 `<img>` 插入
- **CSDN**：读上传器源码 + OBS 驼峰表单直传（ERR-007）
- 共性坑：扩展 runDebugger 有 12s 硬超时——上传等待必须"触发后立即返回 + 轮询"，不能一次 await 13s

### Suggested Action
抽象 shared/image-upload.ts：paste 优先 → file input 兜底 → 手动插 URL；统一"触发+轮询"模式

### Metadata
- Source: conversation
- Related Files: .xcli/plugins/login-bridge/extension/background.js
- Tags: image-upload, paste, bridge
- Recurrence-Count: 1
- First-Seen: 2026-10-22
- Last-Seen: 2026-10-22

---
## [LRN-20261023-001] correction

**Logged**: 2026-10-23T09:53:16+08:00
**Priority**: medium
**Status**: resolved
**Area**: docs

### Summary
Logo 设计任务应先检查项目的 product-brand-launch 技能并比较多个方向

### Details
首次为 xbrowser 制作 logo 时直接画出单一 SVG，并把它放进 README。用户提醒已有覆盖名称、slogan、logo 的 product-brand-launch 技能。该技能要求先审计现有品牌、提出至少三个不同方向，在最终选定后才做品牌落地。已补充三个方向，并撤下 README 中过早放入的定稿展示。

### Suggested Action
以后接到品牌、logo、命名或 slogan 任务，先检查 product-brand-launch 技能和项目现有品牌契约；标注草案状态，比较方向后再确定正式资产。

### Metadata
- Source: user_feedback
- Related Files: branding/README.md, README.md
- Tags: branding, logo, skill-routing
- Pattern-Key: branding.check_skill_before_logo_rollout
- Recurrence-Count: 1
- First-Seen: 2026-10-23
- Last-Seen: 2026-10-23

### Context Maintenance
- Decay-Type: decision
- Decay-Rate: durable (workflow preference)
- Authority: user correction and product-brand-launch skill; Owner: project maintainers
- Revalidation: re-read the skill and current brand contract before future brand work; review if either changes; if unavailable, keep assets labeled draft
- Validation: verified; Last-Validated: 2026-10-23; Evidence: three SVG concepts created and README restored to its prior heading
- Disposition: retain; Application: applied

---

## [LRN-20261025-001] 点击无效诊断三步法（先排误诊再归因反自动化）

**Why:** 知乎 Modal「确认」按钮被初诊为"反自动化防线"（连 Blogger 也被同样归因），深挖证据后发现 CDP 点击完全正常——事件到达（isTrusted=true）、handler 执行、API 请求发出（带完整 x-zst-81 签名），真实原因是列表滚动后坐标错位点错了行 + 目标 id 失效 404。错误归因浪费了 12 轮尝试。

**How to apply:** 遇到「按钮点了没反应」先跑三步再下结论：① window.addEventListener('unhandledrejection') 抓 handler 静默吞掉的错；② fetch/XHR hook 看请求发没发、URL 里的 id 是不是预期目标；③ elementFromPoint 验证坐标命中的是目标行（列表滚动后必须 scrollIntoView + 重取 rect）。三者都正常而行为不符才考虑反自动化。

---

## [LRN-20261025-002] 19 位雪花 id 必须走字符串通道（JS number 精度丢失）

**Why:** 知乎草稿删除连续三次误诊（反自动化 → 坐标错位 → ?），最终定位真因：知乎 API 返回 `"id": 2097465168825415129`，前端 `JSON.parse` 后得到 `2097465168825415200`（**差 71**），因为 19 位 id 超过 `Number.MAX_SAFE_INTEGER`（9007199254740991）。前端发出的 DELETE 指向被舍入的错误 id → 404 → 页面「点了没反应」。**人类用户点这个按钮也一样失效**——这不是反自动化，是上游自身的精度 bug。同一记录的 `url` 字段 `.../p/2097465168825415129` 是真值；用它发 DELETE 一次成功（200 + 刷新后消失）。

**How to apply:**
1. **id 一律当字符串**：任何 16 位以上的数字 id（雪花 id / 微博 mid / 知乎 article id / B站 aid+avid）在 JS 里禁止 `Number()`、禁止参与算术、禁止从已 `JSON.parse` 的 number 字段读。
2. **取 id 的优先顺序**：`href`/`url` 属性 → `data-*` 属性 → 文本内容 → 最后才是 JSON 里的 number 字段。
3. **比较 id 用字符串全等**：`String(a) === String(b)`，不要 `==`。
4. **诊断时对齐三方 id**：DOM/URL 里的 id、请求 payload 里的 id、服务端返回的 id——三者不一致就是精度或映射问题，不是 UI 问题。
5. 服务端若有 `url` / `link` / `slug` 字段，那是绕过精度问题的标准逃生门。

**Metadata**
- Source: debugging
- Tags: javascript, precision, snowflake-id, api-debugging
- Related: ERR-20261024-002, LRN-20261025-001
