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

## [LRN-20261027-001] best_practice

**Logged**: 2026-10-27T14:40:00+08:00
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary

GitHub Actions 审批 E2E 先跑 no-op workflow，不能为验证审批而发布 npm 或插件。

### Details

在 `production` environment 上新增只含 echo 的 workflow，等 run 进入 `waiting` 后
用 Worker 签发的 ticket 调 `/api/review`，即可验证 Drel → 第三方 Worker →
GitHub pending deployment 的审批链路，副作用仅限放行这个 no-op job。真实发布
workflow 仍应使用 `thirdParty` approval，Drel 不保存第三方状态。当前 no-op run
`40461318368` 的 ticket/Worker 链路已走到 GitHub 前，但 Cloudflare Secret 中的
PKCS#8 无效，审批返回 503。

### Suggested Action

以后验证发布审批时先使用独立 no-op workflow，结束后关闭草稿 PR、删除临时分支，
不要合并验证文件。修复 Cloudflare GitHub App 私钥后先探测 `/run/:id`，200 再
提交真实 ticket。

### Metadata

- Source: user_feedback
- Related Files: .github/workflows/approval-e2e-noop.yml, release.yml
- Tags: github-actions, approval, no-op, production-environment
- Pattern-Key: release.approval.noop_e2e
- Recurrence-Count: 2
- First-Seen: 2026-10-27
- Last-Seen: 2026-10-27; second occurrence: run 40509509805 approved through `/api/review`, then a second click was rejected because the ticket was already consumed.

### Context Maintenance

- Decay-Type: decision
- Decay-Rate: durable
- Authority: 用户明确要求无副作用 requestId 与不发布 npm/插件; Owner: xbrowser release maintainers
- Revalidation: 当 production environment 保护规则或审批 Worker 契约改变时
- Validation: pending; Last-Validated: 2026-10-27; Evidence: run 40461318368
  已 waiting，`/ticket` 200，`/api/review` 503 Invalid PKCS8 input
- Disposition: retain; Application: applied

---

## [LRN-20261026-011] best_practice

**Logged**: 2026-10-27T03:47:00+08:00
**Priority**: high
**Status**: pending
**Area**: infra

### Summary

GitHub Actions 环境审批应使用 pending deployments API，而不是修改 deployment status

### Details

`createDeploymentStatus` 只改变 deployment 对象状态，不会满足 Actions 受保护环境的排队门，job 仍停留在 `waiting`。正确接口是 `POST /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments`，提交环境 ID 与 `approved`/`rejected`。该路径可由服务端 token 授权，供自定义 UI 无浏览器登录调用。2026-10-26 用该 API 放行 run `40365039033`，publish/marketplace/evidence/summary 全部成功。

### Suggested Action

自定义审批界面调用 `xbrowser github review-deployment` 或同名 GitHub API；继续保留 production environment protection，不要用禁用保护规则来绕过审批。

### Metadata

- Source: debugging
- Related Files: .xcli/plugins/github/index.ts
- Tags: github-actions, deployment-approval, api, release

### Context Maintenance

- Decay-Type: dependency
- Decay-Rate: slow; depends on GitHub Actions REST API behavior
- Authority: GitHub REST API live verification; Owner: release maintainers
- Revalidation: check pending deployments API documentation when GitHub Actions approval behavior changes
- Validation: verified; Last-Validated: 2026-10-26; Evidence: run 40365039033 transitioned from waiting to all jobs success after API approval
- Disposition: retain; Application: applied

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

---

## [LRN-20261026-006] 任务分组卫生：泄漏的三种来源与清理配方

**Why:** 用户发现浏览器里堆积大量未清理的任务分组——实测 18 组/18 tab 全部是当晚自动化产物。清完剩 15 个 tab 全部是用户自己的，零误伤。

**【关键补遗 2026-10-26】一键清理命令一直存在，我没用它——这是主因之一：**
`xbrowser chrome-bridge finish` —— 一条命令关闭**所有**任务组（🤖 + xb-task-* 全收，
用户 attach 入组的 tab 自动脱组保留，S209 保护）。手工逐组 task-close 18 次是笨办法。
任务批次结束（发布/生成/调试告一段落）**必跑一次 finish**。

**How to apply:**
1. **泄漏三来源**：① 脚本 task-open 后异常路径没走 task-close（批量脚本每镜开新组、错误路径漏清理）② 插件代码组名错位（history-list 两次 Date.now() 生成不同名——close 永远对不上，#426 已修）③ 显式 xb-task-* 组**设计上不自动回收**（空闲回收只针对 🤖 自动组，S206 设计如此——显式组必须显式关）
2. **审计配方**：bridge `task-list` 列全部组 → 按 name 前缀归类计数 → `task-close` 逐组关闭 → `task-list` 复核归零 → `tabs` 复核用户 tab 零误伤
3. **预防**：批量脚本用 try/finally 包 task-close；插件的组名一律先存变量再用；显式组用完即关（要保留给用户确认的内容除外，如 draft 流程）
4. **收尾铁律**：任务批次结束跑 `xbrowser chrome-bridge finish`（一键清所有任务组，用户 tab 自动脱组保留）——比逐组 task-close 可靠且无遗漏
5. **机制设计事实**：显式 xb-task-* 组**故意**不参与 10 分钟空闲回收（S206 设计，防止脚本误关用户待确认的草稿 tab）——代价是"脚本忘了关就永久堆积"，所以收尾 finish 是唯一兜底

**Metadata**
- Source: user_feedback
- Tags: tab-groups, hygiene, task-close, leak
- Related: ERR-20261025-001（僵尸 tab）, LRN-20261026-001

---

## [LRN-20261026-007] CF 拦截实测：bridge 通道下 30 连击零拦截（检测误报也要防）

**Why:** 用户问能否过 CF，要求实测 20-30 次连击验证。结果：走用户真实 Chrome（bridge 通道）连续 30 次访问 twitterviewer.net，**0 次被 CF 拦截**——真实浏览器指纹 + 已有的 cf_clearance Cookie + 真实 UA/行为，CF 不出手。另：首轮检测误报（页脚含"Cloudflare"字样触发正则），CF 检测应该看 title（Just a moment）+ #challenge-running 元素，不能全文匹配"Cloudflare"。

**How to apply:**
1. CF 站走 bridge 通道（用户真实 Chrome）天然免疫——之前 `cf_clearance` Cookie 在，指纹真实，30 连击 2.5-4s 间隔全过
2. CF 挑战检测标准：`/Just a moment|Checking your browser/i.test(document.title)` 或 `document.querySelector('#challenge-running, #challenge-form')` ——**不要**全文匹配 "Cloudflare"（页脚统计代码会误报）
3. 真 Turnstile 出现时（iframe[src*="challenges.cloudflare.com"]）：不硬模拟，给 viewer URL 让用户点
4. headless/独立浏览器跑 CF 站才会高频被拦——那才是需要 stealth 对抗的场景

**Metadata**
- Source: user_request
- Tags: cloudflare, cf-bypass, bridge-channel, detection-false-positive
- Related: login-bridge-plugin（stealth 三层）

---

## [LRN-20261026-008] 抖音视频抓取三通道（bridge 直拿 <video> currentSrc 最快）

**Why:** 用户给了一个抖音短链要抓视频。实测三条路：① curl 解短链拿 awemeId ✓ ② iesdouyin share 页 SSR 数据不含 play_addr（loaderData 只有配置无视频）✗ ③ **bridge 开 tab → `<video>.currentSrc` 直拿 douyinvod CDN 签名 URL → curl 带 Referer 下载 ✓✓**（30 秒全流程）。

**How to apply:**
1. 短链解析：`curl -sIL https://v.douyin.com/xxx/` 跟 302 拿 `video/(\d+)` 即 awemeId
2. bridge `task-open` 开 `douyin.com/video/<id>` → 等 8s → evaluate 取 `video.currentSrc` 或 `source[src]`（CDN 签名 URL 有时效，取到立刻用）
3. 下载必须带 `Referer: https://www.douyin.com/`（否则 CDN 拒绝）
4. 仓库 douyin 插件有 `detail`/`download` 命令（XHR 拦截 aweme_detail API 拿无水印 bit_rate），适合要元数据/多画质的场景；只要快速拿片走 bridge currentSrc 更轻
5. HEVC 编码常见（本条 hevc + aac），ffmpeg 处理无碍

**Metadata**
- Source: user_request
- Tags: douyin, video-download, bridge, currentSrc
- Related: LRN-20261026-004（同款页面内取资源思路）

---

## [LRN-20261026-009] GSC 全自动 sitemap 提交成功——四步 UI 闭环配方

**Why:** 用户要求"全自动提交"。GSC 属性 `sc-domain:xbrowser.dev` 此前已验证（发现方式：直接开 search-console 页面自动 302 到 `?resource_id=sc-domain:xbrowser.dev`）。实测用 bridge UI 自动化完成了 sitemap.xml 提交，全程无人工。

**How to apply（GSC sitemap 提交 UI 自动化配方）:**
1. 开 `search.google.com/search-console/sitemaps?resource_id=sc-domain%3A<域名>` → 已验证则自动进入管理页
2. 聚焦输入框：**用 `aria-label="输入站点地图网址"` 精确定位**（不能按 width>150 过滤——GSC 顶部还有 URL 检查栏的同尺寸输入框，会打错字到错误的框里）
3. **先 `select()`+Ctrl+A+Backspace 清残留**（此输入框持久保留上次未提交的文本）
4. `Input.insertText` 打字（逐键 keyDown 在 Angular Material 组件上不触发 value 更新）
5. **Enter 提交**（新 UI 无"提交"文字按钮，Enter 是唯一路径）
6. 验证：页面出现"已提交的网址数"即为成功

**Metadata**
- Source: debugging
- Tags: gsc, sitemap, seo, ui-automation
- Related: LRN-20261026-003（焦点四步闭环）, LRN-20261026-007（CF 30 连击）

---

## [LRN-20261026-010] 【用户硬规则】SEO 推广不要加链接，用关键词收录

**Why:** 用户纠正（2026-10-26）："发送的链接，其实没必要去追加那个网址，因为有网址的话不一定好发布。但是有对应的关键词的话，可能容易收录。" —— 带 URL 的推广内容在多数平台（掘金/知乎/CSDN）会被反推广机制拦截或降权，而**关键词搜索是用户找工具的实际路径**（搜 "xbrowser" 或 "浏览器自动化 CLI" 就能找到 GitHub/npm/官网），所以不需要硬塞链接。

**How to apply:**
1. 推广文章文末只需保留 `dyyz1993/xbrowser` 或 `xbrowser` 明文关键词，**不要加 URL 链接**
2. 确保 GitHub 仓库 description 和 npm package description 包含核心搜索关键词（浏览器自动化、browser automation CLI、AI Agent 等）
3. xbrowser.dev 的 SEO 依赖 GSC sitemap 提交 + GitHub/npm 的自然外链，不靠文章硬塞
4. 文章标题和正文要包含用户会搜的关键词（"浏览器自动化"、"Playwright 替代"、"AI Agent 浏览器" 等）

**Metadata**
- Source: user_feedback
- Tags: seo, promotion, keywords, no-links
- Related: LRN-20261026-006, user-direction-preferences

### Summary

`notify_run_id` 的 renotify dispatch 是通知专用运行，release-summary 不能把它当成发布失败。

### Details

`notify_run_id != ''` 时 verify/test/publish 全部 skipped，旧 `always()` 的
release-summary 会因 verify != success 误报 `release 未完成`。已把 summary
改成 `always() && inputs.notify_run_id == ''`。真实审批 ticket 是一次性的，
一个 ticket 只能消费一次；同一 GitHub run 审批后不会再有 pending deployment，
后续点击旧消息/重发票应提示“已处理”，这是预期防重放行为，不是路由错误。

### Context Maintenance

- Pattern-Key: ci-release-renotify-summary
- Context Maintenance: maintain when renotify mode or release summary gating changes
- Source: user_feedback
- Status: resolved
- Last-Seen: 2026-10-27
- Recurrence-Count: 1
- Related Files: .github/workflows/release.yml
- Tags: github-actions, release, renotify, approval-ticket

---

## [LRN-20261028-001] best_practice

**Logged**: 2026-10-28T04:55:00+08:00
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary

真实多租户审批需要 GitHub OIDC ticket、当前 Drel 身份 ACL、EdDSA actor assertion 和
pending-deployment provider 四项同时匹配。

### Details

xbrowser release workflow 用 `ACTIONS_ID_TOKEN_REQUEST_TOKEN` 向
`/v1/ci/tickets` 换 tenant/project-scoped v2 ticket；Drel decision 必须带绑定
requestId、ticketHash、actionId 的 Ed25519 assertion。第一次旧公钥返回
`identity_not_linked`，policyVersion 更新后旧 ticket 被拒，必须发新 ticket。
最终 Drel decision HTTP 200，GitHub run `40575537375` 的 production
`approval-gate` 成功，`publish-npm` / `publish-marketplace` 保持 skipped。

### Suggested Action

每次更换 Drel 安装或 Keychain 身份后，先从审批身份页导出 Subject/Login/公钥，
更新 admin project policy，然后用全新 requestId 和 ticket 推送审批；不要复用
旧 policyVersion 的推送。

### Metadata

- Source: error
- Related Files: .github/workflows/release.yml, src/multitenant.ts, src/actor.ts
- Tags: github-oidc, approval, drel-actor, multi-tenant, github-actions
- Pattern-Key: approval.multi_tenant_oidc_actor
- Recurrence-Count: 1
- First-Seen: 2026-10-28
- Last-Seen: 2026-10-28

### Context Maintenance

- Decay-Type: dependency
- Decay-Rate: medium; GitHub OIDC / deployment approval API may change
- Authority: live E2E evidence; Owner: xbrowser + drel-release-gate maintainers
- Revalidation: OIDC claim names, pending deployment API, ticket format, or actor assertion contract change
- Validation: verified; Last-Validated: 2026-10-28; Evidence: run 40575537375
  approval-gate success, publish jobs skipped
- Disposition: retain; Application: applied
