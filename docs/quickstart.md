# Quick Start

Get started with xbrowser in minutes.

## Installation

```bash
npm install -g @xbrowser/cli
```

Requires Node.js >= 18 and Chromium browser.

## First Steps

### 1. Open a Browser Session

```bash
xbrowser session open https://example.com
```

This opens Chromium and navigates to the specified URL.

### 2. Execute Commands

```bash
# Get page title
xbrowser title

# Get page text
xbrowser text

# Take a screenshot
xbrowser screenshot
```

### 3. Close the Session

```bash
xbrowser session close
```

## Command Chains

You can chain multiple commands in a single line:

```bash
# Navigate, get title, and screenshot
xbrowser "goto https://example.com && title && screenshot"

# Using comma separator
xbrowser "goto https://example.com , title , screenshot"

# Using arrow separator
xbrowser "goto https://example.com -> title -> screenshot"
```

## CDP Connection

Connect to an already-running browser:

```bash
# Connect via WebSocket URL
xbrowser --cdp ws://localhost:9222 "title"

# Connect via port
xbrowser --cdp 9222 "title"

# Auto-discover running browsers
xbrowser --cdp auto "title"
```

## Common Commands

### Navigation

```bash
xbrowser goto https://example.com
xbrowser open https://example.com   # open is an alias for goto
xbrowser back
xbrowser forward
xbrowser refresh
```

### Interaction

```bash
xbrowser click "#button"
xbrowser fill "#input" "Hello"
xbrowser type "#search" "keyword"
xbrowser hover "#menu"
```

### Query

```bash
xbrowser html --selector "#main"
xbrowser text --selector "#content"
xbrowser eval "document.querySelector('#link').href"
```

### Screenshot

```bash
xbrowser screenshot
xbrowser screenshot --full-page
xbrowser screenshot --type jpeg
```

## Recording and Playback

### Record Actions

```bash
# 1. Open session
xbrowser goto https://example.com

# 2. Start recording
xbrowser record start --url https://example.com

# 3. Perform actions in browser...

# 4. Stop recording
xbrowser record stop --output recording.yaml
```

### Playback Recording

```bash
xbrowser replay recording.yaml
```

## Using Plugins

```bash
# List installed plugins
xbrowser plugin list

# Install a plugin
xbrowser plugin install xbrowser-plugin-scraper

# Use plugin command
xbrowser my-plugin scrape
```

## Configuration

Set configuration values:

```bash
xbrowser config list
xbrowser config set browser.executablePath /usr/bin/chromium
```

## Daemon Mode

Daemon starts automatically when needed — no manual start/stop required:

```bash
# Daemon starts automatically when you run commands
xbrowser "goto https://example.com && title"
```

## Next Steps

- [Commands Reference](./commands.md) — All available commands
- [Architecture](./architecture.md) — System architecture overview
- [Plugin Development](./plugin-guide.md) — Create custom plugins
- [Recording Guide](./recording.md) — Advanced recording features

## Examples

### Web Scraping

```bash
xbrowser "goto https://example.com/products && text --selector .price"
```

### Form Filling

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

### Multi-Page Scraping

```bash
for url in https://site1.com https://site2.com https://site3.com; do
  xbrowser "goto $url , title , screenshot"
done
```

## Troubleshooting

### Browser Not Found

```bash
# Set Chromium path
export XBROWSER_CHROMIUM_PATH=/path/to/chromium
xbrowser "goto https://example.com"
```

### Permission Denied

```bash
# Make Chromium executable
chmod +x /path/to/chromium
```

### Connection Refused

```bash
# Reconnect to browser
xbrowser --cdp auto "goto https://example.com"
```

## Help

Get help on any command:

```bash
xbrowser --help
xbrowser goto --help
xbrowser plugin --help
```
