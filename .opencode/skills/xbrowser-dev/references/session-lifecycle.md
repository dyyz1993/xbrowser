# Session Lifecycle & Daemon Management

Session management patterns for xbrowser — create, use, and close browser sessions.

**Related**: [../SKILL.md](../SKILL.md) for project overview, [cdp-pitfalls.md](../../../.config/opencode/skills/xbrowser/references/cdp-pitfalls.md) for CDP issues.

## Contents

- [Session Lifecycle](#session-lifecycle)
- [Daemon Auto-Start](#daemon-auto-start)
- [CDP Connection Modes](#cdp-connection-modes)
- [Human-in-the-Loop Viewer](#human-in-the-loop-viewer)
- [kill vs close vs stop](#kill-vs-close-vs-stop)
- [Code Changes Require Rebuild](#code-changes-require-rebuild)
- [Session Commands Reference](#session-commands-reference)
- [Common Patterns](#common-patterns)

---

## Session Lifecycle

Every browser interaction follows this pattern:

```
session open → commands → session close
```

```bash
# 1. Create session (auto-starts daemon if needed)
npx xbrowser session open https://example.com --name mytask

# 2. Execute commands
npx xbrowser click --selector '.btn' --session mytask
npx xbrowser scrape https://example.com --json --session mytask
npx xbrowser fill --selector '#input' --value 'hello' --session mytask

# 3. Close session when done (mandatory!)
npx xbrowser session close --name mytask
```

### Mandatory Rules

1. **Always create a new session** — Never reuse stale sessions from previous tasks
2. **Always close when done** — Unclosed sessions leak CDP connections and memory
3. **Use `xbrowser kill` for cleanup** — Nuclear option when state is uncertain
4. **Kill before testing code changes** — Old daemon + new code = unpredictable bugs

```bash
# ✅ Correct pattern
npx xbrowser session open https://example.com --name task1
npx xbrowser click --selector '.btn' --session task1
npx xbrowser session close --name task1

# ❌ Wrong — reusing stale session, no cleanup
npx xbrowser click --selector '.btn'
npx xbrowser scrape https://example.com --json
```

---

## Daemon Auto-Start

The xbrowser daemon runs on port 9224 and manages browser sessions. It auto-starts when you run `session open`:

```bash
# Daemon auto-starts on first session open
npx xbrowser session open https://example.com --name task1
# → Daemon started on port 9224

# Check daemon status
npx xbrowser daemon status

# Manual daemon control
npx xbrowser daemon start    # Usually unnecessary — auto-started
npx xbrowser daemon stop     # Stop daemon only (sessions may linger)
```

**Daemon lifecycle**:
- Auto-started by `session open` if not running
- Persists across commands within the same task
- Stopped by `xbrowser kill` or `daemon stop`
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

# Or use cdp-tunnel for an already-running browser
npx cdp-tunnel start

# Connect to headless Chromium on 9222
npx xbrowser session open https://example.com --cdp http://localhost:9222
```

### Persistent Configuration

```bash
# Set default CDP port (persists in ~/.xbrowser/config.json)
npx xbrowser config set cdp_port 9221

# Set custom Chromium path
npx xbrowser config set chromium_path /path/to/chromium

# View current config
npx xbrowser config list
```

**Priority**: CLI flag > env var > config file > default.

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
# Example: login flow with human intervention
npx xbrowser session open https://login-site.com --name task1 --cdp http://localhost:9221
npx xbrowser fill --selector '#username' --value 'user' --session task1
npx xbrowser fill --selector '#password' --value 'pass' --session task1
npx xbrowser click --selector '#login-btn' --session task1
# → Captcha appeared, blocked
# Agent tells user: "Open http://localhost:9224/preview/task1 to complete verification"
# User manually completes captcha
# Agent continues:
npx xbrowser scrape https://login-site.com/dashboard --json --session task1
npx xbrowser session close --name task1
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

## kill vs close vs stop

| Command | Scope | When to Use |
|---------|-------|-------------|
| `session close --name <n>` | Closes one session | Normal cleanup after task |
| `daemon stop` | Stops daemon only | Explicit daemon shutdown |
| `xbrowser kill` | Kills daemon + ALL sessions | Nuclear cleanup, state unknown |

```bash
# Normal cleanup
npx xbrowser session close --name mytask

# Something went wrong
npx xbrowser kill

# After code changes
npx xbrowser kill && npm run build
```

---

## Code Changes Require Rebuild

When developing xbrowser code or modifying plugins, the running daemon uses stale code:

```bash
# Required after ANY code change
npx xbrowser kill && npm run build

# Then create fresh session (daemon auto-starts with new code)
npx xbrowser session open https://example.com --name test

# ❌ Wrong — old daemon running modified code = unpredictable bugs
npm run build
npx xbrowser session open ...  # May use cached daemon with old code
```

**Why**: The daemon process loads code at startup. `npm run build` only updates files on disk.
Without `kill`, the daemon continues running old code.

---

## Session Commands Reference

```bash
# Create session
npx xbrowser session open <url> [--name <n>] [--cdp <endpoint>]

# List active sessions
npx xbrowser session list

# Close specific session
npx xbrowser session close [--name <n>]

# Kill everything (daemon + all sessions)
npx xbrowser kill

# Daemon control
npx xbrowser daemon start     # Usually auto-started
npx xbrowser daemon status    # Check running state
npx xbrowser daemon stop      # Stop daemon
```

---

## Common Patterns

### Parallel Tasks with Named Sessions

```bash
npx xbrowser session open https://site-a.com --name task1 &
npx xbrowser session open https://site-b.com --name task2 &
wait

npx xbrowser scrape https://site-a.com --json --session task1 > a.json
npx xbrowser scrape https://site-b.com --json --session task2 > b.json

npx xbrowser session close --name task1
npx xbrowser session close --name task2
```

### CDP Login State Reuse

```bash
# 1. Start CDP with user's logged-in browser
/Applications/Chromium.app/Contents/MacOS/Chromium --remote-debugging-port=9221

# 2. Session using CDP (preserves login cookies)
npx xbrowser session open https://douyin.com --name douyin --cdp http://localhost:9221
npx xbrowser douyin search --keyword "cats" --session douyin --json
npx xbrowser session close --name douyin
```

### Full Development Cycle

```bash
# Clean state → build → test
npx xbrowser kill
npm run build

# Create session for testing
npx xbrowser session open https://example.com --name dev-test

# ... test commands ...

# Cleanup
npx xbrowser session close --name dev-test

# Run tests
npm run test
```
