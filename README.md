# xbrowser

基于 `@dyyz1993/xcli-core` 构建的浏览器自动化 CLI 工具，提供完整的浏览器控制、插件扩展、录制回放能力。

## 安装

```bash
npm install -g xbrowser
```

全局安装后即可在终端直接使用 `xbrowser` 命令。也可在项目中本地安装：

```bash
npm install xbrowser
npx xbrowser --help
```

## 快速开始

### 启动浏览器会话

```bash
# 启动 daemon（后台浏览器进程）
xbrowser daemon start

# 打开浏览器会话
xbrowser session open https://example.com

# 查看活跃会话
xbrowser session list
```

### 执行浏览器操作

```bash
# 导航
xbrowser goto https://example.com/page

# 交互
xbrowser click "#button"
xbrowser fill "#input" "hello world"
xbrowser type "#search" "关键词" --delay 50
xbrowser press body Enter
xbrowser select "#dropdown" "option1"
xbrowser check "#checkbox"
xbrowser hover "#element"
xbrowser dblclick "#element"

# 等待
xbrowser wait "#content" --timeout 5000

# 滚动
xbrowser scroll down --distance 300
xbrowser scroll up
xbrowser scroll right --selector "#container"

# 截图
xbrowser screenshot --full-page

# 执行 JS
xbrowser eval "document.title"

# 视口控制
xbrowser config set browser.viewport.width 1920

# 关闭会话
xbrowser session close
```

## 所有命令

### 会话管理

| 命令 | 说明 |
|------|------|
| `session open <url> [--name <n>]` | 打开浏览器并创建会话 |
| `session close [--name <n>]` | 关闭指定会话 |
| `session close --all` | 关闭所有会话 |
| `session list` | 列出所有活跃会话 |
| `session kill [--name <n>]` | 强制终止会话 |

### 页面导航

| 命令 | 说明 |
|------|------|
| `goto <url>` | 导航到指定 URL |
| `back` | 浏览器后退 |
| `forward` | 浏览器前进 |
| `refresh` | 刷新当前页面 |
| `title` | 获取页面标题 |
| `url` | 获取当前页面 URL |

### 元素交互

| 命令 | 说明 |
|------|------|
| `click <selector>` | 点击元素 |
| `fill <selector> <value>` | 填写输入框 |
| `type <selector> <text>` | 逐字输入文本 |
| `press <selector> <key>` | 按下按键 |
| `select <selector> <value>` | 选择下拉选项 |
| `check <selector>` | 勾选复选框 |
| `hover <selector>` | 悬停在元素上 |
| `dblclick <selector>` | 双击元素 |

### 鼠标控制

| 命令 | 说明 |
|------|------|
| `mouse move <x> <y> [--steps N]` | 移动鼠标 |
| `mouse click <x> <y> [--button left/right/middle]` | 鼠标点击坐标 |
| `mouse dblclick <x> <y>` | 鼠标双击坐标 |

### 滚动

| 命令 | 说明 |
|------|------|
| `scroll <up/down/left/right> [--distance N]` | 滚动页面 |
| `scroll <direction> --selector <sel>` | 滚动指定元素 |

### 等待

| 命令 | 说明 |
|------|------|
| `wait <selector> [--timeout N] [--state visible/hidden]` | 等待元素出现 |
| `waitForTimeout <ms>` | 等待指定时间 |

### 页面查询

| 命令 | 说明 |
|------|------|
| `html [--selector <sel>]` | 获取 HTML 内容 |
| `text [--selector <sel>]` | 获取文本内容 |
| `getProperty <selector> <property>` | 获取元素属性 |

### 截图与快照

| 命令 | 说明 |
|------|------|
| `screenshot [--full-page] [--type png/jpeg]` | 截取页面截图 |
| `snapshot [--interactive-only]` | 获取页面元素快照 |

### DOM 结构

| 命令 | 说明 |
|------|------|
| `structure [--selector <sel>] [--depth N]` | 获取 DOM 树结构 |

### 存储

| 命令 | 说明 |
|------|------|
| `getCookies` | 获取所有 Cookie |
| `setCookie <name> <value>` | 设置 Cookie |
| `clearCookies` | 清除所有 Cookie |
| `getLocalStorage [--key <key>]` | 获取 localStorage |
| `setLocalStorage <key> <value>` | 设置 localStorage |
| `clearLocalStorage` | 清除 localStorage |

### 帧操作

| 命令 | 说明 |
|------|------|
| `frames` | 列出所有 iframe |
| `frame [--index N] [--name <name>]` | 切换到指定帧 |

### 执行 JavaScript

| 命令 | 说明 |
|------|------|
| `eval <expression>` | 执行 JS 表达式 |
| `evaluateFn <fn> [--args ...]` | 执行带参数的函数 |

### 视口控制

| 命令 | 说明 |
|------|------|
| `setViewport <width> <height>` | 设置视口大小 |

### Daemon 进程

| 命令 | 说明 |
|------|------|
| `daemon start [--port <port>]` | 启动 daemon 进程 |
| `daemon stop` | 停止 daemon 进程 |
| `daemon status` | 查看 daemon 状态 |

### 录制与回放

| 命令 | 说明 |
|------|------|
| `record start --url <url>` | 开始录制 |
| `record stop [--output <path>]` | 停止并保存录制 |
| `record status` | 查看录制状态 |
| `replay <file> [--slow-mo N]` | 回放录制 |

### 配置

| 命令 | 说明 |
|------|------|
| `config list` | 列出所有配置项 |
| `config get <key>` | 获取配置值 |
| `config set <key> <value>` | 设置配置值 |

## 插件系统

### 安装插件

```bash
# 从本地路径安装
xbrowser plugin install ./my-plugin --name my-plugin

# 强制重新安装
xbrowser plugin install ./my-plugin --name my-plugin --force

# 卸载插件
xbrowser plugin uninstall my-plugin

# 列出已安装插件
xbrowser plugin list

# 重新加载插件
xbrowser plugin reload my-plugin
```

### 创建插件

```bash
# 从模板创建
xbrowser create my-plugin --template static
xbrowser create my-plugin --template dynamic
xbrowser create my-plugin --template login
xbrowser create my-plugin --template api
```

可用模板：
- **static** — 静态页面采集插件
- **dynamic** — 动态交互插件（导航 + 交互）
- **login** — 带登录/登出功能的插件
- **api** — API 集成插件

### 插件结构

```
.xcli/plugins/<plugin-name>/
├── index.ts          # 插件入口（必须）
├── package.json      # 包配置（必须）
└── README.md         # 说明文档（推荐）
```

### 插件入口签名

```typescript
import type { XCLIAPI } from '@dyyz1993/xcli-core';

export default function (xcli: XCLIAPI): void {
  const site = xcli.createSite({
    name: 'my-plugin',
    url: 'https://example.com',
  });

  site.command('scrape', {
    description: '采集数据',
    scope: 'page',
    handler: async (params, ctx) => {
      const text = await ctx.page.evaluate(() => document.body.innerText);
      return { ok: true, text };
    },
  });
}
```

### 插件加载顺序

1. `./.xcli/plugins/` — 当前目录
2. `../.xcli/plugins/` — 父目录
3. `~/.xcli/plugins/` — 用户全局目录
4. `~/.xbrowser/plugins/` — xbrowser 全局目录

同名插件：本地优先于全局，后加载覆盖先加载。

## Scope 体系

xbrowser 使用四级 Scope 控制命令的执行上下文：

```
project > browser > page > element
```

| Scope | 说明 | 可用命令 |
|-------|------|----------|
| **project** | 项目级别，无需浏览器 | config, daemon, plugin |
| **browser** | 浏览器级别，需要浏览器实例 | setViewport, session |
| **page** | 页面级别，需要活跃页面 | goto, wait, scroll, screenshot |
| **element** | 元素级别，需要页面中的元素 | click, fill, type, hover |

命令执行前会自动检查 Scope 是否满足，不满足时提示用户先执行相应操作。

## 录制与回放

### 录制浏览器操作

```bash
# 1. 打开会话
xbrowser session open https://example.com

# 2. 开始录制
xbrowser record start --url https://example.com

# 3. 在浏览器中操作...

# 4. 停止录制
xbrowser record stop --output recordings/my-session.yaml
```

### 回放录制

```bash
# 回放录制文件
xbrowser replay recordings/my-session.yaml --slow-mo 100
```

录制文件使用 YAML 格式，记录了所有用户交互事件（点击、输入、滚动等），可在任何时候回放。

## 配置

配置通过环境变量管理，使用 `XBROWSER_` 前缀：

```bash
# 浏览器路径
export XBROWSER_BROWSER_EXECUTABLEPATH=/usr/bin/chromium

# Daemon 端口
export XBROWSER_DAEMON_PORT=9222

# 查看器主机
export XBROWSER_VIEWER_HOST=localhost
```

也可通过 config 命令管理：

```bash
xbrowser config list
xbrowser config get browser.executablePath
xbrowser config set browser.executablePath /usr/bin/chromium
```

## 全局参数

| 参数 | 说明 |
|------|------|
| `--json` | JSON 格式输出 |
| `--yaml` | YAML 格式输出 |
| `--session <name>` | 指定会话名称 |
| `--help, -h` | 显示帮助 |
| `--version, -v` | 显示版本 |

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

- **@dyyz1993/xcli-core** — CLI 框架核心
- **@dyyz1993/xpage** — 浏览器自动化引擎
- **Playwright** — 浏览器驱动
- **Zod** — 参数校验
- **YAML** — 录制文件格式

## 许可证

MIT
