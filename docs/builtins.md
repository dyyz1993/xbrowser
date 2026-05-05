# Built-in Commands

Commands that manage the xbrowser CLI itself (not browser operations).

## Session Management

### session open

Open a browser session.

```bash
xbrowser session open <url> [options]
```

**Options:**
- `--name <name>` - Session name (default: `default`)
- `--headless` - Run headless (default: false)

**Examples:**
```bash
xbrowser session open https://example.com
xbrowser session open https://example.com --name work
xbrowser session open https://example.com --headless
```

### session close

Close a browser session.

```bash
xbrowser session close [options]
```

**Options:**
- `--name <name>` - Close specific session
- `--all` - Close all sessions

**Examples:**
```bash
xbrowser session close
xbrowser session close --name work
xbrowser session close --all
```

### session list

List all active sessions.

```bash
xbrowser session list
```

**Output:**
```json
{
  "sessions": [
    {
      "id": "default",
      "name": "default",
      "url": "https://example.com",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "isHeadless": false
    }
  ]
}
```

### session kill

Force terminate a session.

```bash
xbrowser session kill [options]
```

**Options:**
- `--name <name>` - Kill specific session

**Examples:**
```bash
xbrowser session kill
xbrowser session kill --name work
```

## Plugin Management

### plugin install

Install a plugin.

```bash
xbrowser plugin install <source> [options]
```

**Options:**
- `--name <name>` - Plugin name (auto-detected from source)
- `--force` - Force reinstall

**Sources:**
- Local directory: `./my-plugin`
- npm package: `xbrowser-plugin-scraper`
- git URL: `https://github.com/user/repo.git`

**Examples:**
```bash
xbrowser plugin install ./my-plugin
xbrowser plugin install xbrowser-plugin-scraper
xbrowser plugin install https://github.com/user/plugin.git
xbrowser plugin install ./my-plugin --name custom-name
xbrowser plugin install ./my-plugin --force
```

### plugin uninstall

Uninstall a plugin.

```bash
xbrowser plugin uninstall <name>
```

**Examples:**
```bash
xbrowser plugin uninstall my-plugin
```

### plugin list

List installed plugins.

```bash
xbrowser plugin list [options]
```

**Options:**
- `--json` - Output as JSON

**Examples:**
```bash
xbrowser plugin list
xbrowser plugin list --json
```

### plugin reload

Reload a plugin (hot reload).

```bash
xbrowser plugin reload <name>
```

**Examples:**
```bash
xbrowser plugin reload my-plugin
```

### plugin search

Search for plugins on npm.

```bash
xbrowser plugin search [query] [options]
```

**Options:**
- `--limit <n>` - Max results (default: 20)
- `--tag <tag>` - Filter by tag
- `--site <url>` - Filter by site

**Examples:**
```bash
xbrowser plugin search scraper
xbrowser plugin search --tag ecommerce
xbrowser plugin search --site amazon.com --limit 10
```

## Configuration

### config list

List all configuration values.

```bash
xbrowser config list
```

**Output:**
```json
{
  "config": {
    "browser.executablePath": "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "browser.headless": false,
    "daemon.port": 9222
  }
}
```

### config get

Get a configuration value.

```bash
xbrowser config get <key>
```

**Examples:**
```bash
xbrowser config get browser.executablePath
xbrowser config get daemon.port
```

### config set

Set a configuration value.

```bash
xbrowser config set <key> <value>
```

**Examples:**
```bash
xbrowser config set browser.executablePath /usr/bin/chromium
xbrowser config set daemon.port 9223
```

### config unset

Remove a configuration value.

```bash
xbrowser config unset <key>
```

**Examples:**
```bash
xbrowser config unset browser.executablePath
```

## Daemon Management

### daemon start

Start the daemon process.

```bash
xbrowser daemon start [options]
```

**Options:**
- `--port <port>` - Daemon port (default: 9222)

**Examples:**
```bash
xbrowser daemon start
xbrowser daemon start --port 9223
```

### daemon stop

Stop the daemon process.

```bash
xbrowser daemon stop
```

### daemon status

Get daemon status.

```bash
xbrowser daemon status
```

**Output:**
```json
{
  "running": true,
  "pid": 12345,
  "port": 9222,
  "startedAt": "2025-01-01T00:00:00.000Z",
  "uptime": 3600
}
```

## Template Creation

### create

Create a new plugin from template.

```bash
xbrowser create <name> [options]
```

**Options:**
- `--template <name>` - Template to use
- `--force` - Overwrite existing directory

**Available Templates:**
- `static` - Static page scraping
- `dynamic` - Dynamic interaction
- `login` - With login/logout
- `api` - API integration

**Examples:**
```bash
xbrowser create my-plugin
xbrowser create my-plugin --template static
xbrowser create my-plugin --template login --force
```

## File Execution

### run

Execute commands from a file.

```bash
xbrowser run <file>
```

**File Format:**
```
goto https://example.com
title
text --selector "#content"
screenshot
```

**Examples:**
```bash
xbrowser run commands.txt
xbrowser run ./scripts/scrape.txt
```

## Heredoc Support

Execute multiple commands via heredoc:

```bash
xbrowser <<EOF
goto https://example.com
title
click "#button"
wait ".result"
text --selector ".result"
EOF
```

## Pipeline Support

Execute commands from stdin:

```bash
echo "goto https://example.com" | xbrowser
echo -e "goto https://example.com\ntitle\nscreenshot" | xbrowser
```

## Eval Mode

Execute commands with `-e` flag:

```bash
xbrowser -e "goto https://example.com" -e "title" -e "screenshot"
```

## Help Commands

### help

Show help information.

```bash
xbrowser help
xbrowser help <command>
```

**Examples:**
```bash
xbrowser help
xbrowser help goto
xbrowser help plugin install
```

## Version

Display version information.

```bash
xbrowser version
```

## Exit Codes

- `0` - Success
- `1` - Error
- `2` - Invalid arguments
- `3` - Command not found

## Configuration File

Configuration is stored at: `~/.xbrowser/config.json`

### Default Configuration

```json
{
  "browser": {
    "executablePath": "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "headless": false,
    "slowMo": 0
  },
  "daemon": {
    "port": 9222,
    "workers": 3
  },
  "session": {
    "defaultTimeout": 30000
  }
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `XBROWSER_CHROMIUM_PATH` | Chromium executable path | Auto-detected |
| `XBROWSER_DAEMON_PORT` | Daemon port | 9222 |
| `XBROWSER_LOG_LEVEL` | Log level | info |

## See Also

- [Commands Reference](./commands.md) — Browser commands
- [Plugin Guide](./plugin-guide.md) — Plugin development
- [Quick Start](./quickstart.md) — Getting started
