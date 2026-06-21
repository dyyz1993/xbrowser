# Snapshot 优化对比：xbrowser vs agent-browser

> 2026-06-19 实测。同一测试页（17 个交互元素：导航链接 × 4、表单输入 × 5、列表链接 × 3、按钮 × 2、文本框/选择框/图片/页脚链接），覆盖典型 AI agent 操作场景。

## TL;DR

| 指标 | xbrowser 优化前 | xbrowser 优化后 | agent-browser 0.28 |
|------|:---:|:---:|:---:|
| interactive 体积 | 4711 ch / 1277 tok | **2837 ch / 809 tok** | 1270 ch / 417 tok |
| 优化幅度 | — | **-40% ch / -37% tok** | 基准（最精简） |
| aria 噪音过滤 | 无（71% 噪音行）| **34% 体积下降** | 无原生 aria 模式 |
| 默认模式可用性 | ❌ aria（无 ref）| ✅ interactive（自带 ref）| ✅ interactive |

**结论**：xbrowser 优化后默认 interactive 体积降 37%，agent-browser 仍领先 2×（因为只存 name+role），但 xbrowser 多带 selector 映射——**各有取舍，详见下方优劣分析**。

---

## 一、测试环境

| 项 | xbrowser | agent-browser |
|----|----------|---------------|
| 版本 | 本仓库 master（优化后构建）| 0.28.0（npm 最新） |
| 浏览器 | cdp-tunnel @ localhost:9221（用户 Chrome）| 自启 Chromium（headless） |
| 测试页 | `http://localhost:9912/snap-bench.html`（本地 HTTP 服务） |
| 采集方式 | `--json` 输出 → 提取 data 对象计算体积 |

> **为何 agent-browser 用自启 Chromium 而非 9221**：agent-browser 0.28 的 daemon 机制与 cdp-tunnel 隔离模型不兼容（它要完全控制浏览器生命周期）。两者跑在不同浏览器实例但同一测试页，体积/字段对比仍然公平（DOM 结构一致）。

---

## 二、体积对比（核心指标）

### 2.1 interactive 模式（AI agent 主用模式）

| 工具 | 模式 | data 体积 | token 估算 | targets 数 |
|------|------|-----------|-----------|-----------|
| xbrowser 优化前 | `snapshot --interactive` | 4711 ch | 1277 tok | 17 |
| **xbrowser 优化后** | `snapshot`（默认）| **2837 ch** | **809 tok** | 17 |
| xbrowser 优化后 | `snapshot --selectors` | 3630 ch | 1007 tok | 17 |
| agent-browser | `snapshot -i` | 1270 ch | 417 tok | 17 |

**xbrowser 优化幅度**：`-40% ch`，`-37% token`。

**与 agent-browser 差距**：优化后仍大 2.2×（809 vs 417 tok）。差距来源是 xbrowser 每个 target 多带 `selector/tag/enabled/editable` 4 个字段——这些是 **xbrowser 独有能力**（selector 映射让 ref 能转成 CSS 选择器，跨 session 复用），agent-browser 不提供。

### 2.2 aria 模式（显式 `--type aria`）

| 工具 | 体积 | token | 噪音行占比 |
|------|------|-------|-----------|
| xbrowser 优化前 | 1167 ch | 415 tok | 71%（55/77 行）|
| **xbrowser 优化后** | **768 ch** | **279 tok** | **0%**（none/InlineTextBox/ListMarker 全过滤）|
| agent-browser default | 1758 ch | 547 tok | 含 StaticText/LabelText（未过滤）|

**xbrowser 优化幅度**：`-34% ch`，`-33% token`。过滤的噪音类型：
- `none:` / `none: xxx`（无 ARIA 角色的容器节点）
- `InlineTextBox`（Chromium 布局引擎文本片段）
- `ListMarker: •`（列表装饰标记）
- `xxx: `（半空行，纯角色名无内容）

---

## 三、字段对比（interactive 模式每个 target）

| 字段 | xbrowser 优化前 | xbrowser 优化后 | agent-browser | 处置理由 |
|------|:---:|:---:|:---:|------|
| `ref` | ✅ 17/17 | ✅ 17/17 | ❌（在 snapshot 文本里） | 保留：交互核心 |
| `name` | ✅ 17/17 | ✅ 17/17 | ✅ | 保留：AI 识别元素 |
| `role` | ✅ 17/17 | ✅ 17/17 | ✅ | 保留：动作推导依据 |
| `selector` | ✅ 17/17 | ✅ 17/17 | ❌ | 保留：xbrowser 独有，ref→CSS 映射 |
| `tag` | ✅ 17/17 | ✅ 17/17 | ❌ | 保留：选择器生成 + 调试 |
| `enabled` | ✅ 17/17 | ✅ 17/17 | ❌ | 保留：compact 输出 disabled 标签 |
| `editable` | ✅ 17/17 | ✅ 17/17 | ❌ | 保留：compact 输出 editable 标签 |
| `checked` | ✅ 1/17 | ✅ 1/17 | ❌ | 保留：compact 输出 checked/unchecked |
| `value` | ✅ 1/17 | ✅ 1/17 | ❌ | 保留：当前值（可编辑元素） |
| ~~`box`~~ | ✅ 17/17 | ❌ **删除** | ❌ | **零消费方**：AI 用 ref 操作；viewer 截图用另一套 box |
| ~~`actions`~~ | ✅ 17/17 | ❌ **删除** | ❌ | **零消费方**：可由 role/tag 推导；actOnPage 不读 |
| ~~`visible`~~ | ✅ 17/17 | ❌ **删除** | ❌ | **零消费方**：默认只采集可见元素（全 true，零信息） |
| ~~`timestamp`~~ | observation 级 | ❌ **删除** | ❌ | **零消费方**：无任何代码读取 |

**字段数**：优化前 12 个/target → 优化后 9 个/target（**-25%**）。

---

## 四、时间对比

| 模式 | xbrowser 优化前 | xbrowser 优化后 | 说明 |
|------|:---:|:---:|------|
| interactive | 10 ms | 7 ms | 字段减少，序列化更快 |
| aria | 9 ms | 14 ms | 过滤逻辑增加开销（可忽略，<20ms）|

时间非瓶颈——所有模式 < 20ms。**体积（token）才是 AI agent 的核心指标**，影响上下文窗口占用和 API 成本。

---

## 五、优劣势分析

### 5.1 xbrowser 的优势（优化后）

1. **非标准控件捕获（2026-06-19 新增）**：候选选择器补充了 `[onclick]`/`[onmousedown]`/`[onmouseover]`/`[onkeydown]` 等内联事件属性，能抓到 `<div onclick>`/`<span onclick>` 这类无 ARIA role 的自定义控件。**agent-browser 基于可访问性树，完全捕获不到这类控件**。实测同一页面（含标准 button + div onclick + span onclick + tabindex div）：
   - xbrowser：抓到全部 4 个
   - agent-browser：只抓到标准 button + tabindex div（2 个）

2. **selector 映射质量**：每个 target 带 `selector`（优先 `#id` → `[data-testid]` → `[aria-label]` → `[name]` → class → nth-of-type），**ref 可转成稳定 CSS 选择器**，跨 session/跨工具复用。agent-browser 的 ref 只在当次 session 有效，且不暴露 selector。

3. **staleness 检测**：`screenHash` 让 `actOnPage` 能检测 ref 是否过期（页面变化后 ref 失效会提示重新 snapshot）。agent-browser 无此机制——ref 失效后默默用错元素或报错，无主动提示。

4. **compact 文本可读性**：`@e1 [textbox editable] "Email"` 格式，disabled/editable/checked 状态直接显示在标签里，AI 一眼能看出元素状态。

5. **噪音过滤更激进**：aria 模式主动过滤 none/InlineTextBox/ListMarker，agent-browser default 仍含 StaticText/LabelText 噪音。

### 5.2 agent-browser 的优势

1. **体积更小**（417 vs 809 tok）：refs 只存 `{name, role}`，极致精简。适合上下文极度紧张的场景。

2. **树状层级缩进**：snapshot 文本用 `- ` 缩进体现父子关系（如 combobox 下挂 option），xbrowser 的 compact 是扁平列表。

3. **格式更成熟**：`- link "首页" [ref=e5]` + `[level=1]` / `[checked=false]` / `[expanded=false]` 等属性标注，语义信息更丰富。

4. **交互范式更简洁**：`click @e2` 直接用 ref，无需 selector 映射层（内部维护）。

### 5.3 双方共同范式

- `@ref [role] "name"` 的核心设计一致
- 默认走 interactive（agent-browser 一直是，xbrowser 本次对齐）
- ref 是 session 级临时引用，页面变化后失效

### 5.4 取舍建议

| 场景 | 推荐 | 原因 |
|------|------|------|
| 需要跨 session 复用选择器 | xbrowser | selector 映射可持久化 |
| 需要看元素状态（disabled/checked）| xbrowser | compact 标签直接显示 |
| 上下文极度紧张 | agent-browser | 体积小 2× |
| 需要看 DOM 层级结构 | agent-browser | 树状缩进 |
| 操作 ChatGPT/豆包等需登录站点 | xbrowser | cdp-tunnel 复用登录态 |

---

## 六、本次优化改动清单

| 文件 | 改动 |
|------|------|
| `src/runtime/types.ts` | `AgentTarget` 删 `box`/`actions`/`visible`；`AgentObservation` 删 `timestamp` |
| `src/runtime/agent-runtime.ts` | `observePage` 删 box/actions/visible/timestamp 采集；删 `actionsFor` 函数；候选选择器补 `[onclick]`/`[onmousedown]`/`[onmouseover]`/`[onkeydown]`（捕获非标准 div/span 控件） |
| `src/commands/snapshot.ts` | 默认 type `aria`→`interactive`；aria 输出加 `filterAriaNoise` 过滤；补 `examples` 字段（--help 渲染用法示例） |
| `src/commands/command-registry.ts` | `BrowserCommandDefinition`/`RegisteredCommand` 加 `examples?` 字段并透传（让内置命令支持 help 示例） |
| `src/cli/help.ts` | 主 help Commands 列表补 `snapshot` 一行 |
| `tests/runtime/agent-runtime.test.ts` | mock 数据移除冗余字段；新增字段精简断言 |
| `tests/commands/snapshot-agent.test.ts` | mock 数据移除冗余字段；新增默认 interactive / aria 过滤 / 字段精简 三个测试 |

### 为何用 enum 而非 optional 实现默认

xcli-core 解析 zod schema 时，对 `z.enum().optional()` 仍标记 `required: true`（core 包的 bug），导致不传 `--type` 时报错。改用 `z.enum([...,'interactive']).default('interactive')` 绕开——既修复默认行为，又保持 `--type aria` 显式降级出口。

---

## 七、复现方法

```bash
# 1. 启动测试页
cd /tmp && cat > snap-bench.html <<'HTML'
<!-- 17 个交互元素的测试页，见仓库 tests/fixtures 或自行构造 -->
HTML
python3 -m http.server 9912 &

# 2. xbrowser（优化后）
cd /path/to/xbrowser && npm run build
node dist/cli.js goto http://localhost:9912/snap-bench.html --cdp http://localhost:9221 --session bench
node dist/cli.js snapshot --cdp http://localhost:9221 --session bench --json          # 默认 interactive
node dist/cli.js snapshot --type aria --cdp http://localhost:9221 --session bench --json  # aria 过滤后

# 3. agent-browser 0.28
npm install agent-browser@latest
npx agent-browser --session bench open http://localhost:9912/snap-bench.html
npx agent-browser --session bench snapshot -i --json
```

体积/token 计算脚本见 `/tmp/snap-compare.py`（token 估算：中文 1.5 字/token，英文 4 字符/token）。
