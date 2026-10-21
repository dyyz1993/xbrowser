# 持久化错题本（graduated mistake ledger）

> 运行时错题本（`~/.xbrowser/knowledge/mistakes.json`，JSON）只做计数；
> **同一错误指纹出现 ≥3 次自动沉淀到本文件**（按日期记录，`recordMistake` 自动追加）。
> 本文件被 AGENTS.md 引用——**所有 Agent 开工前必读**，避免重蹈覆辙。
> 修复后在对应条目补「根因」与「修复」两行；人工只补不删（新条目由机制自动追加）。

---

## 2026-10-21 · eval · frame not found …三路未命中（graph.qq.com / ptlogin2 / mail.qq.com）
<!-- fingerprint:FATAL: unknown::frame not found for "graph.qq.com" -->
- **类别**: FATAL: unknown（累计 8+3+3 次）
- **典型错误**: `frame not found for "xxx"（OOPIF target、frame 树、auto-attach 三路均未命中；可能仍在加载）`
- **根因**: 两个独立根因叠加——① `eval` 脚本形态（`handleEvalScript`）从不转发 daemon，每次本地 `executeChain` 新起独立 Chrome，`--frame` 在空浏览器上必败；② 路径 B 的 contextId 靠 `Runtime.executionContextCreated` 事件窗口 400ms 收集，负载下会漏。
- **修复**: PR #386——eval 优先 `forwardExec` 转发 daemon；路径 B 改用 `Page.createIsolatedWorld` 按 frameId 同步取上下文，事件窗口降为兜底。

## 2026-10-21 · fill/click · 同进程跨源 iframe 元素 not found（ptlogin2 的 #u/#p/#login_button）
<!-- fingerprint:HUMAN: login-wall::element "#u" not found/visible within <duration> -->
- **类别**: HUMAN: login-wall（各 3 次）
- **典型错误**: `[frame ptlogin2] element "#u" not found/visible within 5000ms`
- **根因**: 站点隔离按 **eTLD+1** 分组——`ptlogin2.qq.com` 与 `mail.qq.com` 同属 qq.com → 同进程 iframe（无独立 OOPIF target，frameMouse 通道失效）；但同源策略照样挡 DOM，普通 locator 也进不去。另：QQ 登录默认扫码 tab，账密面板隐藏（rect=0），须先点 `#switcher_plogin`。
- **修复**: PR #386——同进程 fallback：getFrameTree 祖先链逐帧求视口偏移（origin 级 URL 匹配）+ 主 session 派发 trusted 输入。**通道判断法：跨根域=OOPIF（frame session）；同根域子域=同进程（主 session）**，代码已自动处理，无须手工判断。

## 2026-10-21 · fill · Input.insertText wasn't found（主 session）
<!-- fingerprint:FATAL: unknown::Input.insertText wasn't found -->
- **类别**: FATAL: unknown（10 次）
- **典型错误**: `CDP error [-32601] in Input.insertText: 'Input.insertText' wasn't found`
- **根因**: `Input.insertText` 在 **frame session 上可用、主 session 上报 wasn't found**（CDP 通道差异，未查明底层原因）。
- **修复**: PR #386——主 session 路径改用 `keyboard.type` 逐键输入（更通用且更拟人）。**教训：跨通道输入统一走逐键 dispatchKeyEvent。**

## 2026-10-20 · eval · CDP-Guard 拦截 dispatchEvent(new MouseEvent)
<!-- fingerprint:event-simulation::dispatchEvent(new MouseEvent) -->
- **类别**: event-simulation（3 次）
- **典型错误**: `[CDP-Guard] Event simulation detected: "dispatchEvent(new MouseEvent)"`
- **根因**: 不是 bug——Guard 正确拦截了合成事件；错在尝试在页面 JS 里模拟点击跨域 iframe 内容。
- **修复**: 正解是 `--frame` 通道（eval/click/fill/mouse 全家），不要对抗 Guard。

## 2026-10-20 · eval · "json is not defined"（7 次）
<!-- fingerprint:FATAL: unknown::json is not defined -->
- **类别**: FATAL: unknown
- **典型错误**: `ReferenceError: json is not defined`
- **根因**: `handleEvalScript` 曾把输出 flag（--json）拼进 JS 表达式尾部。
- **修复**: PR #386——输出 flag 剔除 + `eval --json` 支持 envelope 输出。

## 挂账（历史 constrained，根因未消）
- **twitter delete** · `waitForSelector('article[data-testid="tweet"]:nth-of-type(1)') timeout`（3 次）——站点选择器失效，待真实失败样本复醒。
## 2026-10-21 · click · selector #buy not found
<!-- fingerprint:runtime::selector #buy not found -->
- **类别**: runtime
- **首次/最近**: 2026-10-21T14:56:55 → 2026-10-21T14:56:55（累计 3 次）
- **典型错误**: selector #buy not found
- **根因**: （待补——修复时填写）
- **修复**: （待补——填 PR 号或修复说明）

## 2026-10-21 · 流程 · commit 首行 >100 字符（commit-message-lint 连挂两次）
<!-- fingerprint:process:commit-message-length -->
- **类别**: 流程（PR #381 一次、#388 一次——二犯）
- **典型错误**: `GraphQL: Required status check "commit-message-lint" is failing`
- **根因**: husky 首行 ≤100 字符规矩被反复违反；写完 commit 应先 `git log --format='%s' -1 | awk '{print length}'` 自检。
- **修复**: 写 commit 前先数字符；>100 就拆首行（正文放 body）。

## 2026-10-21 · 流程 · PR 合并监控竞态（update-branch 后 watch 提前退出）
<!-- fingerprint:process:pr-merge-polling -->
- **类别**: 流程（#387/#388 各一次）
- **典型错误**: `GraphQL: 3 of 3 required status checks are expected`（checks 实际全绿）
- **根因**: ① 并发合并使 PR 变 BEHIND，需 `gh api PUT pulls/N/update-branch` 拉平；② update-branch 触发 checks 重跑，`gh pr checks --watch` 在新 checks 注册前会退出，随即合并必撞竞态；③ 轮询 break 条件误把 BLOCKED（中间态）当终态。
- **修复**: 正确姿势——update-branch 后轮询 `gh pr view -q .mergeStateStatus`，**只认 CLEAN/DIRTY 为终态**（BLOCKED = 还在跑），到 CLEAN 再 `gh pr merge --squash --delete-branch --admin`。
