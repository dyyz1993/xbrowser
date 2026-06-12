# Session Lifecycle & Daemon Management

Session management patterns for xbrowser — create, use, and close browser sessions.

**Related**: [../SKILL.md](../SKILL.md) for overview, [architecture.md](architecture.md) for system design, [cdp-pitfalls.md](cdp-pitfalls.md) for CDP issues.

## Contents

- [Session Lifecycle](#session-lifecycle)
- [Daemon Auto-Start](#daemon-auto-start)
- [CDP Connection Modes](#cdp-connection-modes)
- [Environment Variables](#environment-variables)
- [Human-in-the-Loop Viewer](#human-in-the-loop-viewer)
- [kill vs close](#kill-vs-close)
- [Code Changes Require Rebuild](#code-changes-require-rebuild)
- [Session Commands Reference](#session-commands-reference)
- [Common Patterns](#common-patterns)

---

## Session Lifecycle

Every browser interaction follows this pattern:

```
auto-create → commands → auto-cleanup
```

Sessions are **auto-created** when you run `goto` or any page-scoped command. There is no need to manually open a session.

```bash
# 1. Navigate — session auto-created (daemon auto-starts if needed)
xbrowser goto https://example.com --session mytask --cdp http://localhost:9222

# 2. Execute commands (session is already active)
xbrowser click --selector '.btn' --session mytask
xbrowser scrape https://example.com --json --session mytask
xbrowser fill --selector '#input' --value 'hello' --session mytask

# 3. Close session when done (optional — daemon cleans up on exit)
xbrowser session close --session mytask
```

### Mandatory Rules

1. **Use `goto` to start** — Sessions auto-create on first `goto` or page-scoped command
2. **Always close when done** — Unclosed sessions leak CDP connections and memory
3. **Use `xbrowser kill` for cleanup** — Nuclear option when state is uncertain
4. **Kill before testing code changes** — Old daemon + new code = unpredictable bugs

```bash
# ✅ Correct pattern — auto-create via goto
xbrowser goto https://example.com --session task1 --cdp http://localhost:9222
xbrowser click --selector '.btn' --session task1
xbrowser session close --session task1

# ❌ Wrong — reusing stale session, no cleanup
xbrowser click --selector '.btn'
xbrowser scrape https://example.com --json
```

---

## Daemon Auto-Start

The xbrowser daemon runs on port 9224 and manages browser sessions. It auto-starts when you run commands:

```bash
# Daemon auto-starts when needed — sessions auto-create on goto
xbrowser goto https://example.com --session task1 --cdp http://localhost:9222
# → Daemon started on port 9224, session "task1" auto-created

# Or use any command directly (daemon auto-managed)
xbrowser "goto https://example.com && title"
```

**Daemon lifecycle**:
- Auto-started when needed if not running
- Persists across commands within the same task
- Stopped by `xbrowser kill`
- Viewer URL: `http://localhost:9224/preview/<session-name>`

---

## CDP Connection Modes

Three modes for connecting to browsers:

| Mode | Flag | Use Case |
|------|------|----------|
| CDP Tunnel (user browser) | `--cdp http://localhost:9221` | **Needs login** — Douyin, Weibo, Taobao |
| Headless Chromium | `--cdp http://localhost:9222` | Public pages, no login needed |
| Auto (default) | no `--cdp` flag | Auto-launch headless Chromium |

### Setting Up CDP

```bash
# Launch Chromium with CDP on port 9221 (user browser with login state)
/Applications/Chromium.app/Contents/MacOS/Chromium --remote-debugging-port=9221

# Connect to headless Chromium on 9222
xbrowser --cdp http://localhost:9222 title
```

### Persistent Configuration

```bash
# Set default CDP port (persists in ~/.xbrowser/config.json)
xbrowser config set cdp_port 9221

# Set custom Chromium path
xbrowser config set chromium_path /path/to/chromium

# View current config
xbrowser config list
```

**Priority**: `--cdp` flag > `XBROWSER_CDP` env > config file > default.

---

## Environment Variables

| Variable | Purpose | Overridden by |
|----------|---------|---------------|
| `XBROWSER_SESSION` | Default session name | `--session <name>` flag |
| `XBROWSER_CDP` | Default CDP endpoint | `--cdp <endpoint>` flag |

```bash
# Set default session and CDP for all commands
export XBROWSER_SESSION=my-task
export XBROWSER_CDP=http://localhost:9221

# Now all commands use these defaults
xbrowser title                    # uses my-task session + CDP 9221
xbrowser screenshot --full-page   # same session + CDP

# Override with flags when needed
xbrowser --cdp http://localhost:9222 title  # uses different CDP

# Unset when done
unset XBROWSER_SESSION XBROWSER_CDP
```

---

## Human-in-the-Loop Viewer

When automation is blocked (captcha, 2FA, login wall), the user can intervene via the viewer:

```
Automation blocked (captcha/2FA/popup/login)
    ↓
Agent outputs viewer URL: http://localhost:9224/preview/<session-name>
    ↓
User opens URL in browser → manually resolves the blocker
    ↓
Agent continues execution
```

```bash
# Open viewer for human takeover
xbrowser viewer

# Or specify session
xbrowser preview --session task1
```

### Viewer Architecture

```
User Browser (viewer)          xbrowser Daemon (9224)           Chromium (9221)
┌─────────────────┐     WS     ┌──────────────────┐    CDP     ┌──────────────┐
│  Canvas Viewer   │◄────────►│  WSServer         │◄─────────►│  Page         │
│  - drawFrame()   │  binary   │  - processFrame() │  screencast│  - events    │
│  - mouse events  │  frames   │  - input handlers │           │  - DOM       │
│  - touch events  │           │  - state machine  │           │              │
└─────────────────┘           └──────────────────┘           └──────────────┘
```

---

## kill vs close

| Command | Scope | When to Use |
|---------|-------|-------------|
| `session close --session <n>` | Closes one session | Normal cleanup after task |
| `xbrowser kill` | Kills daemon + ALL sessions | Nuclear cleanup, state unknown |

```bash
# Normal cleanup
xbrowser session close --session mytask

# Something went wrong
xbrowser kill

# After code changes
xbrowser kill && npm run build
```

---

## Code Changes Require Rebuild

When developing xbrowser code or modifying plugins, the running daemon uses stale code:

```bash
# Required after ANY code change
xbrowser kill && npm run build

# Then navigate — session auto-creates (daemon auto-starts with new code)
xbrowser goto https://example.com --session test --cdp http://localhost:9222

# ❌ Wrong — old daemon running modified code = unpredictable bugs
npm run build
xbrowser goto ...  # May use cached daemon with old code
```

**Why**: The daemon process loads code at startup. `npm run build` only updates files on disk.
Without `kill`, the daemon continues running old code.

---

## Session Commands Reference

```bash
# List active sessions
xbrowser session list

# Close specific session
xbrowser session close --session <name>

# Close all sessions
xbrowser session kill-all

# Kill everything (daemon + all sessions)
xbrowser kill
```

---

## Common Patterns

### Parallel Tasks with Named Sessions

```bash
xbrowser goto https://site-a.com --session task1 --cdp http://localhost:9222 &
xbrowser goto https://site-b.com --session task2 --cdp http://localhost:9222 &
wait

xbrowser scrape https://site-a.com --json --session task1 > a.json
xbrowser scrape https://site-b.com --json --session task2 > b.json

xbrowser session close --session task1
xbrowser session close --session task2
```

### CDP Login State Reuse

```bash
# 1. Start CDP with user's logged-in browser
/Applications/Chromium.app/Contents/MacOS/Chromium --remote-debugging-port=9221

# 2. Use with env var for convenience
export XBROWSER_CDP=http://localhost:9221
xbrowser douyin search --keyword "cats" --json
unset XBROWSER_CDP
```

### Full Development Cycle

```bash
# Clean state → build → test
xbrowser kill
npm run build

# Navigate — session auto-creates
xbrowser goto https://example.com --session dev-test --cdp http://localhost:9222

# ... test commands ...

# Cleanup
xbrowser session close --session dev-test

# Run tests
npm run test
```
