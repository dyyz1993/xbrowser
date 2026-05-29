# xbrowser

> **Browser automation CLI** for web scraping, headless browsing, SEO analysis, and AI agent workflows. 35+ commands, 67+ plugins. A command-line alternative to Playwright, Puppeteer, and Selenium — **no code required**.

[![CI Status](https://github.com/dyyz1993/xbrowser/workflows/CI/badge.svg)](https://github.com/dyyz1993/xbrowser/actions)
[![codecov](https://codecov.io/gh/dyyz1993/xbrowser/branch/master/graph/badge.svg)](https://codecov.io/gh/dyyz1993/xbrowser)
[![npm version](https://img.shields.io/npm/v/@xbrowser/cli.svg)](https://www.npmjs.com/package/@xbrowser/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 特性

- **35+ 浏览器命令** — 导航、交互、查询、存储、截图，覆盖常见自动化场景
- **命令链** — 用 `&&`、`,`、`+`、`->`、`;` 串联多个命令，一行搞定复杂流程
- **管道 & Heredoc** — 支持 stdin 管道和 heredoc 批量执行
- **录制 / 回放** — 录制浏览器操作为 YAML，随时回放，可转换为 JS/Python/Bash 脚本
- **插件系统** — 基于 `@dyyz1993/xcli-core`，用 TypeScript 编写站点插件
- **CDP 连接** — 连接已运行的 Chrome/Chromium，无需重新启动浏览器
- **会话管理** — 多会话并行，独立上下文
- **Daemon 模式** — 后台常驻，快速响应

## Use Cases

**Web Scraping & Data Extraction**
```bash
# Scrape any page to Markdown — no Playwright scripts needed
xbrowser scrape https://news.ycombinator.com --mode smart --output markdown

# Crawl an entire site
xbrowser crawl https://example.com --max-depth 3 --output json
```

**Search Engine Automation**
```bash
# Search Google, Bing, Baidu from the command line
xbrowser search "best headless browser CLI" --engine google --limit 10 --json

# Time-filtered search
xbrowser search "playwright alternative 2025" --engine bing --time-filter month
```

**Browser Automation for AI Agents**
```bash
# Record browser actions, replay in CI/CD
xbrowser record --output workflow.yaml
xbrowser replay workflow.yaml

# Chain commands for complex workflows
xbrowser "goto https://example.com && wait .content && text --selector .content"
```

**SEO & Backlink Automation**
```bash
# Auto-publish articles to 13+ SEO platforms
xbrowser publish --platform devto,juejin --file article.md
```

## 快速开始

### 安装

```bash
npm install -g @xbrowser/cli
```

### 最低要求

- Node.js >= 18
- Chromium 浏览器（默认路径 `/Applications/Chromium.app/Contents/MacOS/Chromium`，可通过环境变量 `XBROWSER_CHROMIUM_PATH` 自定义）

### 第一次使用

```bash
# 打开浏览器，导航到页面
xbrowser session open https://example.com

# 获取页面标题
xbrowser title
# 输出: Example Domain

# 获取页面文本
xbrowser text

# 截图（保存到当前目录）
xbrowser screenshot

# 关闭会话
xbrowser session close
```

### 单行命令链

不需要先 `session open`，命令链会自动启动浏览器并在执行完毕后关闭：

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
# 通过 WebSocket URL 连接
xbrowser --cdp ws://localhost:9222 "goto https://example.com , title"

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
| `session open <url>` | 打开浏览器并创建会话 | `xbrowser session open https://example.com` |
| `session open <url> --name work` | 以指定名称创建会话 | `xbrowser session open https://example.com --name work` |
| `session close` | 关闭当前会话 | `xbrowser session close` |
| `session close --name work` | 关闭指定会话 | `xbrowser session close --name work` |
| `session close --all` | 关闭所有会话 | `xbrowser session close --all` |
| `session list` | 列出所有活跃会话 | `xbrowser session list` |
| `session kill [--name <n>]` | 强制终止会话 | `xbrowser session kill --name work` |

### 页面导航

| 命令 | 说明 | 示例 |
|------|------|------|
| `goto <url>` | 导航到指定 URL | `xbrowser goto https://example.com` |
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
| `getProperty <selector> <property>` | 获取元素属性 | `xbrowser getProperty "#link" href` |

### 截图与快照

| 命令 | 说明 | 示例 |
|------|------|------|
| `screenshot` | 截取页面截图 | `xbrowser screenshot` |
| `screenshot --full-page` | 全页截图 | `xbrowser screenshot --full-page` |
| `screenshot --type jpeg` | 指定格式 | `xbrowser screenshot --type jpeg` |
| `snapshot` | 获取页面元素快照（Accessibility tree） | `xbrowser snapshot` |
| `snapshot --interactive-only` | 仅交互元素 | `xbrowser snapshot --interactive-only` |

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
| `evaluateFn <fn> --args 1 2` | 执行带参数的函数 | `xbrowser evaluateFn "return args[0] + args[1]" --args 1 2` |

### 存储

| 命令 | 说明 | 示例 |
|------|------|------|
| `getCookies` | 获取所有 Cookie | `xbrowser getCookies` |
| `setCookie <name> <value>` | 设置 Cookie | `xbrowser setCookie session abc123` |
| `setCookie <name> <value> --domain .example.com` | 指定域名 | `xbrowser setCookie session abc123 --domain .example.com` |
| `clearCookies` | 清除所有 Cookie | `xbrowser clearCookies` |
| `getLocalStorage` | 获取所有 localStorage | `xbrowser getLocalStorage` |
| `getLocalStorage --key token` | 获取指定 key | `xbrowser getLocalStorage --key token` |
| `setLocalStorage <key> <value>` | 设置 localStorage | `xbrowser setLocalStorage token "abc"` |
| `clearLocalStorage` | 清除 localStorage | `xbrowser clearLocalStorage` |

### 帧操作

| 命令 | 说明 | 示例 |
|------|------|------|
| `frames` | 列出所有 iframe | `xbrowser frames` |
| `frame --index 0` | 切换到指定索引的帧 | `xbrowser frame --index 0` |
| `frame --name iframe-name` | 切换到指定名称的帧 | `xbrowser frame --name content` |

### 视口控制

| 命令 | 说明 | 示例 |
|------|------|------|
| `setViewport <width> <height>` | 设置视口大小 | `xbrowser setViewport 1920 1080` |
| `setViewport 375 812 --isMobile true` | 移动设备模式 | `xbrowser setViewport 375 812 --isMobile true` |

### Daemon 进程

| 命令 | 说明 | 示例 |
|------|------|------|
| `daemon start` | 启动 daemon | `xbrowser daemon start` |
| `daemon start --port 9223` | 指定端口启动 | `xbrowser daemon start --port 9223` |
| `daemon stop` | 停止 daemon | `xbrowser daemon stop` |
| `daemon status` | 查看 daemon 状态 | `xbrowser daemon status` |

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
| `convert <rec.yaml> <output>` | 转换录制为脚本 | `xbrowser convert recording.yaml out.js` |
| `convert <rec.yaml> <output.py>` | 生成 Python 脚本 | `xbrowser convert recording.yaml replay.py` |
| `convert <rec.yaml> <output.sh>` | 生成 Bash 脚本 | `xbrowser convert recording.yaml replay.sh` |
| `extract <rec.yaml>` | 提取 LLM 摘要 | `xbrowser extract recording.yaml` |
| `filter <in.yaml> <out.yaml>` | 过滤录制事件 | `xbrowser filter raw.yaml clean.yaml` |
| `filter <in.yaml> <out.yaml> --exclude scroll,navigate` | 排除事件类型 | `xbrowser filter raw.yaml clean.yaml --exclude scroll,navigate` |

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

**注意**：命令链中如果包含特殊字符（如 `#`、`>`），需要用引号包裹整个命令链或对单个参数加引号。

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
| **browser** | 浏览器级别 | 浏览器实例 | setViewport, session |
| **page** | 页面级别 | 活跃页面 | goto, wait, scroll, screenshot |
| **element** | 元素级别 | 页面中的元素 | click, fill, type, hover |

命令执行前会自动检查 Scope 是否满足。不满足时会提示：

```
Error: 需要活跃的页面，请先执行 xbrowser session open <url>
```

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

### 内置插件

xbrowser 自带以下插件：

| 插件 | 命令 | 说明 |
|------|------|------|
| **baidu** | `search`, `hotsearch`, `suggest`, `news` | 百度搜索、热搜、建议词、新闻 |
| **douyin** | `ai-summary`, `user-info`, `video-info` | 抖音视频信息提取 |
| **github** | `update-profile`, `add-social-link`, `create-gist`, `get-profile` | GitHub 个人资料管理 |
| **web-automation** | `extract`, `paginate`, `fill-and-submit`, `screenshot` | 通用 Web 自动化工具 |

使用插件命令：

```bash
# 百度搜索
xbrowser session open https://www.baidu.com
xbrowser baidu search --query "AI 编程"

# 百度热搜
xbrowser baidu hotsearch

# GitHub 资料获取
xbrowser session open https://github.com
xbrowser github get-profile
```

## 录制与回放

### 录制

```bash
# 1. 打开会话
xbrowser session open https://example.com

# 2. 开始录制
xbrowser record start --url https://example.com

# 3. 在浏览器中手动操作...

# 4. 停止录制，保存为 YAML
xbrowser record stop --output recordings/my-session.yaml
```

录制文件格式（YAML）：

```yaml
id: "abc-123"
name: "my-session"
startUrl: "https://example.com"
startTime: "2025-01-01T00:00:00.000Z"
duration: 15000
events:
  - type: click
    selector: "#button"
    tagName: "button"
    timestamp: 1000
    pageState:
      url: "https://example.com"
      title: "Example"
  - type: input
    selector: "#search"
    data:
      value: "hello world"
    timestamp: 3000
  - type: scroll
    data:
      x: 0
      y: 500
    timestamp: 5000
```

### 回放

```bash
# 正常速度回放
xbrowser replay recordings/my-session.yaml

# 慢速回放（每步间隔 100ms）
xbrowser replay recordings/my-session.yaml --slow-mo 100
```

### 转换为脚本

录制文件可转换为独立的 JS/Python/Bash 脚本：

```bash
# 生成 Node.js + Playwright 脚本
xbrowser convert recordings/my-session.yaml replay.js
node replay.js

# 生成 Python + Playwright 脚本
xbrowser convert recordings/my-session.yaml replay.py
python3 replay.py

# 生成 Bash + curl 脚本（基于 CDP）
xbrowser convert recordings/my-session.yaml replay.sh
bash replay.sh
```

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
# 排除滚动和导航事件
xbrowser filter raw.yaml clean.yaml --exclude scroll,navigate,page_load

# 排除悬停事件
xbrowser filter raw.yaml clean.yaml --exclude hover_enter,hover_leave
```

## 配置

### 环境变量

所有环境变量使用 `XBROWSER_` 前缀：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `XBROWSER_CHROMIUM_PATH` | Chromium 可执行文件路径 | `/Applications/Chromium.app/Contents/MacOS/Chromium` |
| `XBROWSER_DAEMON_PORT` | Daemon 端口 | `9222` |

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
xbrowser session open https://www.baidu.com
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
| **playwright** | 浏览器自动化引擎（含 CDP 连接） |
| **zod** | 参数校验 Schema |
| **yaml** | 录制文件读写 |

## 项目结构

```
xbrowser/
├── src/
│   ├── commands/        # 35 个浏览器命令定义
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
│   ├── context.ts       # 命令上下文（BrowserCommandContext）
│   ├── scope.ts         # Scope 定义
│   └── config.ts        # 配置管理
├── bin/
│   └── cli.ts           # CLI 入口
├── .xcli/plugins/       # 内置插件（baidu, douyin, github, web-automation）
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
| **Plugin Ecosystem** | 67+ plugins | Limited | Limited | No |
| **No Code Required** | ✅ CLI commands | ❌ Must write JS/TS | ❌ Must write JS/TS | ❌ Must write code |
| **Headless Mode** | ✅ Default | ✅ | ✅ | ✅ |
| **Record/Replay** | ✅ Built-in (`record`/`replay`) | ✅ Codegen | ❌ | ❌ |
| **Anti-Detection** | ✅ CDP firewall | ❌ | ❌ | ❌ |
| **AI Agent Integration** | ✅ Built-in plugins | Manual integration | Manual integration | Manual integration |

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
| **xbrowser** | 浏览器自动化 CLI | 自包含，直接使用 Playwright |

## 🔑 Keywords

`browser automation` `web scraping` `playwright alternative` `puppeteer alternative` `selenium alternative` `web crawler` `headless browser` `CLI tool` `command line` `scrape` `crawl` `anti-detection` `CDP` `record replay` `SEO tool` `AI agent` `browser plugin`

## 许可证

MIT
