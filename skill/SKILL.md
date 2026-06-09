---
name: xbrowser-dev
description: >
  xbrowser — browser automation CLI for web scraping, headless browsing, SEO analysis,
  and AI agent workflows. A Playwright/Puppeteer alternative with built-in plugin system,
  recording/replay, viewer/captcha interaction, and marketplace publishing.
  Use when: developing xbrowser plugins, writing/modifying .xcli/plugins/, running
  marketplace publish, building/testing the xbrowser core, debugging CDP connections,
  recording/replaying browser flows, implementing login/captcha handling, adding new
  lint rules or validators, working on plugin contract v2, understanding project architecture.
  Triggers: "xbrowser plugin", "plugin convention", "marketplace publish",
  "xbrowser dev", "xbrowser development", "xbrowser build/test", "plugin contract",
  "result schema", "loginConfig", "requiresLogin", "CDP driver",
  "xbrowser viewer", "preview", "captcha", "recording", "replay".
---

# xbrowser Development Guide

> **Project**: `@xbrowser/cli` — Browser automation CLI
> **Repo**: `https://github.com/dyyz1993/xbrowser`
> **Stack**: TypeScript, Playwright → CDP driver, xcli-core plugin framework, zod, vitest, tsup

---

## 1. Architecture

```
CLI (bin/cli.ts)
  └─ router.ts — 单命令 / 链 (&& , ->) / heredoc / stdin
       ├─ commands/  — 35 内置命令 (goto, click, fill, wait, record, replay, preview…)
       ├─ cli/       — 子命令路由 (session, plugin, record, run)
       └─ daemon/    — 后台 daemon + WebSocket preview 服务器
```

- **Plugin System**: `.xcli/plugins/` (138+ plugins), loaded by `xcli-core` framework
- **Browser Driver**: `src/cdp-driver/` — 自研 CDP 驱动（Playwright 替代）
- **Viewer**: 人类接管 → daemon 自动启停 → `ws://localhost:9224`

### 关键路径速查

| 你要改什么 | 文件位置 |
|-----------|---------|
| 内置命令 | `src/commands/` (35 个) |
| CLI 子命令 | `src/cli/` |
| CDP 驱动 | `src/cdp-driver/page.ts`, `browser.ts` |
| 新插件 | `.xcli/plugins/<name>/index.ts` |
| 插件 lint | `lint-scripts/` |
| 录制/回放 | `src/commands/record.ts`, `replay.ts` |
| viewer/preview | `src/cli/viewer-routes.ts`, `src/daemon/` |
| daemon | `src/daemon/` |
| 文档 | `docs/*.md` |

---

## 2. Build & Test

```bash
npm run build            # tsup → dist/
npm run dev              # watch mode
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run test             # vitest (~1959 tests)
npm run test:e2e         # E2E (needs browser)
npm run lint:plugin-contract   # Plugin Contract 校验
npm run validate         # = typecheck + lint + build + test + plugin checks

# Debug specific test
npx vitest run tests/cdp-driver/page.test.ts
npx vitest run -t "should navigate"
```

### Pre-commit 顺序

```
typecheck → ESLint → any-count → command-params → help-auto-gen →
result-schema → output-convention → plugin-metadata → plugin-code → requiresLogin
```

---

## 3. 插件开发

### 最小插件

```typescript
// .xcli/plugins/my-plugin/index.ts
import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'my-plugin',        // kebab-case
    url: 'https://example.com',
    description: '示例',
  });

  site.command('hello', {
    description: 'Hello World',
    scope: 'project',          // project | browser | page | element
    parameters: z.object({     // zod schema（可选）
      name: z.string().default('World'),
    }),
    handler: async (params) => {
      return { ok: true, message: `Hello, ${params.name}!` };
    },
  });
}
```

### 插件结构要求

```
.xcli/plugins/<name>/
├── index.ts            # export default function(api: XCLIAPI): void
└── package.json        # name, version, type:"module" 必需
```

发布时需补：`README.md` / `CHANGELOG.md` / `MARKET_DESCRIPTION.md` / `LICENSE`。

### Scope 选择速查

| Scope | 有浏览器? | 有 Page? | 适用场景 |
|-------|----------|---------|---------|
| `project` | ❌ | ❌ | API 调用、文件、数据转换 |
| `browser` | ✅ | ❌ | 多 tab、视口、cookies |
| `page` | ✅ | ✅ | 导航、DOM、截图、JS |
| `element` | ✅ | ✅ | click / fill / hover |

### 访问 Page 对象

```typescript
const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
if (!page) throw new Error('需要浏览器页面');
```

### 登录插件

```typescript
site.login(async (ctx) => { /* page.fill, page.click, ctx.storage.set */ });
site.logout(async (ctx) => { /* ctx.storage.delete */ });
```

声明 `requiresLogin: true` + `loginConfig`（详见 `references/plugin-convention.md`）。

---

## 4. 插件发布到 Marketplace

```bash
# 1. 代理（必需）
export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7890

# 2. 登录
xbrowser marketplace login --token <key>

# 3. 验证插件
node lint-scripts/check-plugin-code.mjs
node lint-scripts/check-plugin-metadata.mjs

# 4. 发布
npx xbrowser marketplace publish --dir .xcli/plugins/<name>

# dry-run 批量
bash scripts/batch-marketplace-publish.sh --dry-run
```

Registry 优先级：`--registry` > `XBROWSER_REGISTRY` > `~/.xbrowser/auth.json` > `https://xbrowser.dev`。

---

## 5. 命令行使用（Agent 常用）

### 启动浏览器

```bash
# 自启动
xbrowser session open https://example.com

# 连接已开浏览器（推荐，复用登录态）
xbrowser --cdp 9222 title

# 自动发现
xbrowser --cdp auto title
```

### 命令链（核心交互模式）

```bash
xbrowser "goto <url> && click <sel> && fill <sel> <val> && screenshot"
xbrowser "goto <url> , title , screenshot"
```

### 录制 & 回放

```bash
xbrowser record start --url https://example.com --name flow
# … 手动操作 …
xbrowser record stop --output recordings/flow.yaml
xbrowser replay recordings/flow.yaml --slow-mo 200
```

### viewer 人类接管

```bash
xbrowser viewer                # 自动启 daemon，打开 viewer
xbrowser preview --session s1  # 指定 session
```

遇到验证码时 xbrowser 会自动 pause 并提示打开 viewer。

---

## 6. 内置命令速查

| 分类 | 命令 | 常见选项 |
|------|------|---------|
| 导航 | `goto`, `back`, `forward`, `refresh` | `--waitUntil`, `--timeout` |
| 交互 | `click`, `fill`, `type`, `press`, `hover`, `select`, `check`, `attach` | `--timeout` |
| 查询 | `text`, `html`, `getProperty`, `eval` | `--selector` |
| 等待 | `wait`, `waitFor` | `--timeout`, `--state` |
| 截图 | `screenshot` | `--full-page`, `--type` |
| 录制 | `record start/status/stop` | `--url`, `--name`, `--output` |
| 回放 | `replay`, `convert`, `extract`, `filter` | `--slow-mo`, `--stop-on-error` |
| 视口 | `viewport`, `frame`, `mouse` | — |
| 视图 | `viewer`, `preview` | `--session` |
| 子命令 | `session`, `plugin`, `create`, `config` | — |

---

## 7. Lint & 代码规范

### Lint 快跑

| 脚本 | 作用 | 什么情况跑 |
|------|------|-----------|
| `node lint-scripts/check-plugin-code.mjs` | 插件代码质量 | 修改插件后 |
| `node lint-scripts/check-plugin-metadata.mjs` | 插件元数据 | 新增/改 package.json |
| `node lint-scripts/check-result-schema.mjs` | 命令结果 schema | 新增命令时 |
| `node lint-scripts/check-plugin-contract.mjs` | Plugin Contract | 改命令参数时 |

### ESLint 铁律

- **禁止 `any`** → 用 `unknown` 收窄
- **禁止 `console.log`**（生产代码）
- **强制类型注解** — 参数、返回值必须有类型
- 优先 `interface` > `type`

### Plugin Code 检查要点

- 空 `catch` 块必须有至少 `console.error` 级别的日志
- 命令 `result` schema 不能是 `z.record(z.any())`（逐步迁移到精确 schema）
- `requiresLogin` 要与实际预期一致

---

## 8. CDP 驱动踩坑（关键）

| 场景 | ❌ 不要 | ✅ 要 |
|------|--------|------|
| contenteditable 输入 | `page.fill()` | `page.keyboard.type({ delay: 30 })` |
| 点击元素 | `locator().click()` | `evaluateHandle` + `mouse.click(x,y)` |
| 关闭浏览器 | 绝不要 `browser.close()` | handler 执行完自动断开 |
| 选择器 | `:has-text("xxx")` | class / id / data-testid |
| 通用选择器 | `[class*="message"]` | 自定义精确选择器 |

---

## 9. 参考文件

| 文件 | 内容 | 何时读 |
|------|------|-------|
| `references/plugin-convention.md` | 完整插件规范、package.json 字段、结果 schema 迁移、loginConfig | 创建或修改插件时 |
| `references/lint-rules.md` | Lint 规则详细说明、RULES.md | 新增 lint 规则时 |
| `references/session-lifecycle.md` | 会话生命周期、daemon 模式 | 调试 session 问题时 |
| `references/testing-patterns.md` | 测试策略、Mock 模式、E2E 写法 | 写测试时 |
| `AGENTS.md`（仓库根目录，工作区规则） | 完整项目手册 | 新手上路、理解全部功能 |
