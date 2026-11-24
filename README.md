# xbrowser

> **Scraping a page, filling in a form, or grabbing a screenshot shouldn't take a Playwright project — environment setup, a script, and selectors to maintain.**
> **xbrowser turns each one into a single command line.** No code to write: run it in your terminal, chain steps together, or let your AI agent call it.
>
> **抓取一个页面、填写一张表单、截一张图，不该为此搭一个 Playwright 工程——配环境、写脚本，还要长期维护选择器。**
> **xbrowser 把每一件事都变成一行命令。** 不用写代码：终端里直接跑，多步用命令链串起来，也可以让 AI Agent 直接调用。

[![CI Status](https://github.com/dyyz1993/xbrowser/workflows/CI/badge.svg)](https://github.com/dyyz1993/xbrowser/actions)
[![codecov](https://codecov.io/gh/dyyz1993/xbrowser/branch/master/graph/badge.svg)](https://codecov.io/gh/dyyz1993/xbrowser)
[![npm version](https://img.shields.io/npm/v/@xbrowser/cli.svg)](https://www.npmjs.com/package/@xbrowser/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **One command instead of a script** — 59 built-in commands (`scrape`, `click`, `fill`, `search`, `screenshot`, …), each a one-liner
- **Command chains** — string steps together with `&&`, `->`, `,`, `+`, `||`, or pipe and heredoc a whole workflow
- **Record & replay** — record a flow once to YAML, replay it in CI or export it as a standalone Playwright script; stale selectors re-resolve themselves ([self-healing replay](docs/recording.md))
- **126 site plugins** — publish, search, and collect on real sites (Dev.to, Juejin, CSDN, GitHub, …), one plugin per site: `xbrowser plugin install <name>`, or scaffold your own with `xbrowser create my-plugin`
- **Built for AI agents** — built-in MCP server (`xbrowser mcp`), `--json` output, token-friendly page snapshots
- **Use the browser you already have** — attach to a running Chrome over CDP and keep your logins; multi-session, daemon mode, and a [stealth layer](docs/stealth.md)

## 特性

- **一条命令替代一个脚本** — 59 个内置命令（`scrape`、`click`、`fill`、`search`、`screenshot` 等），每个都是一行
- **命令链** — 用 `&&`、`->`、`,`、`+`、`||` 串联多步，整条流程也可以走管道和 Heredoc
- **录制 / 回放** — 录一次存成 YAML，CI 里随时回放，也可导出成独立的 Playwright 脚本；选择器失效会自动重新定位（[自愈回放](docs/recording.md)）
- **126 个站点插件** — 在真实站点上发布、搜索、采集（Dev.to、掘金、CSDN、GitHub 等），一个站点一个插件：`xbrowser plugin install <name>` 安装，或用 `xbrowser create my-plugin` 脚手架写自己的
- **为 AI Agent 而生** — 内置 MCP Server（`xbrowser mcp`）、`--json` 输出、对 token 友好的页面快照
- **复用你已有的浏览器** — 通过 CDP 连接正在运行的 Chrome、保留登录态；多会话并行、Daemon 常驻、[Stealth 伪装层](docs/stealth.md)

## Quick start

```bash
# Install — needs Node.js >= 18 and a local Chrome or Chromium (auto-detected on macOS/Linux)
npm install -g @xbrowser/cli

# Three steps, one line, zero scripts
xbrowser "goto https://example.com && title && screenshot"
```

```text
[OK] goto https://example.com
     url: https://example.com
     status: 200
[OK] title
     title: Example Domain
[OK] screenshot
     output: …/xbrowser/screenshots/screenshot-….png
```

Want your AI agent to drive the browser instead?

```bash
claude mcp add xbrowser -- xbrowser mcp
```

Full guide: [快速开始](#快速开始) · More recipes: [Use Cases](#use-cases)

## Use Cases

**Web Scraping & Data Extraction**
```bash
# Scrape any page to Markdown — no Playwright scripts needed
xbrowser scrape https://news.ycombinator.com --format markdown

# Or pull the tables out as structured data
xbrowser scrape https://news.ycombinator.com --mode smart

# Crawl an entire site
xbrowser crawl https://example.com --maxDepth 3 --format markdown
```

**Search Engine Automation**
```bash
# Search Google, Bing, Baidu from the command line
xbrowser search "best headless browser CLI" --engine google --limit 10 --json

# Time-filtered search
xbrowser search "playwright alternative 2025" --engine bing --recency month
```

**Browser Automation for AI Agents**
```bash
# Record browser actions, replay in CI/CD
xbrowser record start --url https://example.com --name my-flow
# …click through the flow in the browser, then:
xbrowser record stop --output workflow.yaml
xbrowser replay workflow.yaml

# Chain commands for complex workflows
xbrowser "goto https://news.ycombinator.com && wait .titleline && text --selector '.titleline > a'"
```

**SEO & Backlink Automation**
```bash
# Publish articles to SEO platforms via site plugins
xbrowser devto publish --title "My article" --file article.md
xbrowser juejin publish --title "My article" --file article.md
# (Each platform has its own plugin — run `xbrowser plugin list` to see available)
```

**Content Marketing — xbrowser promotes itself (dogfooding)**
```bash
# Browse the built-in promo case library (self-healing replay, CLI for AI agents, stealth…)
xbrowser content cases

# Render a case into a platform-ready article (en/zh, {{VAR}} substituted)
xbrowser content draft --case self-healing-replay --lang zh

# Render an OG cover image with the browser itself — zero imaging libraries
xbrowser "set-viewport 1200 630 && content cover --title 'Self-Healing Replay' --output cover.png"

# Publish through a platform plugin
xbrowser devto publish --title "Self-Healing Replay" --file output/content/self-healing-replay-en.md --tags "typescript,automation"
```
The full write → cover → publish loop that promotes xbrowser is itself built on xbrowser commands.

## 快速开始

### 安装

```bash
npm install -g @xbrowser/cli
```

> ⚠️ **正确的包名是 `@xbrowser/cli`**（scoped package）。`xbrowser`（无 scope）和 `@dyyz1993/xbrowser` 都不是最新版本。

### 最低要求

- Node.js >= 18
- Chromium 或 Google Chrome（自动探测 macOS / Linux 常见路径，优先 `/Applications/Chromium.app/Contents/MacOS/Chromium`；其它路径用环境变量 `XBROWSER_CHROMIUM_PATH` 指定）

### 第一次使用

```bash
# 打开浏览器，导航到页面
xbrowser goto https://example.com

# 获取页面标题
xbrowser title
# 输出: title: Example Domain

# 获取页面文本
xbrowser text

# 截图（默认存到系统临时目录 …/xbrowser/screenshots，用 --output 指定路径）
xbrowser screenshot

# 关闭会话
xbrowser session close
```

### 单行命令链

会话会自动创建，命令链会自动启动浏览器并在执行完毕后关闭：

```bash
# 用逗号分隔
xbrowser "goto https://example.com , title , text"

# 用 + 分隔
xbrowser "goto https://example.com + screenshot"

# 用 -> 分隔
xbrowser "goto https://example.com -> title -> click '#more'"

# 用 && 分隔（前一步失败则停止）
xbrowser "goto https://example.com && title && screenshot"

# 用 || 分隔（前一步成功则跳过后续）
xbrowser "goto https://example.com || goto https://fallback.com"
```

### 管道

```bash
echo "goto https://example.com" | xbrowser
echo "title" | xbrowser
```

### Heredoc

```bash
xbrowser <<EOF
goto https://example.com
title
click "a"
text
EOF
```

### 从文件执行

```bash
# 创建脚本文件 commands.txt
cat > commands.txt << 'EOF'
goto https://example.com
title
text
screenshot
EOF

# 执行
xbrowser run commands.txt
```

### -e / --eval 模式

```bash
xbrowser -e "goto https://example.com" -e "title"
```

### CDP 连接（连接已运行的浏览器）

```bash
# 通过 WebSocket URL 连接（<id> 取自 http://localhost:9222/json/version）
xbrowser --cdp ws://localhost:9222/devtools/browser/<id> "goto https://example.com , title"

# 通过端口号连接
xbrowser --cdp 9222 "goto https://example.com , title"

# 自动发现
xbrowser --cdp auto "goto https://example.com , title"
```

## 所有命令

### 全局参数

| 参数 | 说明 |
|------|------|
| `--json` | JSON 格式输出 |
| `--yaml` | YAML 格式输出 |
| `--session <name>` | 指定会话名称（默认 `default`） |
| `--cdp <endpoint>` | CDP 连接地址 |
| `-e, --eval <cmd>` | 执行命令（可多次使用） |
| `-h, --help` | 显示帮助 |
| `-v, --version` | 显示版本 |

### 会话管理

| 命令 | 说明 | 示例 |
|------|------|------|
| `session close` | 关闭当前会话 | `xbrowser session close` |
| `session close --session work` | 关闭指定会话 | `xbrowser session close --session work` |
| `session close --all` | 关闭所有会话 | `xbrowser session close --all` |
| `session list` | 列出所有活跃会话 | `xbrowser session list` |
| `session kill [--session <n>]` | 强制终止会话 | `xbrowser session kill --session work` |

### 页面导航

| 命令 | 说明 | 示例 |
|------|------|------|
| `goto <url>` / `open <url>` | 导航到指定 URL | `xbrowser goto https://example.com` |
| `goto <url> --waitUntil networkidle` | 指定等待条件 | `xbrowser goto https://example.com --waitUntil networkidle` |
| `back` | 浏览器后退 | `xbrowser back` |
| `forward` | 浏览器前进 | `xbrowser forward` |
| `refresh` | 刷新当前页面 | `xbrowser refresh` |
| `title` | 获取页面标题 | `xbrowser title` |
| `url` | 获取当前 URL | `xbrowser url` |

`goto` 的 `--waitUntil` 可选值：`load`、`domcontentloaded`（默认）、`networkidle`。

### 元素交互

| 命令 | 说明 | 示例 |
|------|------|------|
| `click <selector>` | 点击元素 | `xbrowser click "#btn"` |
| `click <selector> --button right` | 右键点击 | `xbrowser click "#btn" --button right` |
| `click <selector> --clickCount 2` | 多次点击 | `xbrowser click "#btn" --clickCount 2` |
| `fill <selector> <value>` | 填写输入框（清空后输入） | `xbrowser fill "#input" "hello"` |
| `type <selector> <text>` | 逐字输入文本 | `xbrowser type "#search" "关键词"` |
| `type <selector> <text> --delay 50` | 按键间隔 50ms | `xbrowser type "#search" "关键词" --delay 50` |
| `press <selector> <key>` | 按下按键 | `xbrowser press body Enter` |
| `select <selector> <value>` | 选择下拉选项 | `xbrowser select "#dropdown" "option1"` |
| `check <selector>` | 勾选复选框 | `xbrowser check "#agree"` |
| `hover <selector>` | 鼠标悬停 | `xbrowser hover "#menu"` |
| `dblclick <selector>` | 双击元素 | `xbrowser dblclick "#item"` |

**选择器语法**：支持 CSS 选择器（`#id`、`.class`、`div > p`）和文本选择器（`text=登录`）。

### 鼠标控制

| 命令 | 说明 | 示例 |
|------|------|------|
| `mouse move <x> <y>` | 移动鼠标到坐标 | `xbrowser "mouse move 100 200"` |
| `mouse move <x> <y> --steps 10` | 分步移动 | `xbrowser "mouse move 100 200 --steps 10"` |
| `mouse click <x> <y>` | 在坐标处点击 | `xbrowser "mouse click 100 200"` |
| `mouse click <x> <y> --button right` | 右键点击坐标 | `xbrowser "mouse click 100 200 --button right"` |
| `mouse dblclick <x> <y>` | 在坐标处双击 | `xbrowser "mouse dblclick 100 200"` |

### 滚动

| 命令 | 说明 | 示例 |
|------|------|------|
| `scroll down` | 向下滚动（默认 500px） | `xbrowser scroll down` |
| `scroll up` | 向上滚动 | `xbrowser scroll up` |
| `scroll left` | 向左滚动 | `xbrowser scroll left` |
| `scroll right` | 向右滚动 | `xbrowser scroll right` |
| `scroll down --distance 1000` | 自定义距离 | `xbrowser scroll down --distance 1000` |
| `scroll down --selector "#container"` | 滚动指定元素 | `xbrowser scroll down --selector "#container"` |

### 等待

| 命令 | 说明 | 示例 |
|------|------|------|
| `wait <selector>` | 等待元素出现（默认 30s） | `xbrowser wait "#content"` |
| `wait <selector> --timeout 5000` | 自定义超时 | `xbrowser wait "#content" --timeout 5000` |
| `wait <selector> --state hidden` | 等待元素消失 | `xbrowser wait "#loading" --state hidden` |
| `waitForTimeout <ms>` | 等待指定时间 | `xbrowser waitForTimeout 2000` |

`wait` 的 `--state` 可选值：`visible`（默认）、`hidden`、`attached`、`detached`。

### 页面查询

| 命令 | 说明 | 示例 |
|------|------|------|
| `html` | 获取页面 HTML | `xbrowser html` |
| `html --selector "#main"` | 获取指定元素 HTML | `xbrowser html --selector "#main"` |
| `text` | 获取页面文本 | `xbrowser text` |
| `text --selector "#article"` | 获取指定元素文本 | `xbrowser text --selector "#article"` |
| `eval "expression"` | 执行 JS 获取元素属性 | `xbrowser eval "document.querySelector('#link').href"` |

### 截图与快照

| 命令 | 说明 | 示例 |
|------|------|------|
| `screenshot` | 截取页面截图 | `xbrowser screenshot` |
| `screenshot --full-page` | 全页截图 | `xbrowser screenshot --full-page` |
| `screenshot --type jpeg` | 指定格式 | `xbrowser screenshot --type jpeg` |
| `snapshot` | 获取可操作交互元素 `@ref` 快照 | `xbrowser snapshot` |
| `snapshot --type aria` | 获取页面大纲 / accessibility tree | `xbrowser snapshot --type aria` |

### DOM 结构

| 命令 | 说明 | 示例 |
|------|------|------|
| `structure` | 获取 DOM 树（默认 5 层） | `xbrowser structure` |
| `structure --depth 3` | 自定义深度 | `xbrowser structure --depth 3` |
| `structure --selector "#nav"` | 从指定元素开始 | `xbrowser structure --selector "#nav"` |

### 执行 JavaScript

| 命令 | 说明 | 示例 |
|------|------|------|
| `eval <expression>` | 执行 JS 表达式 | `xbrowser eval "document.title"` |
| `eval "1 + 2"` | 计算表达式 | `xbrowser eval "1 + 2"` |

### 存储

| 命令 | 说明 | 示例 |
|------|------|------|
| `get-cookies` | 获取所有 Cookie | `xbrowser get-cookies` |
| `set-cookie <name> <value>` | 设置 Cookie | `xbrowser set-cookie session abc123` |
| `set-cookie <name> <value> --domain .example.com` | 指定域名 | `xbrowser set-cookie session abc123 --domain .example.com` |
| `clear-cookies` | 清除所有 Cookie | `xbrowser clear-cookies` |
| `get-local-storage` | 获取所有 localStorage | `xbrowser get-local-storage` |
| `get-local-storage --key token` | 获取指定 key | `xbrowser get-local-storage --key token` |
| `set-local-storage <key> <value>` | 设置 localStorage | `xbrowser set-local-storage token "abc"` |
| `clear-local-storage` | 清除 localStorage | `xbrowser clear-local-storage` |

### 帧操作

| 命令 | 说明 | 示例 |
|------|------|------|
| `frames` | 列出所有 iframe | `xbrowser frames` |
| `frame --index 0` | 切换到指定索引的帧 | `xbrowser frame --index 0` |
| `frame --name iframe-name` | 切换到指定名称的帧 | `xbrowser frame --name content` |

### 视口控制

| 命令 | 说明 | 示例 |
|------|------|------|
| `set-viewport <width> <height>` | 设置视口大小 | `xbrowser set-viewport 1920 1080` |
| `set-viewport 375 812 --isMobile true` | 移动设备模式 | `xbrowser set-viewport 375 812 --isMobile true` |

### 配置管理

| 命令 | 说明 | 示例 |
|------|------|------|
| `config list` | 列出所有配置 | `xbrowser config list` |
| `config get <key>` | 获取配置值 | `xbrowser config get browser.executablePath` |
| `config set <key> <value>` | 设置配置值 | `xbrowser config set browser.executablePath /usr/bin/chromium` |

配置文件位置：`~/.xbrowser/config.json`

### 录制与回放

| 命令 | 说明 | 示例 |
|------|------|------|
| `record start --url <url>` | 开始录制 | `xbrowser record start --url https://example.com` |
| `record stop --output recording.yaml` | 停止并保存 | `xbrowser record stop --output recording.yaml` |
| `record status` | 查看录制状态 | `xbrowser record status` |
| `replay <file>` | 回放录制 | `xbrowser replay recording.yaml` |
| `replay <file> --slow-mo 100` | 慢速回放 | `xbrowser replay recording.yaml --slow-mo 100` |

### 录制后处理

| 命令 | 说明 | 示例 |
|------|------|------|
| `convert <rec.yaml> <output.py>` | 转换为 Python + Playwright 脚本 | `xbrowser convert recording.yaml replay.py` |
| `extract <rec.yaml>` | 提取 LLM 摘要 | `xbrowser extract recording.yaml` |
| `filter <in.yaml> <out.yaml>` | 过滤录制事件 | `xbrowser filter raw.yaml clean.yaml` |
| `filter <in.yaml> <out.yaml> --exclude scroll,navigation` | 排除事件类型 | `xbrowser filter raw.yaml clean.yaml --exclude scroll,navigation` |

### 插件管理

| 命令 | 说明 | 示例 |
|------|------|------|
| `plugin search <query>` | 搜索 npm 上的插件 | `xbrowser plugin search scraper` |
| `plugin search <query> --tag <tag>` | 按标签搜索 | `xbrowser plugin search ecommerce --tag scraper` |
| `plugin search <query> --site <site>` | 按站点搜索 | `xbrowser plugin search amazon --site amazon.com` |
| `plugin install <path>` | 安装插件 | `xbrowser plugin install xbrowser-plugin-scraper` |
| `plugin install <path> --name my-plugin` | 指定名称安装 | `xbrowser plugin install ./my-plugin --name my-plugin` |
| `plugin install <path> --force` | 强制重新安装 | `xbrowser plugin install ./my-plugin --force` |
| `plugin uninstall <name>` | 卸载插件 | `xbrowser plugin uninstall my-plugin` |
| `plugin list` | 列出已安装插件 | `xbrowser plugin list` |
| `plugin list --json` | JSON 格式输出 | `xbrowser plugin list --json` |
| `plugin reload <name>` | 重新加载插件 | `xbrowser plugin reload my-plugin` |

**插件搜索**：

使用 `xbrowser plugin search` 在 npm registry 中搜索 xbrowser 兼容插件：

```bash
# 搜索所有插件
xbrowser plugin search

# 按关键词搜索
xbrowser plugin search scraper

# 按标签过滤
xbrowser plugin search --tag ecommerce

# 按站点过滤
xbrowser plugin search --site amazon.com

# 组合搜索
xbrowser plugin search scraper --tag data-extraction --limit 10
```

搜索结果会显示插件名称、描述、版本、作者、标签、主页和 npm 链接。

### 创建插件

```bash
# 从模板创建
xbrowser create my-plugin --template static
xbrowser create my-plugin --template dynamic
xbrowser create my-plugin --template login
xbrowser create my-plugin --template api

# 强制覆盖已有目录
xbrowser create my-plugin --template static --force
```

可用模板：

| 模板 | 说明 | 适用场景 |
|------|------|----------|
| `static` | 静态页面采集插件 | 简单页面数据提取 |
| `dynamic` | 动态交互插件 | 导航 + 交互的复杂场景 |
| `login` | 带登录/登出的插件 | 需要登录才能访问的站点 |
| `api` | API 集成插件 | 调用外部 API |

## 命令链语法

命令链是 xbrowser 的核心特性，允许在一行中串联多个命令：

| 分隔符 | 语义 | 示例 |
|--------|------|------|
| `&&` | 前一步成功才继续 | `goto https://example.com && title && screenshot` |
| `,` | 顺序执行 | `goto https://example.com , title , text` |
| `+` | 顺序执行 | `goto https://example.com + title + screenshot` |
| `->` | 顺序执行 | `goto https://example.com -> title -> click '#btn'` |
| `;` | 分割管线（前一个完成后开始下一个） | `goto https://example.com ; goto https://other.com` |
| `\|\|` | 前一步成功则跳过后续 | `goto https://example.com \|\| goto https://fallback.com` |

**注意**：
- 命令链中如果包含特殊字符（如 `#`、`>`），需要用引号包裹整个命令链或对单个参数加引号。
- `,`、`+`、`->`、`&&`、`||` 两边都要有空格（`goto url -> title` ✅，`goto url->title` ❌）；`;` 前后的空格可有可无（`goto url; title` ✅，`goto url;title` ✅），`;` 后面跟的不是命令时它只是普通字符（`goto https://example.com/a;b=1` 整串是一个 URL）。
- 只在分隔符前面留空格（如 `title ,url`）不会被识别成命令链：整串按单条命令执行，后面的命令被静默忽略。
- 值以 `-` 开头时，用 `--` 把它和选项隔开（负数不需要）：`xbrowser fill -- '#q' '- item'`。`--` 之后的一切都是字面量，`--session` 这类全局选项要写在 `--` 之前。

```bash
# 正确 — 整体引号
xbrowser "goto https://example.com , click '#btn'"

# 正确 — 参数引号
xbrowser goto https://example.com , click '#btn'

# 错误 — # 在 shell 中是注释
xbrowser goto https://example.com , click #btn
```

## Scope 体系

xbrowser 使用四级 Scope 控制命令的执行上下文：

```
project > browser > page > element
```

| Scope | 说明 | 需要的条件 | 典型命令 |
|-------|------|------------|----------|
| **project** | 项目级别 | 无 | config, daemon, plugin |
| **browser** | 浏览器级别 | 浏览器实例 | set-viewport, session |
| **page** | 页面级别 | 活跃页面 | goto, wait, scroll, screenshot |
| **element** | 元素级别 | 页面中的元素 | click, fill, type, hover |

命令执行前会自动检查 Scope 是否满足。不满足时会提示：

```
Error: 需要活跃的页面，请先执行 xbrowser goto <url>
```

## MCP Server（AI Agent 接入）

xbrowser 内置 Model Context Protocol 服务器——让 Claude Desktop / Cursor / 任何 MCP 客户端直接使用浏览器能力：

```bash
# 注册到 Claude Code
claude mcp add xbrowser -- xbrowser mcp

# 或手动配置（stdio）：command: xbrowser, args: ["mcp"]
```

7 个工具：`browser_navigate` / `browser_act` / `browser_read` / `browser_snapshot`（accessibility tree，token 友好）/ `browser_screenshot` / `browser_network` / `browser_replay`（自愈回放）。协议冒烟：`node scripts/mcp-smoke.mjs`。

## 插件系统

### 插件加载顺序

xbrowser 按以下顺序扫描插件目录：

1. `./.xcli/plugins/` — 当前目录
2. `../.xcli/plugins/` — 父目录
3. `~/.xcli/plugins/` — 用户全局目录
4. `~/.xbrowser/plugins/` — xbrowser 专属全局目录

同名插件：本地优先于全局，后加载覆盖先加载。

### 插件结构

```
.xcli/plugins/<plugin-name>/
├── index.ts          # 插件入口（必须）
├── package.json      # 包配置（必须，至少含 name）
└── README.md         # 说明文档（推荐）
```

### 插件入口示例

```typescript
import { z } from 'zod';
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'my-plugin',
    url: 'https://example.com',
    description: '我的第一个插件',
    requiresLogin: false,
  });

  site.command('scrape', {
    description: '采集页面数据',
    scope: 'browser',
    parameters: z.object({
      selector: z.string().optional().default('body'),
    }),
    examples: [
      { cmd: 'xbrowser my-plugin scrape', description: '采集页面内容' },
    ],
    handler: async (params, ctx) => {
      const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
      if (!page) throw new Error('需要浏览器页面');

      const text = await page.evaluate(
        (sel: string) => document.querySelector(sel)?.textContent ?? '',
        params.selector
      );

      return {
        data: { text },
        tips: ['采集完成'],
      };
    },
  });

  // 可选：登录/登出
  site.login(async (ctx) => {
    const page = (ctx as Record<string, unknown>).page as import('playwright').Page;
    if (!page) return;
    await page.goto('https://example.com/login');
    await page.fill('#username', 'user');
    await page.fill('#password', 'pass');
    await page.click('#submit');
    await ctx.storage.set('auth_token', { loggedIn: true, at: Date.now() });
  });

  site.logout(async (ctx) => {
    await ctx.storage.delete('auth_token');
  });
}
```

### 常用插件

插件不随 npm 包分发，按需安装：`xbrowser plugin install <name>`（npm 优先，未命中时回退 xbrowser.dev 市场）。几个例子：

| 插件 | 命令 | 说明 |
|------|------|------|
| **baidu** | `search`, `hotsearch`, `suggest`, `news` | 百度搜索、热搜、建议词、新闻 |
| **douyin** | `videos`, `profile`, `detail`, `comments`, `search`, `download`, `ai-subtitle` | 抖音数据采集：作品、资料、评论、下载、AI 字幕 |
| **github** | `update-profile`, `add-social-link`, `create-gist`, `get-profile`, `create-repo`, `edit-readme` | GitHub 个人资料与仓库管理 |
| **content** | `cases`, `draft`, `cover` | 内容营销：内置推广 case 渲染成文 + 浏览器自渲染封面 |

使用插件命令：

```bash
# 安装并使用百度搜索插件
xbrowser plugin install baidu
xbrowser goto https://www.baidu.com
xbrowser baidu search --query "AI 编程"

# 百度热搜
xbrowser baidu hotsearch

# GitHub 资料获取
xbrowser goto https://github.com
xbrowser github get-profile
```

## 录制与回放

### 录制

```bash
# 1. 打开会话（自动创建）
xbrowser goto https://example.com

# 2. 开始录制
xbrowser record start --url https://example.com

# 3. 在浏览器中手动操作...

# 4. 停止录制，保存为 YAML
xbrowser record stop --output recordings/my-session.yaml
```

录制文件格式（YAML）——由 `xbrowser record stop` 生成，下面是删减后的真实样例：

```yaml
startUrl: https://example.com
sessionName: my-session
startedAt: "2026-11-23T14:36:13.891Z"
actions:
  - id: 1
    type: navigation
    timestamp: 1795444573943
    url: https://example.com
    pageTitle: Example Domain
  - id: 2
    type: cdp-fill # 经 CLI 下发的 fill；页面里的手动操作记为 input / click
    timestamp: 1795444586890
    url: https://example.com
    element:
      tag: input
      selector: "#name"
      strategy: id
      confidence: high
    value: Alice
    snapshots:
      png: .tmp/snapshots/step-002-after.png
      aria: "input: | button: Submit"
  - id: 3
    type: click
    timestamp: 1795444589184
    url: https://example.com
    element:
      tag: button
      selector: "#submit"
      strategy: id
      confidence: high
    x: 224.4
    y: 119.4
network: [] # 每个请求一条：method / url / status / resourceType
contextChanges: [] # 导航、弹窗等上下文变化
```

### 回放

```bash
# 正常速度回放
xbrowser replay recordings/my-session.yaml

# 慢速回放（每步间隔 100ms）
xbrowser replay recordings/my-session.yaml --slow-mo 100
```

### 转换为脚本

录制文件可转换为三种独立运行的脚本，回放的步骤相同：

```bash
# Python + Playwright
xbrowser convert recordings/my-session.yaml replay.py
python3 replay.py   # 需要 pip install playwright && playwright install chromium

# Node.js + Playwright
xbrowser convert recordings/my-session.yaml replay.js
node replay.js      # 需要 npm install playwright && npx playwright install chromium

# Bash：通过 xbrowser CLI 在同一个会话里回放，任何一步失败都会停止并关闭会话
xbrowser convert recordings/my-session.yaml replay.sh
bash replay.sh
```

JS / Python 脚本设置 `XBROWSER_CHROMIUM_PATH` 可以直接复用已安装的 Chrome / Chromium，不必再下载 Playwright 自带的浏览器。

转换时会把录制归一化成真正的操作步骤：同一个动作在录制里留下的多条记录（命令与页面信号各记一次、`fill` 的聚焦点击、由点击引起的跳转、滚动信号的命令回显）都只算一步。

### 提取摘要

```bash
# 分析录制文件，提取关键操作
xbrowser extract recordings/my-session.yaml
```

输出示例：

```
Analysis Results:
  Start URL: https://example.com
  Total events: 42
  Key events: 8

Event type stats:
  click: 5
  input: 2
  keydown: 1

Key operations:
  1. click -> #search-box
  2. input -> #search-box
  3. keydown -> Enter
  4. click -> .result-item
  ...
```

### 过滤事件

```bash
# 排除滚动事件
xbrowser filter raw.yaml clean.yaml --exclude scroll

# 排除滚动和导航事件
xbrowser filter raw.yaml clean.yaml --exclude scroll,navigation
```

## 配置

### 环境变量

所有环境变量使用 `XBROWSER_` 前缀：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `XBROWSER_CHROMIUM_PATH` | Chromium 可执行文件路径 | `/Applications/Chromium.app/Contents/MacOS/Chromium` |
| `XBROWSER_DAEMON_PORT` | Daemon 端口 | `9224` |
| `XBROWSER_CDP` | 默认 CDP 连接地址（可被 `--cdp` 覆盖） | — |
| `XBROWSER_SESSION` | 默认会话名称（可被 `--session` 覆盖） | `default` |

### 命令行配置

```bash
xbrowser config list
xbrowser config get browser.executablePath
xbrowser config set browser.executablePath /usr/bin/chromium
```

配置文件位置：`~/.xbrowser/config.json`

## 程序化 API

xbrowser 可以作为 Node.js 库使用：

```typescript
import {
  executeCommand,
  executeChain,
  openSession,
  closeSession,
  registerCommand,
} from '@xbrowser/cli';
```

### 执行单条命令

```typescript
import { openSession, executeCommand, closeAllBrowserSessions } from '@xbrowser/cli';

// 创建会话
await openSession('default', 'https://example.com');

// 执行命令
const result = await executeCommand('title', {}, 'default');
console.log(result);
// { success: true, data: { ok: true, title: 'Example Domain' }, duration: 42 }

// 清理
await closeAllBrowserSessions();
```

### 执行命令链

```typescript
import { executeChain } from '@xbrowser/cli';

const result = await executeChain('goto https://example.com && title && screenshot');
console.log(result.success);   // true
console.log(result.steps);     // [{ command: 'goto', success: true, ... }, ...]
console.log(result.totalDuration); // 1523
```

### 自定义命令

```typescript
import { registerCommand } from '@xbrowser/cli';
import { z } from 'zod';

registerCommand({
  name: 'countLinks',
  description: 'Count all links on page',
  scope: 'page',
  handler: async (_params, ctx) => {
    const count = await ctx.page.evaluate(() => document.querySelectorAll('a').length);
    return { ok: true, count };
  },
});
```

完整 API 文档见 [docs/api.md](docs/api.md)。

## 实战示例

### 示例 1：采集搜索结果

```bash
xbrowser "goto https://www.baidu.com/s?wd=playwright , html --selector '#content_left'"
```

### 示例 2：登录 + 操作

```bash
xbrowser <<EOF
goto https://example.com/login
fill "#username" "myuser"
fill "#password" "mypass"
click "#submit"
wait ".dashboard"
screenshot --full-page
EOF
```

### 示例 3：多页采集

```bash
xbrowser <<EOF
goto https://example.com/list
text --selector ".items"
scroll down
wait ".items .item:nth-child(20)"
text --selector ".items"
EOF
```

### 示例 4：连接远程浏览器

```bash
# 在远程机器启动 Chrome
google-chrome --remote-debugging-port=9222

# 本地连接并操作
xbrowser --cdp 9222 "goto https://example.com , title , screenshot"
```

### 示例 5：批量截图

```bash
for url in https://example.com https://github.com https://npmjs.com; do
  xbrowser "goto $url , screenshot --full-page"
done
```

### 示例 6：使用插件采集百度热搜

```bash
xbrowser goto https://www.baidu.com
xbrowser baidu hotsearch --category tech
xbrowser session close
```

## 开发

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 构建
npm run build

# 类型检查
npm run typecheck

# 代码检查
npm run lint

# 运行测试
npm test

# 完整验证
npm run validate
```

## 技术栈

| 依赖 | 用途 |
|------|------|
| **@dyyz1993/xcli-core** | CLI 框架核心（命令注册、Scope、输出格式化、插件加载） |
| **ws** | CDP WebSocket 连接（浏览器驱动是自研的 `src/cdp-driver/`，不依赖 Playwright） |
| **zod** | 参数校验 Schema |
| **yaml** | 录制文件读写 |

## 项目结构

```
xbrowser/
├── src/
│   ├── commands/        # 59 个浏览器命令定义
│   ├── builtins/        # CLI 内置命令（config, plugin, session, create）
│   ├── recorder/        # 录制引擎（录制器 + 回放器）
│   ├── session/         # 会话管理
│   ├── plugin/          # 插件加载器 + 安装器
│   ├── daemon/          # 守护进程管理
│   ├── cli/             # CLI 路由与输出
│   ├── router.ts        # 命令路由
│   ├── executor.ts      # 命令执行器
│   ├── chain-parser.ts  # 命令链解析器
│   ├── browser.ts       # 浏览器管理（启动、CDP 连接）
│   ├── cdp-driver/      # 自研 CDP 驱动（连接、输入、定位器，不依赖 Playwright）
│   ├── context.ts       # 命令上下文（BrowserCommandContext）
│   ├── scope.ts         # Scope 定义
│   └── config.ts        # 配置管理
├── bin/
│   └── cli.ts           # CLI 入口
├── .xcli/plugins/       # 站点插件（126 个）
├── tests/               # 测试
└── docs/                # 文档
```

## xbrowser vs Other Browser Automation Tools

| Feature | xbrowser | Playwright | Puppeteer | Selenium |
|---------|----------|------------|-----------|----------|
| **Interface** | CLI (command line) | Node.js library | Node.js library | Multi-language library |
| **Setup** | `npm i -g` — 0 config | Install + browser download | Install + browser download | Install + WebDriver + drivers |
| **Web Scraping** | Built-in (`scrape`, `crawl`, `map`) | Write custom scripts | Write custom scripts | Write custom scripts |
| **Search** | Built-in multi-engine (`search`) | No | No | No |
| **Plugin Ecosystem** | 126 plugins | Limited | Limited | No |
| **No Code Required** | ✅ CLI commands | ❌ Must write JS/TS | ❌ Must write JS/TS | ❌ Must write code |
| **Headless Mode** | ✅ Default | ✅ | ✅ | ✅ |
| **Record/Replay** | ✅ Built-in (`record`/`replay`) | ✅ Codegen | ❌ | ❌ |
| **Anti-Detection** | ✅ CDP firewall | ❌ | ❌ | ❌ |
| **AI Agent Integration** | ✅ Built-in MCP server + plugins | Manual integration | Manual integration | Manual integration |

**When to use xbrowser:**
- You want to **automate browsers from the command line** without writing code
- You need **web scraping, SEO automation, or AI agent workflows**
- You want a **Playwright/Puppeteer alternative** that works with one-liners
- You're building **CLI tools that need browser automation**

**When to use Playwright/Puppeteer:**
- You're writing **test suites** for web applications
- You need **fine-grained programmatic control** of browser behavior
- You're building a **Node.js application** that embeds browser automation

## 与相关项目的关系

| 项目 | 定位 | 关系 |
|------|------|------|
| **@dyyz1993/xcli-core** | 通用 CLI 框架 | xbrowser 依赖的核心框架 |
| **@dyyz1993/xpage (mpage)** | 浏览器自动化引擎 | 独立项目，xbrowser **不依赖** mpage |
| **xbrowser** | 浏览器自动化 CLI | 自包含，自带 CDP 驱动（不依赖 Playwright） |

## 🔑 Keywords

`browser automation` `web scraping` `playwright alternative` `puppeteer alternative` `selenium alternative` `web crawler` `headless browser` `CLI tool` `command line` `scrape` `crawl` `anti-detection` `CDP` `record replay` `SEO tool` `AI agent` `browser plugin`

## 许可证

MIT
