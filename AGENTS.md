# AGENTS.md

> xbrowser 项目的 AI Agent 工作手册。所有在本仓库工作的 Agent **必须**先读完本文。

## 0. First Things First

```bash
npm install && npm run build && npm link        # 安装 & 链接
npm run validate                                 # 全部验证：typecheck + lint + build + test
npm run lint:plugin-contract                     # 插件契约快速检查（30 秒）
npx vitest run tests/cli/session-routes.test.ts  # 快速跑单个测试
```

**关键路径** — 每次改代码后至少跑：`npm run typecheck && npm run lint`

## 1. 项目原则

- **第一原则：所有自动化脚本 → 插件**。任何 `*.ts`/`*.mjs`/`*.cjs` 调研脚本、爬虫、数据采集、发布工具，都应放在 `.xcli/plugins/<name>/` 下，作为站点插件或扩展命令插件存在，**不要**散落在仓库根目录或 `scripts/` 中。
- **skill / 知识 / 模板** 全部放 `.opencode/skills/<name>/`，与全局 skills 解耦。
- **临时编辑脚本、debug 脚本、recordings、capture 产物** 全部放 `output/` 或 `.xcli/storage/`，**不要**进 git。
- **禁止把数据/报告/HTML 输出** 提交进 git（ctrip-report.html、stats-*.png、douyin_works_sample.json 等）。

---

## 2. 仓库速览

| 路径 | 作用 |
|------|------|
| `bin/cli.ts` | CLI 入口（`xbrowser` 命令） |
| `src/` | 核心代码（`browser.ts` / `commands/` / `cli/` / `daemon/` / `cdp-driver/`） |
| `src/commands/` | 49 个内置命令（goto / click / fill / wait / scroll / record / replay / preview…） |
| `src/cdp-driver/` | 自研 CDP 驱动（Playwright 替代） |
| `src/cli/` | 子命令路由（session / plugin / record / preview / viewer） |
| `src/daemon/` | 后台 daemon + WebSocket preview 服务器 |
| `.xcli/plugins/` | **插件主目录**（69 个站点插件） |
| `.xcli/storage/` | 插件持久化数据（cookie、登录态、运行缓存） |
| `tests/` | 单元/E2E 测试 |
| `lint-scripts/` | lint 规则（Plugin Contract 校验、参数检查） |
| `docs/` | 用户文档（`quickstart.md` / `plugin-guide.md` / `recording.md` / `captcha-interaction.md` …） |
| `skill/` | 项目 skill 目录（SKILL.md + references） |
| `.opencode/ui-automator/` | 内部技巧库（patterns / selectors / specs / troubleshooting） |
| `output/` | 临时输出（截图、JSON、HTML） |
| `recordings/` | 录制文件 |
| `analytics/` | 老的占位目录（**已清空**，建议删除） |

---

## 3. 快速启动

### 3.1 安装

```bash
npm install
npm run build
npm link            # 让 xbrowser 命令全局可用
```

### 3.2 启动浏览器并跑第一个命令

```bash
# 方式 1: 让 xbrowser 自己启动浏览器
xbrowser session open https://example.com
xbrowser title
xbrowser screenshot --output output/example.png

# 方式 2: 连接已经开着的浏览器（推荐用于复用用户登录态）
xbrowser --cdp 9222 title

# 方式 3: 自动发现
xbrowser --cdp auto title
```

### 3.3 Daemon 模式（响应更快，自动启停）

```bash
# 直接跑任何 xbrowser 命令，daemon 会自动起来并在退出后停掉
xbrowser "goto https://example.com && title"
```

> 旧版 `xbrowser daemon start/stop/status` 已经移除，**不要**再写这些命令。

---

## 4. 命令链（核心用法）

把多个操作串成一条命令：

```bash
# && 串联（短路，前置失败则不执行后续）
xbrowser "goto https://example.com && title && screenshot"

# , 串联（不短路，依次执行）
xbrowser "goto https://example.com , title , screenshot"

# -> 串联（同 ,，可读性更好）
xbrowser "goto https://example.com -> title -> screenshot"
```

**链式调用支持所有内置命令**（`goto` / `click` / `fill` / `type` / `text` / `html` / `screenshot` / `wait` …），也支持插件命令。

**Heredoc 多行**：

```bash
xbrowser <<'EOF'
goto https://example.com/login
fill "#username" "myuser"
fill "#password" "mypass"
click "#submit"
wait ".dashboard"
screenshot --full-page
EOF
```

---

## 5. 录制与回放（快速产 YAML）

```bash
# 1. 打开会话
xbrowser session open https://example.com

# 2. 开始录制
xbrowser record start --url https://example.com --name my-flow

# 3. 在浏览器里手动操作…

# 4. 停止并保存
xbrowser record stop --output recordings/my-flow.yaml

# 5. 回放（可慢速、可停于首错）
xbrowser replay recordings/my-flow.yaml --slow-mo 200
xbrowser replay recordings/my-flow.yaml --stop-on-error
```

录制文件格式（YAML）见 `docs/recording.md`。

录制文件**可入库**到 `recordings/`，但敏感数据（账号、token）必须剔除。

---

## 6. Viewer / Preview（人类接管）

遇到**验证码、登录、动态挑战**时，Agent 必须让出控制权：

### 6.1 启动 viewer

viewer 会在需要时**自动启动 daemon 并打开浏览器**（无需手动启 daemon）：

```bash
# 自动打开 viewer（daemon 缺失时自动拉起）
xbrowser viewer

# 或指定 session
xbrowser preview --session my-sess
```

viewer 启动后会在终端打印 WebSocket URL（如 `ws://localhost:9224`），
浏览器中可访问 `http://localhost:9224/preview/<sessionId>` 看实时画面并接管鼠标键盘。

### 6.2 插件中主动让出

```typescript
handler: async (params, ctx) => {
  // 等待人类操作（验证码 / 登录 / 拖滑块）
  const result = await ctx.waitForHuman({
    reason: '请在 viewer 中完成滑块验证',
    timeout: 120,  // 秒，0 表示无限等待
  });
  if (!result.solved) {
    throw new Error('人类未在超时内完成操作');
  }
  // 继续后续逻辑
  ...
}
```

### 6.3 配置

```bash
# ~/.xbrowser/config.json
{
  "captcha": {
    "notifyUrl": "https://hooks.slack.com/services/xxx",  # webhook 通知
    "autoOpen": true,                                       # 自动开 viewer
    "timeout": 120,                                         # 超时秒
    "strategy": "preview-first"                             # 或 "abort" / "skip"
  },
  "preview": {
    "port": 9224,
    "quality": 90,
    "fps": 8
  }
}
```

环境变量（覆盖配置）：

```bash
XBROWSER_NOTIFY_URL=https://hooks.slack.com/xxx
XBROWSER_AUTO_OPEN=true
XBROWSER_CAPTCHA_TIMEOUT=120
XBROWSER_PREVIEW_PORT=9224
```

---

## 7. 登录处理

### 7.1 一次性登录（推荐用于站点插件）

```typescript
site.login(async (ctx) => {
  const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
  if (!page) return;

  await page.goto('https://example.com/login');
  await page.fill('#username', 'user');
  await page.fill('#password', 'pass');
  await page.click('#submit');
  await page.waitForLoadState('networkidle');

  // 保存登录态（关键！）
  await ctx.storage.set('auth_token', { loggedIn: true, at: Date.now() });
});

site.logout(async (ctx) => {
  await ctx.storage.delete('auth_token');
});
```

### 7.2 Cookie 注入

```typescript
await page.context().addCookies([{
  name: 'session_id', value: 'xxx', domain: '.example.com', path: '/',
}]);
```

### 7.3 在 viewer 里手动登录

如果登录流程太复杂（短信验证、扫码、二次认证），用 `ctx.waitForHuman()`：

```typescript
handler: async (params, ctx) => {
  // 引导用户去 viewer 完成登录
  const result = await ctx.waitForHuman({ reason: '请在 viewer 中扫码登录' });
  if (!result.solved) throw new Error('登录超时');
  // 继续业务逻辑
}
```

### 7.4 复用已有登录态（连接到已开浏览器）

```bash
# 用户已经在 Chrome 上登录了 X 站
chrome --remote-debugging-port=9222

# Agent 复用
xbrowser --cdp 9222 chatgpt list
```

---

## 8. 验证码处理

### 8.1 检测（自动）

xbrowser 自动识别 reCAPTCHA v2/v3、hCaptcha、Cloudflare Turnstile、Generic Captcha。

匹配到时自动 pause，**触发 6.2 的 `ctx.waitForHuman` 流程**。

### 8.2 处理策略

| 策略 | 行为 |
|------|------|
| `preview-first`（默认） | 打开 viewer 等用户解决；超时则 abort |
| `abort` | 立即终止 |
| `skip` | 跳过当前步骤继续 |

配置：`~/.xbrowser/config.json` 的 `captcha.strategy`。

### 8.3 在插件里手动触发

```typescript
// 让框架重新检测一次当前页面
const detected = await ctx.detectCaptcha?.();
if (detected) {
  await ctx.waitForHuman({ reason: `检测到 ${detected.type}` });
}
```

---

## 9. 临时文件 / 临时数据写哪里

| 内容类型 | 路径 | 备注 |
|---------|------|------|
| 截图 | `output/<plugin>/<session>-<ts>.png` | 例 `output/chatgpt/sess1-2026-06-10.png` |
| JSON 数据 | `output/<plugin>/<name>.json` | 报告、爬虫结果 |
| HTML 报告 | `output/<plugin>/<name>.html` | 报表、导出 |
| 录制文件 | `recordings/<flow>.yaml` | 可入 git |
| 录制临时草稿 | `recordings/.tmp/` | 录制中，**不入 git** |
| 登录态 / 持久化 | `.xcli/storage/<plugin>/` | 框架托管，**不要**手动写 |
| skill 调试输出 | `output/skills/<skill>/` | 例 `output/skills/cdp-test/` |
| 一次性脚本（开发期） | `output/.scripts/` | **不入 git** |

> **重要**：不要在仓库根目录或 `scripts/` 创建临时文件——那里是历史包袱区域。

---

## 10. 插件开发

完整规范见 `docs/plugin-guide.md`（1456 行）。下面是 Agent 最常用的速查。

### 10.1 插件结构

```
.xcli/plugins/<name>/
├── index.ts            # 入口（必须）
├── package.json        # 必须
├── README.md           # 推荐
├── CHANGELOG.md        # 发布时必须
├── MARKET_DESCRIPTION.md  # 发布到 marketplace 时必须
├── LICENSE             # 发布时必须（推荐 MIT）
└── helpers.ts          # 可选
```

### 10.2 最小插件

```typescript
// .xcli/plugins/my-plugin/index.ts
import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'my-plugin',
    url: 'https://example.com',
    description: '示例插件',
  });

  site.command('hello', {
    description: '打招呼',
    scope: 'project',  // project | browser | page | element
    parameters: z.object({
      name: z.string().optional().default('World'),
    }),
    handler: async (params) => {
      return { ok: true, message: `Hello, ${params.name}!` };
    },
  });
}
```

### 10.3 Scope 选择

| Scope | 含义 | 适用 |
|-------|------|------|
| `project` | 无需浏览器 | 纯数据/配置/文件 |
| `browser` | 需要浏览器 | 多 tab、视口 |
| `page` | 需要活跃页面 | 导航、查询、截图、JS |
| `element` | 需要具体元素 | click / fill / hover |

### 10.4 访问 Playwright Page

```typescript
const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
if (!page) throw new Error('需要浏览器页面');
```

### 10.5 加载顺序

1. `./.xcli/plugins/`
2. `../.xcli/plugins/`
3. `~/.xcli/plugins/`
4. `~/.xbrowser/plugins/`

本地优先于全局。**开发时直接编辑 `.xcli/plugins/<name>/` 即可生效，无需 npm link。**

### 10.6 查看插件能力

```bash
xbrowser plugin list
xbrowser plugin schema <plugin>
xbrowser plugin schema <plugin> <command>
xbrowser plugin schema <plugin> <command> --json
```

### 10.7 需要登录的插件

```typescript
const site = xcli.createSite({
  name: 'example',
  url: 'https://example.com',
  requiresLogin: true,
  loginConfig: {
    loginUrl: 'https://example.com/login',
    loginUrls: ['/login', '/signin'],
    loginSelectors: ['[class*="login-modal"]'],
    loggedInSelectors: ['[class*="avatar"]'],
    loginKeywords: ['登录', '注册'],
    loginPrompt: '请在 viewer 中完成登录',
  },
});
```

未登录时会自动返回 `LOGIN_REQUIRED` 并附 `viewerUrl` / `loginUrl`。

---

## 11. 内置命令速查

| 分类 | 命令 |
|------|------|
| 导航 | `goto` / `back` / `forward` / `refresh` / `url` / `title` |
| 交互 | `click` / `dblclick` / `fill` / `type` / `press` / `hover` / `select` / `check` / `uncheck` |
| 查询 | `text` / `html` / `eval` |
| 等待 | `wait` / `waitFor` / `observe` / `act` |
| 截图 | `screenshot`（含 `--full-page` / `--base64`） |
| 录制 | `record start` / `record status` / `record stop` |
| 回放 | `replay`（含 `--slow-mo` / `--stop-on-error`） |
| 转换 | `convert`（yaml → js / py / sh） |
| 分析 | `extract` / `filter` |
| 采集 | `scrape` / `crawl` / `search` / `map` / `network` |
| 视口 | `set-viewport` / `frame` / `mouse` / `tab` |
| 存储 | `get-cookies` / `set-cookie` / `clear-cookies` / `get-local-storage` / `set-local-storage` / `clear-local-storage` |
| 快照 | `snapshot` / `structure` / `find` |
| 视图 | `viewer` / `preview` |
| 调试 | `console` / `net-debug` / `perf` / `health` |
| 子命令 | `session` / `plugin` / `create` / `replay` / `config` / `record` / `run` / `serve` / `remote` |

完整文档：`docs/commands.md`。

---

## 12. ESLint 与代码规范

```bash
# 跑 lint
npm run lint

# 跑类型检查
npm run typecheck

# 跑 Plugin Contract 校验
npm run lint:plugin-contract

# 跑全部校验
npm run validate   # = typecheck + lint + build + test（含 plugin contract 检查）
```

### ESLint 规则要点

- **禁止 `any`**（用 `unknown` 收窄）
- **禁止 `console.log`**（生产代码；测试与脚本可豁免）
- **强制类型注解**：函数参数、返回值必须有类型
- 优先 `interface` 定义对象，`type` 定义联合

### 写新插件的规则

```typescript
// ✅ 正确：使用 unknown 收窄
const value = (ctx as Record<string, unknown>).page as Page | undefined;
if (!value) throw new Error('需要 page');

// ❌ 错误：直接 any
const page = (ctx as any).page;  // 会被 lint 拒绝
```

---

## 13. 发布到 marketplace

```bash
# 1. 设置代理（marketplace 在 Cloudflare Workers）
export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7890

# 2. 登录
xbrowser marketplace login --token <key>

# 3. 准备：补 README/CHANGELOG/MARKET_DESCRIPTION/LICENSE，更新版本号

# 4. 发布
xbrowser marketplace publish <plugin-name>

# 或发布到自定义 registry
xbrowser marketplace publish <plugin-name> --registry https://your-registry.com
```

### Registry 优先级

1. `--registry` 命令行参数
2. `XBROWSER_REGISTRY` 环境变量
3. `~/.xbrowser/auth.json` 持久化地址
4. 默认 `https://xbrowser.dev`

### 版本号规范

- `MAJOR`（`x.0.0`）：不兼容 API 变更
- `MINOR`（`1.x.0`）：向后兼容的新功能
- `PATCH`（`1.0.x`）：Bug 修复

### Changelog 格式（Keep a Changelog）

```markdown
## [1.1.0] - 2026-06-10

### Added
- 新增 attach 命令支持文件上传

### Fixed
- 修复 contenteditable 输入框无法输入的问题
```

---

## 14. CDP 模式踩坑速查

完整内容见 `.opencode/ui-automator/troubleshooting/`。

### contenteditable 输入框

- ❌ 不要用 `page.fill()` — 不会触发 React/ProseMirror 状态更新
- ✅ 用 `keyboard.type({ delay: 30 })` 模拟真实键盘输入

### 点击（避免 context 丢失）

- ❌ 不要用 `locator().click()` — 可能导致 context 丢失
- ✅ 用 `evaluateHandle` + `mouse.click(x, y)` 模式

### 不能关闭浏览器

- ❌ 绝不能 `browser.close()` — 会杀掉用户整个浏览器
- ✅ 插件 handler 执行完自动断开

### 选择器稳定性

- ✅ 用 class / placeholder / id / data-testid
- ❌ 避免 `:has-text("xxx")`（SPA 文本可能延迟加载）
- ❌ 避免通用 `[class*="message"]`（会匹配到 UI 组件）

### 知识库检索

遇到 CDP / Playwright 问题，用关键词搜知识库：

- **文档 ID**：`qba7ihel9l`（CDP/Playwright 自动化通识踩坑指南）
- **关键词**：`cdp-automation` / `playwright-pitfall` / `evaluate-promise` / `button-disabled` / `feed-id` / `node-polling` / `SSE-stream`
- **标签**：`troubleshooting` / `best-practice` / `guide`

---

## 15. 测试踩坑备忘录（实测经验）

> 以下是在本仓库实际修复过的问题，**改代码前先看**。

### 源文件 vs 测试文件——谁是对的？

```
源文件（source of truth）       测试文件（可能过期）
─────────────────────────     ─────────────────────────
src/cli/session-routes.ts  →  tests/cli/session-routes.test.ts
.xcli/plugins/github/       →  tests/plugins/github.test.ts
```

**常见问题：测试断言了源文件不存在的东西（如 `loginConfig`）。**
修复原则：**以源文件为准**，修正测试。

### 选项 key 命名

| 用法 | 对应 options key |
|------|-----------------|
| `xbrowser session open --name my-sess` | `options.name` |
| `xbrowser doubao list --session my-sess` | `options.session`（全局 flag） |

`session open/close` 的子命令用 `options.name`，不要混淆。

### 插件 createSite 不需要 loginConfig

```typescript
// ✅ 正确
xcli.createSite({ name, url, requiresLogin, isLogin });  // loginConfig 可选
```

### safeClickByText 依赖 page.evaluate

写测试 mock 时：`page.evaluate` 返回 `null` → 按钮找不到；返回 `{ x, y, width, height }` → 按钮可点击。

### 更新 help 文本要同步测试

`src/cli/help.ts` → 同步改 `tests/cli/help.test.ts`。

### daemon start/stop/status 已移除

不要再写这些命令，也不要在文档/测试中引用。

### 测试常见失败原因

| 症状 | 可能原因 | 修复 |
|------|---------|------|
| `expect(spy).toHaveBeenCalledWith(...)` 收到 `"default"` | 源文件读 `options.session` 但测试传了 `name` | 统一 key 名 |
| `expect(spy).toHaveBeenCalledWith(objectContaining({loginConfig}))` | 源文件没传 `loginConfig` | 移除该断言 |
| handler 始终返回 `{success: false}` | Mock 让 `safeClickByText` 返回 null | 正确 mock `page.evaluate` |

---

## 16. 测试

```bash
# 全部测试
npm test

# E2E
npm run test:e2e

# 监听
npm run test:watch
```

测试位置：

- 单元：`tests/cdp-driver/` / `tests/plugins/` / `tests/cli/` / `tests/commands/`
- E2E：`tests/e2e/plugins/`

### 测试最佳实践

- **Mock 原则**：外部模块用 `vi.mock()`，page 对象用工厂函数创建
- **测试常见失败**：
  - 测试断言了源文件没传的参数（如 `loginConfig`）→ 移除该断言
  - `--name` 与 `--session` 混淆 → 确认 options key 与 CLI flag 一致
  - `page.evaluate` mock 返回值不对 → `safeClickByText` 依赖 `page.evaluate` 返回 bounding box
- **参考**：`tests/plugins/doubao-music.test.ts` 的 createMockPage 工厂模式

### 手动验证新插件

```bash
npm run build && npm link

# 1. 不需要登录态的命令
npx xbrowser <site> <command> --cdp http://localhost:9222 --json

# 2. 需要登录态的命令
npx xbrowser <site> <command> --cdp http://localhost:9221 --json

# 3. 检查退出码
echo "EXIT=$?"
```

---

## 17. Worktree / 分支管理

```bash
# 查看所有 worktree
git worktree list

# 新建 worktree（推荐用关联分支）
git worktree add ../xbrowser-feat-x -b feat/x

# 删除 worktree
git worktree remove ../xbrowser-feat-x
git branch -D feat/x
```

合并 worktree 改动时先 `git status` 看清 staged/unstaged 差异，分别决定。

---

## 18. 速查表（最高频 8 条命令）

```bash
xbrowser session open <url>                 # 开浏览器
xbrowser "<a> && <b> && <c>"                # 链式
xbrowser <plugin> <command>                 # 跑插件
xbrowser viewer                             # 打开 viewer（人类接管）
xbrowser record start --url <url> --name <n> # 开始录制
xbrowser record stop --output <file>.yaml   # 停止录制
xbrowser replay <file> --slow-mo 200        # 慢速回放
xbrowser plugin schema <plugin> <cmd>       # 看插件 schema
```

---

## 19. 关键文档索引

| 主题 | 文档 |
|------|------|
| 用户入门 | `docs/quickstart.md` |
| 完整命令 | `docs/commands.md` |
| 架构 | `docs/architecture.md` |
| 插件开发 | `docs/plugin-guide.md`（1456 行，主参考） |
| 录制回放 | `docs/recording.md` |
| 验证码交互 | `docs/captcha-interaction.md` |
| 钩子系统 | `docs/hook-system-boundary.md` / `docs/hook-system-proposal.md` |
| 链式命令 | `docs/chains.md` |
| WebSocket preview | `docs/websocket-preview.md` |
| SEO 插件 | `docs/seo-plugins.md` |
| Plugin Contract | `docs/plugin-contract-audit.md` |
| xcli-core PR | `docs/xcli-core-hook-pr.md` |
| xbrowser skill | `skill/SKILL.md` |
| UI 自动化技巧 | `.opencode/ui-automator/README.md` |
| 平台推广模式 | `.opencode/ui-automator/plugins/platform-promotion-guide.md` |
