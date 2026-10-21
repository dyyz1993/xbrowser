# Commands Reference

Complete reference for all xbrowser commands.

## Global Options

These options apply to all commands:

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format |
| `--yaml` | Output in YAML format |
| `--session <name>` | Use specific session (default: `default`) |
| `--cdp <endpoint>` | Connect to CDP endpoint |
| `-e, --eval <cmd>` | Execute command (repeatable) |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

## Navigation Commands

### goto / open

Navigate to a URL. `open` is an alias for `goto` — they are identical.

```bash
xbrowser goto <url> [options]
xbrowser open <url> [options]
```

**Options:**
- `--waitUntil <condition>` - Wait condition: `load`, `domcontentloaded`, `networkidle` (default: `domcontentloaded`)
- `--timeout <ms>` - Navigation timeout (default: 30000)

**Examples:**
```bash
xbrowser goto https://example.com
xbrowser open https://example.com
xbrowser goto https://example.com --waitUntil networkidle
xbrowser goto https://example.com --timeout 60000
```

### back

Go back in browser history.

```bash
xbrowser back
```

### forward

Go forward in browser history.

```bash
xbrowser forward
```

### refresh

Reload the current page.

```bash
xbrowser refresh
```

### title

Get the page title.

```bash
xbrowser title
```

**Output:**
```json
{
  "ok": true,
  "title": "Example Domain"
}
```

### url

Get the current URL.

```bash
xbrowser url
```

## Interaction Commands

### click

Click an element.

```bash
xbrowser click <selector> [options]
```

**Options:**
- `--timeout <ms>` - Element timeout (default: 30000)
- `--force <bool>` - Force click even if not visible (default: false)
- `--button <type>` - Mouse button: `left`, `right`, `middle` (default: `left`)
- `--clickCount <n>` - Number of clicks (default: 1)

**Examples:**
```bash
xbrowser click "#button"
xbrowser click "#button" --button right
xbrowser click "#button" --clickCount 2
```

### fill

Fill an input field (clears first).

```bash
xbrowser fill <selector> <value> [options]
```

**Options:**
- `--timeout <ms>` - Element timeout (default: 30000)

**Examples:**
```bash
xbrowser fill "#username" "alice"
xbrowser fill "#password" "secret123"
```

### type

Type text character by character.

```bash
xbrowser type <selector> <text> [options]
```

**Options:**
- `--delay <ms>` - Delay between keystrokes (default: 0)

**Examples:**
```bash
xbrowser type "#search" "playwright"
xbrowser type "#email" "user@example.com" --delay 50
```

### press

Press a keyboard key.

```bash
xbrowser press <selector> <key>
```

**Examples:**
```bash
xbrowser press body Enter
xbrowser press "#input" Tab
```

### hover

Hover over an element.

```bash
xbrowser hover <selector> [options]
```

**Options:**
- `--timeout <ms>` - Element timeout (default: 30000)

**Examples:**
```bash
xbrowser hover "#menu"
```

### select

Select an option from a dropdown.

```bash
xbrowser select <selector> <value>
```

**Examples:**
```bash
xbrowser select "#country" "US"
xbrowser select "#language" "en"
```

### check

Check a checkbox.

```bash
xbrowser check <selector>
```

**Examples:**
```bash
xbrowser check "#agree"
xbrowser check "#remember"
```

### uncheck

Uncheck a checkbox.

```bash
xbrowser uncheck <selector>
```

**Examples:**
```bash
xbrowser uncheck "#agree"
```

### dblclick

Double-click an element.

```bash
xbrowser dblclick <selector> [options]
```

**Options:**
- `--timeout <ms>` - Element timeout (default: 30000)

## Query Commands

### html

Get HTML content.

```bash
xbrowser html [options]
```

**Options:**
- `--selector <css>` - Get HTML from specific element
- `--clean` - Remove scripts and styles

**Examples:**
```bash
xbrowser html
xbrowser html --selector "#main"
xbrowser html --selector "#article" --clean
```

### text

Get text content.

```bash
xbrowser text [options]
```

**Options:**
- `--selector <css>` - Get text from specific element

**Examples:**
```bash
xbrowser text
xbrowser text --selector ".content"
```

## Wait Commands

### wait

Wait for element to be in state.

```bash
xbrowser wait <selector> [options]
```

**Options:**
- `--timeout <ms>` - Timeout (default: 30000)
- `--state <state>` - Element state: `visible`, `hidden`, `attached`, `detached` (default: `visible`)

**Examples:**
```bash
xbrowser wait "#content"
xbrowser wait "#loading" --state hidden
xbrowser wait "#modal" --state visible --timeout 60000
```

## Scroll Commands

### scroll

Scroll the page.

```bash
xbrowser scroll <direction> [options]
```

**Directions:**
- `down` - Scroll down
- `up` - Scroll up
- `left` - Scroll left
- `right` - Scroll right

**Options:**
- `--distance <px>` - Scroll distance in pixels (default: 500)
- `--selector <css>` - Scroll specific element

**Examples:**
```bash
xbrowser scroll down
xbrowser scroll down --distance 1000
xbrowser scroll up
xbrowser scroll right --selector "#container"
```

## Mouse Commands

### mouse

Control mouse movement and clicking.

```bash
xbrowser mouse <action> [args]
```

**Actions:**
- `move <x> <y>` - Move mouse to coordinates
- `click <x> <y>` - Click at coordinates
- `dblclick <x> <y>` - Double-click at coordinates

**Options:**
- `--steps <n>` - Number of steps for movement (default: 1)
- `--button <type>` - Mouse button: `left`, `right`, `middle`
- `--frame <url-substring>` - 在 URL 含此子串的**跨域 iframe（OOPIF）**内操作——输入派发到 iframe 自己的 CDP session（进程隔离下唯一可信通道），坐标使用 **iframe 局部坐标系**

**Examples:**
```bash
xbrowser mouse move 100 200
xbrowser mouse move 100 200 --steps 10
xbrowser mouse click 100 200
xbrowser mouse click 100 200 --button right
xbrowser mouse dblclick 100 200

# OOPIF 内拖滑块（验证码）：局部坐标 + steps 拟人轨迹
xbrowser mouse move --frame captcha.gtimg.com --x 54 --y 247
xbrowser mouse drag --frame captcha.gtimg.com --x 209 --y 247 --steps 30
```

## Cross-Origin iframe (OOPIF) Commands

跨域 iframe（验证码、支付窗）运行在独立渲染进程里，主页面 JS 的合成事件进不去，
主页面 session 的坐标输入也会被进程隔离挡住。xbrowser 用 `--frame` 一把钥匙打开：
**eval / click / fill / mouse 都接受 `--frame <url-substring>`**（全局 flag 或单命令
flag 皆可，单命令优先），所有读写与输入都路由到 iframe 自己的 session。

**全局 flag（链内所有命令继承）：**
```bash
xbrowser --frame captcha.gtimg.com "eval 'document.title' && click '.btn'"
```

### frames

列出页面所有 frame——**跨域 OOPIF 也可见**（标 `oopif: true` + `targetId`，它们
只出现在浏览器级 target 列表，普通 frame 树看不到）。每帧附 `parentUrl` / `depth`
层级（逐层 DOM 巡航重建——CDP frame 树对 OOPIF 不可见，实测 getFrameTree 只返回
主帧）；URL 子串歧义时输出 `warnings` 提示写更精确的子串。

```bash
xbrowser frames
# { "frames": [
#   { "index": 0, "url": "http://page.example/a",                    "depth": 0 },
#   { "index": 1, "url": "https://captcha.gtimg.com/...", "oopif": true,
#     "targetId": "C6F2...", "parentUrl": "http://page.example/a",   "depth": 1 },
#   { "index": 2, "url": "https://t.captcha.qq.com/...",  "oopif": true,
#     "targetId": "24D9...", "parentUrl": "https://captcha.gtimg.com/...", "depth": 2 }
# ], "warnings": [] }
```

### 标准验证码链（腾讯防水墙实测流程）

```bash
# 1. 找到 OOPIF（记下 URL 子串，如 captcha.gtimg.com）
xbrowser frames

# 2. iframe 内读 DOM（坐标是 iframe 局部坐标系）
xbrowser "eval --frame captcha.gtimg.com 'JSON.stringify((r=>({x:r.x+r.width/2,y:r.y+r.height/2}))(document.querySelector(\".tc-fg-item.tc-slider-normal\").getBoundingClientRect()))'"

# 3. frame session 内拖动（move 到滑块 → drag 到目标；buttons 位掩码自动携带）
xbrowser "mouse move --frame captcha.gtimg.com --x 54 --y 247 && mouse drag --frame captcha.gtimg.com --x 209 --y 247 --steps 30"

# 4. 校验结果
xbrowser "eval --frame captcha.gtimg.com 'getComputedStyle(document.querySelector(\".tc-success\")).display'"
```

**嵌套 iframe 不需要 `--frame a --frame b`**：每层跨域 iframe 都是独立 CDP target，
按 URL 子串直接命中最内层即可（target 列表是平铺的）。同进程（同源）iframe 用普通
click/fill 即可，locator 层已支持坐标偏移。

## Evaluate Commands

### eval

Evaluate JavaScript expression.

```bash
xbrowser eval <expression>
```

**Options:**
- `--frame <url-substring>` - 在 URL 含此子串的 iframe 里执行（跨域 OOPIF 亦可——绕过同源策略的调试通道）

**Examples:**
```bash
xbrowser eval "document.title"
xbrowser eval "document.querySelectorAll('a').length"
xbrowser eval "window.scrollY"
xbrowser eval --frame captcha.gtimg.com "document.querySelector('.tc-success').style.display"
```

## Storage Commands

### getCookies

Get all cookies.

```bash
xbrowser getCookies
```

### setCookie

Set a cookie.

```bash
xbrowser setCookie <name> <value> [options]
```

**Options:**
- `--domain <domain>` - Cookie domain
- `--path <path>` - Cookie path
- `--expires <date>` - Expiration date
- `--httpOnly <bool>` - HTTP only flag
- `--secure <bool>` - Secure flag
- `--sameSite <policy>` - SameSite policy: `Strict`, `Lax`, `None`

**Examples:**
```bash
xbrowser setCookie session abc123
xbrowser setCookie token xyz789 --domain .example.com
```

### clearCookies

Clear all cookies.

```bash
xbrowser clearCookies
```

### getLocalStorage

Get localStorage data.

```bash
xbrowser getLocalStorage [options]
```

**Options:**
- `--key <key>` - Get specific key

**Examples:**
```bash
xbrowser getLocalStorage
xbrowser getLocalStorage --key token
```

### setLocalStorage

Set localStorage value.

```bash
xbrowser setLocalStorage <key> <value>
```

**Examples:**
```bash
xbrowser setLocalStorage token "abc123"
xbrowser setLocalStorage user '{"name":"Alice"}'
```

### clearLocalStorage

Clear all localStorage.

```bash
xbrowser clearLocalStorage
```

## Screenshot Commands

### screenshot

Take a screenshot.

```bash
xbrowser screenshot [options]
```

**Options:**
- `--path <file>` - Output file path (default: `screenshot.png`)
- `--fullPage` - Capture full page
- `--type <type>` - Image type: `png`, `jpeg`
- `--quality <0-100>` - JPEG quality (default: 80)

**Examples:**
```bash
xbrowser screenshot
xbrowser screenshot --full-page
xbrowser screenshot --path myshot.png
xbrowser screenshot --type jpeg --quality 90
```

### snapshot

Get a page snapshot. Interactive refs are the default; explicitly request `aria`, `text`, `dom`, or `all` for other formats.

```bash
xbrowser snapshot [options]
```

**Options:**
- `--type <mode>` - `interactive` (default), `aria`, `text`, `dom`, or `all`
- `--selector <css>` - Snapshot a specific subtree
- `--selectors` - Include a ref-to-CSS-selector map
- `--all` - Include hidden interactive targets

**Examples:**
```bash
xbrowser snapshot
xbrowser snapshot --type aria
xbrowser snapshot --selector "#main"
xbrowser snapshot --selectors
```

## Frame Commands

### frames

List all iframes.

```bash
xbrowser frames
```

**Output:**
```json
{
  "ok": true,
  "frames": [
    { "name": "frame1", "url": "https://example.com/frame1.html" },
    { "name": "frame2", "url": "https://example.com/frame2.html" }
  ]
}
```

### frame

Switch to specific iframe.

```bash
xbrowser frame [options]
```

**Options:**
- `--index <n>` - Frame index
- `--name <name>` - Frame name

**Examples:**
```bash
xbrowser frame --index 0
xbrowser frame --name content
```

## Viewport Commands

### setViewport

Set viewport size.

```bash
xbrowser setViewport <width> <height> [options]
```

**Options:**
- `--isMobile <bool>` - Mobile emulation
- `--deviceScaleFactor <n>` - Device scale factor

**Examples:**
```bash
xbrowser setViewport 1920 1080
xbrowser setViewport 375 812 --isMobile true
xbrowser setViewport 1920 1080 --deviceScaleFactor 2
```

## Structure Commands

### structure

Extract DOM structure.

```bash
xbrowser structure [options]
```

**Options:**
- `--selector <css>` - Start from specific element
- `--depth <n>` - Maximum depth (default: 5)

**Examples:**
```bash
xbrowser structure
xbrowser structure --selector "#nav"
xbrowser structure --depth 3
```

## Session Commands

See [Built-in Commands](./builtins.md) for session management.

## Plugin Commands

See [Plugin Guide](./plugin-guide.md) for plugin commands.

## Recording Commands

See [Recording Guide](./recording.md) for recording commands.

## Output Formats

### Text Format (Default)

```bash
xbrowser title
# Output: Example Domain
```

### JSON Format

```bash
xbrowser title --json
# Output: {"ok": true, "title": "Example Domain"}
```

### YAML Format

```bash
xbrowser title --yaml
# Output: ok: true\n  title: Example Domain
```

## Scope System

Commands require specific execution contexts:

| Scope | Description | Required For |
|-------|-------------|--------------|
| project | No browser needed | config, plugin |
| browser | Browser instance | setViewport, session |
| page | Active page | goto, wait, query |
| element | Element selected | click, fill, type |

## HTTP Server

### serve

Start an HTTP REST API server for remote browser automation.

```bash
xbrowser serve [options]
```

**Options:**
- `--port <port>` - HTTP server port (default: 9224)
- `--token <secret>` - Bearer token for authentication

**Examples:**
```bash
# Start without auth (dev mode)
xbrowser serve

# Start with authentication
xbrowser serve --port 9224 --token my-secret

# Start on custom port
xbrowser serve --port 8080
```

When no token is configured, authentication is disabled (dev mode). To configure tokens persistently, set `server.tokens` in `~/.xbrowser/config.json` or use the `XBROWSER_SERVER_TOKEN` environment variable.

**API Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Health check (no auth required) |
| GET | `/api/v1/commands` | List all registered commands |
| GET | `/api/v1/sessions` | List active browser sessions |
| POST | `/api/v1/sessions` | Create a new session |
| DELETE | `/api/v1/sessions/:name` | Close a session |
| POST | `/api/v1/exec` | Execute a single command |
| POST | `/api/v1/chain` | Execute a command chain |

**Execute a command:**
```bash
curl -X POST http://localhost:9224/api/v1/exec \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer my-secret" \
  -d '{"command":"goto","params":{"url":"https://example.com"}}'
```

**Execute a command chain:**
```bash
curl -X POST http://localhost:9224/api/v1/chain \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer my-secret" \
  -d '{"chain":"goto https://example.com && title && text --selector h1"}'
```

## Remote CLI

### remote

Execute commands on a remote xbrowser HTTP server.

```bash
xbrowser remote <url> [command] [--token <secret>]
```

**Arguments:**
- `<url>` - Remote server URL (e.g. `http://192.168.1.100:9224`)
- `[command]` - Command to execute (omit for health check)

**Options:**
- `--token <secret>` - Authentication token

**Examples:**
```bash
# Health check
xbrowser remote http://192.168.1.100:9224 --token my-secret

# Execute a single command
xbrowser remote http://192.168.1.100:9224 "goto https://example.com" --token my-secret --json

# Execute a command chain
xbrowser remote http://192.168.1.100:9224 "goto https://example.com && title && text --selector h1" --token my-secret

# With default session
xbrowser remote http://192.168.1.100:9224 "title" --token my-secret
```

## Daemon

Daemon starts automatically when you run commands — no manual start/stop/status operations needed.

```bash
# Just run commands — daemon starts automatically
xbrowser "goto https://example.com && title && screenshot"
```

## See Also

- [Quick Start](./quickstart.md) — Getting started guide
- [Architecture](./architecture.md) — System architecture
- [Command Chains](./chains.md) — Chaining commands
