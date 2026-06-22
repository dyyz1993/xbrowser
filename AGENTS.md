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
| `.xcli/plugins/` | **插件主目录**（70 个站点插件） |
| `.xcli/storage/` | 插件持久化数据（cookie、登录态、运行缓存） |
| `tests/` | 单元/E2E 测试 |
| `lint-scripts/` | lint 规则（Plugin Contract 校验、参数检查） |
| `docs/` | 用户文档（`quickstart.md` / `plugin-guide.md` / `recording.md` / `captcha-interaction.md` …） |
| `skill/` | 项目 skill 目录（SKILL.md + references） |
| `.opencode/ui-automator/` | 内部技巧库（patterns / selectors / specs / troubleshooting） |
| `output/` | 临时输出（截图、JSON、HTML） |
| `recordings/` | 录制文件 |

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
xbrowser goto https://example.com
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
xbrowser goto https://example.com

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

完整规范见 `docs/plugin-guide.md`（1456 行）。

### 10.0 插件规范（必须遵守）

#### 10.0.1 命名规范：一个插件 = 一个站点

插件目录名直接使用**站点域名/品牌名**，不加前缀：

```
✅ .xcli/plugins/github/         → 命令: xbrowser github publish
✅ .xcli/plugins/devto/          → 命令: xbrowser devto publish
✅ .xcli/plugins/juejin/         → 命令: xbrowser juejin publish
✅ .xcli/plugins/medium/         → 命令: xbrowser medium publish
✅ .xcli/plugins/doubao/         → 命令: xbrowser doubao chat

❌ .xcli/plugins/promo-devto/    # 不要加功能性前缀，冗余
❌ src/promo/                    # 不要放在 src/ 下，违反第一原则
```

**原因**：
- 插件本身就是站点维度的隔离，`promo-devto publish` 等效于 `devto publish`，`promo-` 是冗余
- 一个站点可以注册多个命令（publish / list / search / stats），不局限于单一功能
- 与现有 70 个插件的命名风格一致

#### 10.0.2 结构要求

```
.xcli/plugins/<name>/
├── index.ts            # 入口（必须）
├── package.json        # 必须（含 xbrowser 元数据）
├── README.md           # 推荐（说明用法）
├── CHANGELOG.md        # 发布 marketplace 时必须
├── MARKET_DESCRIPTION.md  # 发布 marketplace 时必须
├── LICENSE             # 发布时必须（推荐 MIT）
└── helpers.ts          # 可选（辅助函数）
```

`package.json` 必须包含 `xbrowser` 元数据字段：

```json
{
  "name": "xbrowser-plugin-<name>",
  "version": "1.0.0",
  "main": "index.ts",
  "type": "module",
  "dependencies": { "zod": "^3.24.0" },
  "peerDependencies": { "@dyyz1993/xcli-core": ">=1.0.0" },
  "xbrowser": {
    "name": "<name>",
    "slug": "<slug>",
    "version": "1.0.0",
    "author": "dyyz1993",
    "description": "...",
    "site": "https://...",
    "requiresLogin": true,
    "commands": ["cmd1", "cmd2"]
  }
}
```

#### 10.0.3 命令命名规范

命令以**动作**命名，不加站点前缀（站点名由插件名提供）：

```
✅ xbrowser devto publish          # publish 是动作
✅ xbrowser devto draft            # draft 是动作
✅ xbrowser juejin fetch-articles  # fetch-articles 是动作
✅ xbrowser github list-issues     # list-issues 是动作

❌ xbrowser devto publish-article  # 重复，publish 就够了
❌ xbrowser devto devto-publish    # 加了站点前缀，冗余
```

#### 10.0.3.1 上传 / 附件命令命名规范（2026-06 统一）

**动词在前，类型用 `--type`，单/多张用 `--path` / `--paths`**：

| 场景 | 命令 | 单数 | 复数（多张） |
|------|------|------|-------------|
| 聊天附件（AI 对话） | `attach` | `--type image/file --path <f>` | `--type image --paths a.jpg,b.jpg,c.png` |
| 云盘/资源管理 | `upload` | `--path <f>` | `--paths a.jpg,b.pdf` |
| CDN/编辑器插入图片 | `upload-image` | `--path <f>` | `--paths a.jpg,b.png` |
| 文生图参考图（特殊） | `image` | `--ref <f>` | 不支持（UI 单图） |

**强制规则**：

1. **动词唯一**：`attach`（附着到消息）/ `upload`（上传到存储）/ `upload-image`（上传并获取 URL）
2. **类型用 `--type`**，不写在命令名里：`<plugin> attach image ...` ❌ → `<plugin> attach --type image ...` ✅
3. **单/多张通过参数后缀**：
   - 单数：`--path <file>` / `--image <file>` / `--ref <file>`
   - 复数：`--paths <csv>`（`a.jpg,b.jpg,c.jpg`）
4. **同语义必须同名**：
   - 所有 AI 聊天插件（chatgpt / claude / doubao / qianwen / yuanbao / deepseek）**必须**用 `attach`
   - 所有云盘/文件管理命令**必须**用 `upload`
   - 资源/编辑器场景用 `upload-image`
5. **多张上传的 handler 模板**：

```typescript
// shared/file-upload.ts 已提供
import { uploadFiles } from '../shared/file-upload.js';

site.command('attach', {
  parameters: z.object({
    type: z.enum(['image', 'file']),
    path: z.string().optional().describe('单文件路径'),
    paths: z.string().optional().describe('多文件路径（CSV）'),
  }),
  handler: async (params, ctx) => {
    const list = [
      ...(params.path ? [params.path] : []),
      ...(params.paths ? params.paths.split(',').map(s => s.trim()) : []),
    ];
    if (list.length === 0) return fail('缺少参数', ['--path 或 --paths 二选一']);
    return uploadFiles(page, params.type, list);  // 内部循环上传
  },
});
```

**多张上传硬性约束（`--paths` 走 CSV 格式，强制遵守）**：

| # | 约束 | 规则 | 反例 → 正确 |
|---|------|------|------------|
| 1 | **CSV 分隔符** | 唯一使用英文逗号 `,`，每个值无引号 | `--paths "a.jpg, b.png"` ❌（带空格）→ `a.jpg,b.png` ✅ |
| 2 | **同类型** | 一个 `--paths` 内的所有文件类型一致（与 `--type` 匹配） | `--type image --paths a.jpg,b.pdf` ❌ → 拆成两次调用 |
| 3 | **数量上限** | 单次最多 50 个（`shared/uploadFiles` 内部硬限制） | 51 个文件 → 拆成两次调用或循环 |
| 4 | **路径展开** | 路径中**不**支持 `~`、通配符、相对路径，必须是绝对路径或命令解析器展开的路径 | `--paths "~/*.jpg"` ❌ → 调用方先 `ls` 展开成绝对路径 |
| 5 | **顺序保证** | 文件按 CSV 顺序依次上传，第 N 个失败时**不**打断后续（best-effort），结果里标注 `uploaded` 字段 | — |
| 6 | **空列表拒绝** | `--paths` 解析后为空时返回 `fail`，**不**静默成功 | `paths=""` 或 `paths=",,,"` → fail |
| 7 | **去重** | 同一路径在 `--path` 和 `--paths` 中重复出现时，**去重保留**第一次出现的 | — |
| 8 | **混合大小写** | 扩展名大小写不敏感（`.JPG` 和 `.jpg` 等价） | — |

**多张上传结果字段**（`shared/uploadFiles` 返回值）：

```typescript
{
  ok: boolean,        // 至少 1 个文件上传成功
  uploaded: number,   // 成功数
  total: number,      // 总数
  files: string[],    // 成功的绝对路径
  errors: string[],   // 每个失败的文件 + 原因
}
```

**反例**：

| 反例 | 问题 | 正确 |
|------|------|------|
| `doubao attach image` | 类型写在命令名 | `doubao attach --type image` |
| `doubao upload-image` | 在 doubao 上下文里和 `attach` 重复 | `doubao attach --type image` |
| `doubao upload --paths a,b` 复数参数名错 | 应该是 `attach` | `doubao attach --type file --paths a,b` |
| 命令只接单文件，不支持多张 | 违反"多张上传"统一规范 | 改成 `--paths <csv>` |
| `--paths "a.jpg; b.png; c.webp"` | 用了分号 | `--paths "a.jpg,b.png,c.webp"` |
| `--paths "a.jpg b.png c.webp"` | 用了空格 | `--paths "a.jpg,b.png,c.webp"` |
| `--paths "~/photos/*.jpg"` | 通配符 | 调用方先展开：`paths=$(ls ~/photos/*.jpg | tr '\n' ',' | sed 's/,$//')` |
| `--type image --paths a.jpg,b.pdf` | 混合类型 | 拆成两次调用 |
| `--type image --paths ""` | 空字符串 | 去掉 `--paths` 或填入实际路径 |

#### 10.0.3.2 chat 命令内嵌附件的规范（2026-06 统一）

**6 个 AI 聊天插件的 `chat` 命令**（chatgpt / claude / deepseek / doubao / qianwen / yuanbao）已统一为：

```bash
# 单文件
chatgpt chat "分析这张图" --path /path/to/img.jpg

# 多张
chatgpt chat "对比这3张" --paths "/a.jpg,/b.png,/c.jpg"

# URL 链接（仅 chatgpt/claude/deepseek/doubao 支持，qianwen/yuanbao 无 url 类型）
chatgpt chat "看这个" --type url --path https://example.com
```

**字段规范**：

| 字段 | 类型 | 必选 | 说明 |
|------|------|------|------|
| `path` | string | 否 | 单附件路径（绝对路径） |
| `paths` | string | 否 | 多附件路径（CSV，与 `--type` 匹配） |
| `type` | enum | 否 | `image`（默认）/ `file` / `url` |

**禁止**：

- ❌ `chat --attach <file>`（旧的单文件短选项，已废弃）
- ❌ `chat --attachType image|file|url`（旧类型字段，已废弃）
- ❌ `chat --paths a.jpg --paths b.jpg`（错误合并方式，应一次性传 CSV）

**实现**：所有 6 个 chat 命令的 handler 内部统一调用 `shared/ai-chat-base.ts` 的 `handleChatAttachments(page, path, paths, type, tips)`，不要再自己写上传逻辑。

#### 10.0.3.3 TODO：哪些插件未来需要补 attach 命令？

**当前已有 attach 命令**（6 个 AI 聊天插件）：chatgpt、claude、deepseek、doubao、qianwen、yuanbao

**未来可能需要补 attach 命令的插件**（按场景分类）：

| 类别 | 候选插件 | 触发条件 |
|------|---------|---------|
| AI 对话 | gemini、qwen（阿里通义） | 如果与 6 个 chat 插件行为对齐 |
| 社交/UGC | twitter、facebook、instagram、weibo、xiaohongshu、douyin、bilibili、reddit、quora、zhihu、tumblr | 当用户提出"发帖配图"需求时 |
| 技术社区 | devto、medium、juejin、csdn、wordpress、hashnode、blogger、producthunt | 当用户提出"发博文配图"需求时 |
| 图站 | flickr、imgur、p500px、9gag、pixabay、pexels、unsplash、shutterstock、gettyimages、artstation、behance、deviantart、dribbble、duitang、huaban、quanjing、699pic、58pic、1688 | 当用户提出"上传图片"需求时 |
| 电商/资源 | jd、taobao | 上传商品图 |
| 其他 | 1688、steam、cmf-seats、ctrip-review | 评估中 |

**决策原则**（避免过度设计）：

1. **不做预防性添加**：插件没提需求时不要主动加 `attach` 命令（违反"只做被要求的事"）
2. **加时一次性补齐**：如果某插件出现上传需求，**一次性**集成 `attach` + `handleChatAttachments` 到 chat/发消息/发贴 命令，并写 E2E 测试
3. **复用 helper**：必须接入 `shared/ai-chat-base.ts` 的 `batchUploadFiles` 或 `handleChatAttachments`，不要在插件里写自定义上传
4. **写测试**：每个新加 attach 的插件必须有 `tests/plugins/<name>.test.ts` 覆盖 attach 行为

#### 10.0.4 使用 Playwright API，不要 `execSync` 调 xbrowser

```typescript
// ✅ 正确：使用 Playwright Page API
const page = ctx.page;
if (!page) throw new Error('需要浏览器页面');
await page.goto('https://dev.to/new');
await page.locator('input[placeholder*="title"]').fill(title);
await page.locator('button:has-text("Publish")').click();

// ❌ 错误：execSync 调 xbrowser CLI（来自 src/promo/ 的反面教材）
execSync(`${cli} fill @e_title ${JSON.stringify(title)}`);
execSync(`${cli} find text "Publish" click`);
```

使用直接 API 的好处：类型安全、错误处理完整、可调试、不依赖 CLI 解析。

#### 10.0.5 注册模式

统一使用 `createSite()` + `site.command()` + `ok()`/`fail()` 模式：

```typescript
import { z } from 'zod/v4';
import type { XCLIAPI } from '@dyyz1993/xcli-core';
import { ok, fail } from '@dyyz1993/xcli-core';
import type { Page, Locator } from '../types.js';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'my-plugin',        // 与目录名一致
    url: 'https://example.com',
    description: '插件说明',
    requiresLogin: true,      // 需要登录时设为 true
    isLogin: async (ctx) => { /* 检查登录态 */ },
  });

  site.command('my-command', {
    description: '命令说明',
    scope: 'page',            // project | browser | page | element
    loginRequired: 'none',    // 'none' | 'optional' | 'required'
    parameters: z.object({
      param1: z.string().describe('参数说明'),
    }),
    examples: [               // 提供示例方便测试
      { cmd: 'xbrowser my-plugin my-command --param1 val', description: '示例' },
    ],
    handler: async (params, ctx) => {
      return ok({ data: 'value' }, ['提示信息']);
    },
  });

  site.login(async (ctx) => { /* 登录逻辑 */ });
  site.logout(async (ctx) => { /* 登出逻辑 */ });
}
```

#### 10.0.6 善用脚手架快速创建

```bash
# 创建基础插件（只有 index.ts + package.json）
xbrowser create my-plugin --template static

# 创建带浏览器交互的插件（navigate + interact 命令）
xbrowser create my-plugin --template dynamic

# 创建设置了登录/登出的插件
xbrowser create my-plugin --template login

# 创建 API 集成插件
xbrowser create my-plugin --template api
```

生成后：
1. 把目录移到 `.xcli/plugins/<name>/`
2. 修改 `name`、`url` 等字段
3. 添加实际业务逻辑
4. 补充 `package.json` 的 `xbrowser` 元数据

#### 10.0.7 插件测试规范

每个插件**必须**有对应的测试文件 `tests/plugins/<name>.test.ts`。

测试模式（参考 `tests/plugins/devto.test.ts` 和 `tests/plugins/quora.test.ts`）：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import plugin from '../../.xcli/plugins/<name>/index.ts';

// 1. Mock XCLIAPI
const mockSite = { command: vi.fn(), login: vi.fn(), logout: vi.fn() };
const mockXCLI = { createSite: vi.fn(() => mockSite) };

// 2. 辅助函数：获取注册的命令 handler
function getHandler(name: string): Function {
  const call = mockSite.command.mock.calls.find((c: unknown[]) => c[0] === name);
  return call![1].handler;
}

// 3. 辅助函数：创建 mock 页面上下文
function createMockPage() {
  return {
    goto: vi.fn(),
    waitForTimeout: vi.fn(),
    waitForLoadState: vi.fn(),
    evaluate: vi.fn(),
    locator: vi.fn(() => ({ first: vi.fn(), isVisible: vi.fn(), click: vi.fn(), fill: vi.fn() })),
    fill: vi.fn(), click: vi.fn(), url: vi.fn(() => 'https://...'),
    keyboard: { insertText: vi.fn(), press: vi.fn() },
    mouse: { wheel: vi.fn(), move: vi.fn() },
    close: vi.fn(),
  };
}

describe('<name> plugin', () => {
  beforeEach(() => { vi.clearAllMocks(); plugin(mockXCLI as any); });

  // ——— 注册测试 ———
  it('should create site with name', () => { /* 检查 createSite 参数 */ });
  it('should register N commands', () => { /* 检查 command 调用次数 */ });
  it('should register expected command names', () => { /* 检查命令名列表 */ });
  it('each command should have description, scope, parameters, handler', () => { /* 遍历检查 */ });
  it('should register login/logout hooks', () => { /* 检查 site.login/site.logout 被调用 */ });

  // ——— 功能测试（每个命令一个 describe） ———
  describe('login command', () => {
    it('should throw when no page', async () => { /* handler({}, ctx_sem_page) → reject */ });
    it('should navigate to login page', async () => { /* 检查 page.goto */ });
    it('should call waitForHuman', async () => { /* 检查 ctx.waitForHuman */ });
    it('should save login state to storage', async () => { /* 检查 ctx.storage.set */ });
  });

  describe('publish command', () => {
    it('should throw when no page', async () => { /* ... */ });
    it('should navigate to editor', async () => { /* 检查 page.goto */ });
    // ...
  });

  // ... 其他命令
});
```

**必须覆盖的测试点**：
- 每个命令的注册元数据（name、description、scope、parameters、handler）
- 无 page 时的错误处理（throw 或 fail）
- 关键导航路径（page.goto 的 URL）
- 返回值结构（data 字段）
- 提示信息（tips 或 error）
- login/logout hook 的 storage 操作

#### 10.0.8 常见反例

| 反例 | 问题 | 正确做法 |
|------|------|---------|
| `src/promo/devto.ts` | 发布脚本放 `src/` 下 | 移到 `.xcli/plugins/devto/` 作为独立插件 |
| `xbrowser promo --platform devto` | 一个命令调度多站点 | 每个站点独立插件：`xbrowser devto publish` |
| `execSync(\`xbrowser fill ...\`)` | shell out 调 CLI | 用 `ctx.page.locator().fill()` 等 API |
| `promo-devto` 目录名 | 冗余前缀 | 直接用 `devto` |

---

### 10.1 插件结构（参考）

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

### 12.1 xcli-core tips API 迁移（2026-06-22）

> **背景**：xcli-core ≥ 0.15.0 把 `CommandResult.tips` 从 `string[]` 改成了 `Tip[]`（`{ level, message, label? }`）。
> 本仓库已完成核心层迁移，但**插件层保持 `string[]`**（71 个插件零改动）。
> 这通过**核心层适配**实现——在 xbrowser ↔ xcli-core 的类型边界做转换。

#### 迁移原则：核心适配，插件零改动

```
插件代码（string[] tips）           ← 不改，保持 const tips: string[] = []
    ↓
xbrowser 核心层（executor/router）  ← normalizeTips(string[]) → Tip[] 转换
    ↓
xcli-core 0.15.0（Tip[] tips）      ← ok(data, Tip[]) / fail(msg, Tip[])
```

#### 关键 API（从 xcli-core import）

| API | 作用 | 用法 |
|-----|------|------|
| `normalizeTips(tips: Array<string \| Tip>)` | `string[]` → `Tip[]` | 核心 command 返回 tips 时调用 |
| `tip.info(msg)` / `tip.warn(msg)` / `tip.error(msg)` | 构造单个 `Tip` | 需要指定 level 时用 |
| `TipCollector` | ctx.tips 的类型（CommandContext 要求） | 构造 ctx 时 `tips: new TipCollector()` |
| `CompositeStorage` | 满足 `StorageContext`（含 plugin/global/cache/tmp） | 替代旧 `PluginStorage`（后者缺嵌套 store） |

#### 三个适配点（核心代码必须遵守）

| # | 位置 | 做法 |
|---|------|------|
| 1 | **构造 ctx 时** | 必须加 `tips: new TipCollector()`（CommandContext 要求） |
| 2 | **核心 command 返回 tips** | `ok(data, normalizeTips(stringArray))`，不要直接传 `string[]` |
| 3 | **archive 归档时** | `tipsToMessages(Tip[])` 转回 `string[]`（CommandArchiveEntry 协议要 string[]） |

#### 插件开发者：不需要改

插件继续用 `tips: string[]`——核心层会自动转换：

```typescript
// ✅ 插件代码保持不变（核心层会 normalizeTips 转换）
const tips: string[] = [];
tips.push('操作成功');
return ok(data, tips);  // ← 核心层的 ok 签名虽变，但插件层 ok() 有适配
```

> **注意**：如果插件直接 import xcli-core 的 `ok()`/`fail()`，需要手动 `normalizeTips()`。
> 推荐插件用 `ctx.tips.info(msg)` 收集 tips（TipCollector 方式，自动适配）。

#### 反例（禁止）

```typescript
// ❌ 直接把 string 塞进 Tip[]（result.tips 是 Tip[]）
result.tips = ['some string'];

// ❌ 构造 ctx 时漏掉 tips 字段（CommandContext 要求 tips: TipCollector）
const ctx = { storage, output, ... };  // 缺 tips → typecheck 报错

// ❌ archive 里传 Tip[]（协议要 string[]）
recordArchive({ result: { tips: tipObjects } });  // 应 tipsToMessages(tipObjects)
```

#### 正确做法

```typescript
// ✅ 核心 command 返回 tips
import { ok, normalizeTips } from '@dyyz1993/xcli-core';
return ok(data, normalizeTips(['提示文案']));

// ✅ 构造 ctx
import { TipCollector, CompositeStorage } from '@dyyz1993/xcli-core';
const ctx = { ..., tips: new TipCollector(), storage: new CompositeStorage(...) };

// ✅ archive 归档（Tip[] → string[]）
function tipsToMessages(tips: Tip[] | undefined): string[] {
  return (tips || []).map(t => typeof t === 'string' ? t : t.message);
}
```

#### 本次迁移涉及的文件（2026-06-22）

| 文件 | 改动 |
|------|------|
| `src/executor.ts` | `ExecutionResult.tips` → `Tip[]`；ctx 补 `TipCollector`；storage 改 `CompositeStorage`；合并/归档转换 |
| `src/router.ts` | ctx 补 `TipCollector`；login tips 适配；打印取 `.message` |
| `src/commands/{agent,evaluate,find,interaction,snapshot}.ts` | `ok(data, normalizeTips([...]))` |

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

### CDP Firewall 检测合成事件（重要！2026-06 豆包实战）

生产站点（豆包、TikTok、抖音等）会监听 `isTrusted` 属性，**JS 触发的合成事件**（`el.click()`、`el.dispatchEvent`）会被识别并可能导致：
- 页面跳转到 `about:blank`
- 操作被静默拒绝
- 弹警告：`⚠️ CDP Firewall: Event simulation detected: "el.click()"`

**绝对不要**：
```typescript
// ❌ 在 page.evaluate 里调用 el.click() — isTrusted=false
await page.evaluate(() => document.querySelector('button').click());

// ❌ Locator.click() 内部也是合成事件
await page.locator('button').click();
```

**正确**：
```typescript
// ✅ 用真实 Input.dispatchMouseEvent，isTrusted=true
const rect = await page.evaluate(() => {
  const btn = document.querySelector('button');
  const r = btn.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(rect.x, rect.y);
```

封装在 `.xcli/plugins/shared/file-upload.ts` 的 `clickButtonByText(page, text)` 已用真实 mouse 事件。

### 文件上传：不要点 file input

**绝对不要**：
```typescript
// ❌ 点 file input 会弹系统文件选择框 + 触发 CDP Firewall
await page.mouse.click(fileInputRect.x, fileInputRect.y);
```

**正确**：用 `page.setInputFiles`（CDP 模式已实现，内部用 DataTransfer + dispatch change 事件，React 监听 onChange 处理）。

```typescript
const fileBuffer = fs.readFileSync(absPath);
await page.setInputFiles('input[type="file"]', {
  name: path.basename(absPath),
  mimeType: 'image/png',
  buffer: fileBuffer,
});
```

完整决策树（5 种 pattern）见 `skill/file-upload/SKILL.md`。

### page.waitForEvent vs page.context().waitForEvent

- ✅ `page.waitForEvent('filechooser', { timeout: 5000 })` — 监听 page 事件
- ❌ `page.context().waitForEvent` — context 上**没有**这个方法，会报 "not a function"

如果要在事件触发时执行动作（如 `filechooser`），用 `page.waitForEvent`。

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
| `xbrowser doubao list --session my-sess` | `options.session`（全局 flag） |

`--session` 是会话路由的主选项，会话已改为自动创建（无需显式 `session open`）。

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
xbrowser goto <url>                          # 打开页面（自动创建会话）
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

---

## 20. 录制器自测（Agent 自动化验证）

> 录制器功能可以通过 CDP 命令全自动测试，**不需要人工在浏览器里操作**。

### 20.1 前置条件

- Chrome 已以 `--remote-debugging-port=9221` 启动，且已登录目标站点（如掘金）
- daemon 在端口 9224 上运行

### 20.2 完整自测流程

```bash
# 1. 构建 & 启动 daemon
cd /Users/xuyingzhou/Project/study-node-ts/xbrowser
npm run build
pkill -f "node dist/daemon-main" 2>/dev/null; sleep 1
node dist/daemon-main.js &
sleep 2

# 2. 启动录制（连接到已开浏览器）
node dist/cli.js record start \
  --url https://juejin.cn/creator/home \
  --cdp http://localhost:9221 \
  --session auto-test

# 3. 模拟用户操作（CDP 命令）
sleep 5  # 等页面加载

# 点击"写文章"
node dist/cli.js click '.send-button' \
  --cdp http://localhost:9221 --session auto-test

# 如果"写文章"打开了新 tab，当前 tab 不会跳转，需要手动导航
node dist/cli.js goto https://juejin.cn/editor/drafts/new \
  --cdp http://localhost:9221 --session auto-test

# 填标题
sleep 3
node dist/cli.js fill '.title-input' 'auto-test-title' \
  --cdp http://localhost:9221 --session auto-test

# 保存草稿（等待自动保存）
sleep 3

# 跳转到草稿列表
node dist/cli.js goto https://juejin.cn/editor/drafts \
  --cdp http://localhost:9221 --session auto-test

# 点"删除"（通过 eval 找文字匹配，因为弹窗元素没有稳定 selector）
sleep 3
node dist/cli.js eval \
  "[...document.querySelectorAll('*')].filter(el=>el.textContent.trim()==='删除'&&el.children.length===0)[0]?.click();'done'" \
  --cdp http://localhost:9221 --session auto-test

# 点"确定"
sleep 1
node dist/cli.js eval \
  "[...document.querySelectorAll('button')].filter(el=>el.textContent.trim()==='确定')[0]?.click();'done'" \
  --cdp http://localhost:9221 --session auto-test

# 4. 停止录制
node dist/cli.js record stop --session auto-test
```

### 20.3 检查录制结果

```bash
# 查看录制摘要
node dist/cli.js record stop --session auto-test 2>&1 | head -20

# 查看 recording.json 中的 element 字段（strategy / confidence / textFallback / popup）
node -e "
const d = JSON.parse(require('fs').readFileSync(
  require('os').homedir() + '/.xbrowser/sessions/auto-test/recordings/recording.json', 'utf8'
));
d.actions.forEach(a => {
  const e = a.element;
  if (!e) { console.log('[' + a.id + '] ' + a.type + ' (no element)'); return; }
  const tf = e.textFallback ? ' textFallback=\"' + e.textFallback.value + '\" (' + e.textFallback.type + ')' : '';
  const popup = e.popup ? ' [popup: ' + e.popup.containerSelector + ']' : '';
  console.log('[' + a.id + '] ' + a.type.padEnd(10) +
    ' sel=' + (e.selector || '').padEnd(55) +
    ' strat=' + (e.strategy || '-').padEnd(18) +
    ' conf=' + (e.confidence || '-').padEnd(7) +
    ' text=\"' + (e.text || '').substring(0,15) + '\"' +
    tf + popup);
});
"
```

### 20.4 预期输出示例

```
[1] cdp-click  sel=.send-button                                            strat=-                  conf=-       text=""
[3] cdp-fill   sel=.title-input                                            strat=-                  conf=-       text=""
[8] click      sel=li:nth-of-type(2)                                       strat=nth-of-type        conf=low     text="删除" textFallback="删除" (popup-text) [popup: .menu-list]
[9] click      sel=.confirm-btn                                            strat=class              conf=medium  text="确定"
```

### 20.5 录制数据字段说明

每个 action 的 `element` 包含以下字段：

| 字段 | 说明 | 示例 |
|------|------|------|
| `selector` | CSS 选择器（13 段策略生成） | `.send-button` / `input[placeholder="输入文章标题..."]` |
| `strategy` | 生成策略 | `class` / `placeholder` / `nth-of-type` / `attribute` |
| `confidence` | 可靠性评级 | `high`（id/testid/aria） / `medium`（class） / `low`（nth-of-type） |
| `textFallback` | 文字兜底定位（弹窗内唯一） | `{ type: "popup-text", value: "删除", selector: "popup-text=删除" }` |
| `popup` | 弹窗容器信息 | `{ containerSelector: ".menu-list", containerText: "编辑 删除" }` |
| `tag` / `text` / `role` | 元素基础信息 | `button` / `写文章` / `button` |

### 20.6 回放策略（基于 confidence 分级）

回放器应按 confidence 从高到低尝试定位：

1. **high** → 直接用 `selector`（`#id` / `[data-testid]` / `[aria-label]` / `[name]`）
2. **medium** → 用 `selector`，失败时用 `text` 兜底
3. **low** → 优先用 `textFallback`（如 `popup-text=删除`），再用 `selector`，最后用 `x/y` 坐标
4. **任何级别** → 都有 `x` / `y` 坐标作为最终兜底

### 20.7 注意事项

- **CDP 命令会被记录为 `cdp-click` / `cdp-fill` / `goto` 类型**，和用户真实操作（`click` / `input`）区分
- **去重窗口 1.5 秒**：CDP 命令触发 DOM 事件后，1.5 秒内同一类型的 action signal 会被过滤
- **新 tab 不会自动跟踪**：CDP 模式下 `click` 打开新 tab 后，CDP 命令仍在旧 tab 执行，需要 `goto` 手动导航
- **录制文件位置**：`~/.xbrowser/sessions/<session-name>/recordings/recording.json`

### 20.8 录制器架构（相关文件）

| 文件 | 作用 |
|------|------|
| `src/recorder/session-recorder.ts` | 录制器核心（action signal 脚本、network 捕获、popup context、flush 逻辑） |
| `src/recorder/selector-utils.ts` | 13 段策略 CSS selector 生成器（`generateUniqueSelector`） |
| `src/daemon/rpc-handlers.ts` | daemon RPC 处理（record start/stop、CDP 命令注入 recorder） |
| `src/cdp-driver/context.ts` | BrowserContext（page 事件转发、新 tab 检测） |
| `src/cdp-driver/page.ts` | Page（CDP 连接、evaluate、addInitScript、network 监听） |
| `tests/recorder/session-recorder.test.ts` | SessionRecorder 单元测试（15 用例） |

## 21. 录制器生产级修复记录（v2）

### 21.1 修复清单

| # | 问题 | 根因 | 修复 | 文件 |
|---|------|------|------|------|
| 1 | 假 navigation action（第一次 flush） | actions 为空导致 URL 变化误判 | `lastKnownUrl` 字段跟踪，start() 时初始化 | `session-recorder.ts` |
| 2 | cdp-click url=about:blank | click 后页面导航，page.url() 返回中间状态 | `urlBeforeCommand`（executeCommand 前获取）+ `lastKnownUrl` fallback | `rpc-handlers.ts`, `session-recorder.ts` |
| 3 | 重复 action（cdp-fill + input） | 双向时序问题（action signal 先到或后到） | 双向去重：reverse dedup + `lastActionTs` 更新 | `session-recorder.ts` |
| 4 | navigation 重复（尾斜杠差异） | `example.com/` vs `example.com` | URL normalize 去尾斜杠 | `session-recorder.ts` |
| 5 | cdp-fill 缺 element 元数据 | `recordCommandAction` 只存 selector | `injectCommandToRecorder` 改 async，`page.evaluate` 调用 `__xb_describe()` | `rpc-handlers.ts`, `session-recorder.ts` |
| 6 | network 为 0 | CDP 模式下 context 事件转发遗漏 | page 级别 request/response 监听 + context 级别双重保障 | `session-recorder.ts` |
| 7 | popup 检测不全 | `el.closest()` 选择器不够 | 加 `[id*=menu]` / `[id*=dropdown]` 等 | `session-recorder.ts` |

### 21.2 单元测试

```
tests/recorder/session-recorder.test.ts — 15 用例，覆盖：
  - recordCommandAction 元数据（strategy/confidence/textFallback）
  - 去重（正向 + 反向 + 窗口过期）
  - lastKnownUrl 跟踪（about:blank fallback、goto 后更新）
  - stop() 输出结构（data/summary/steps/elements）
  - 边界情况（空录制、无 element、cdp-eval、about:blank）
```

运行：`npx vitest run tests/recorder/session-recorder.test.ts`

### 21.3 已知限制

| 限制 | 说明 |
|------|------|
| iframe 内 input 事件 | action signal 脚本只注入到主页面，iframe 内的 input/change 事件不被监听。CDP eval 操作可通过 cdp-eval action 记录 |
| framenavigated（CDP 模式） | CDP 连接下 framenavigated 可能不触发，已通过 flush 中 URL 变化检测兜底 |
| 多 tab 录制 | 新 tab 会注入 action signal 脚本，但 CDP 模式下可能遗漏部分事件 |

### 21.4 回归测试命令

```bash
# 构建 + 启动 daemon
npm run build && node dist/daemon-main.js &

# 全场景回归
node dist/cli.js record start --url "file:///tmp/recorder-test.html" --cdp http://localhost:9221 --session regression
sleep 3
node dist/cli.js fill '#username' 'test' --cdp http://localhost:9221 --session regression
sleep 1
node dist/cli.js click '#dropdown-btn' --cdp http://localhost:9221 --session regression
sleep 1
node dist/cli.js goto https://example.com --cdp http://localhost:9221 --session regression
sleep 2
node dist/cli.js click 'a' --cdp http://localhost:9221 --session regression
sleep 3
node dist/cli.js record stop --session regression
```

预期：6 actions，无 about:blank，无重复，有 navigation，有 network。
