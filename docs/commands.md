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

### goto

Navigate to a URL.

```bash
xbrowser goto <url> [options]
```

**Options:**
- `--waitUntil <condition>` - Wait condition: `load`, `domcontentloaded`, `networkidle` (default: `domcontentloaded`)
- `--timeout <ms>` - Navigation timeout (default: 30000)

**Examples:**
```bash
xbrowser goto https://example.com
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

### getProperty

Get element property or attribute.

```bash
xbrowser getProperty <selector> <property>
```

**Examples:**
```bash
xbrowser getProperty "#link" href
xbrowser getProperty "#image" src
xbrowser getProperty "#input" value
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

### waitForTimeout

Wait for specified duration.

```bash
xbrowser waitForTimeout <ms>
```

**Examples:**
```bash
xbrowser waitForTimeout 2000
xbrowser waitForTimeout 5000
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

**Examples:**
```bash
xbrowser mouse move 100 200
xbrowser mouse move 100 200 --steps 10
xbrowser mouse click 100 200
xbrowser mouse click 100 200 --button right
xbrowser mouse dblclick 100 200
```

## Evaluate Commands

### eval

Evaluate JavaScript expression.

```bash
xbrowser eval <expression>
```

**Examples:**
```bash
xbrowser eval "document.title"
xbrowser eval "document.querySelectorAll('a').length"
xbrowser eval "window.scrollY"
```

### evaluateFn

Evaluate async JavaScript function.

```bash
xbrowser evaluateFn <script> --args <values...>
```

**Examples:**
```bash
xbrowser evaluateFn "return args[0] + args[1]" --args 1 2
xbrowser evaluateFn "return await fetch(args[0]).then(r=>r.json())" --args https://api.example.com/data
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

### getSessionStorage

Get sessionStorage data.

```bash
xbrowser getSessionStorage [options]
```

**Options:**
- `--key <key>` - Get specific key

### setSessionStorage

Set sessionStorage value.

```bash
xbrowser setSessionStorage <key> <value>
```

### clearSessionStorage

Clear all sessionStorage.

```bash
xbrowser clearSessionStorage
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

Get accessibility snapshot.

```bash
xbrowser snapshot [options]
```

**Options:**
- `--selector <css>` - Snapshot specific element
- `--interactiveOnly` - Only interactive elements

**Examples:**
```bash
xbrowser snapshot
xbrowser snapshot --selector "#main"
xbrowser snapshot --interactive-only
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
| project | No browser needed | config, plugin, daemon |
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

## Daemon Commands

### daemon

Manage the xbrowser daemon background process.

```bash
xbrowser daemon <subcommand> [options]
```

**Subcommands:**
- `start` - Start the daemon
- `stop` - Stop the daemon
- `status` - Check daemon status

**Options:**
- `--port <port>` - Browser CDP port (default: 9222)
- `--http-port <port>` - HTTP API port (default: off)

**Examples:**
```bash
# Start daemon with HTTP API
xbrowser daemon start --http-port 9224

# Start daemon with custom ports
xbrowser daemon start --port 9222 --http-port 9224

# Check status
xbrowser daemon status

# Stop daemon
xbrowser daemon stop
```

## See Also

- [Quick Start](./quickstart.md) — Getting started guide
- [Architecture](./architecture.md) — System architecture
- [Command Chains](./chains.md) — Chaining commands
