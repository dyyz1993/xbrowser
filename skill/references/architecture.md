# Architecture Deep Dive

Startup flow, request lifecycle, module dependencies, and plugin loading mechanism.

**Related**: [../SKILL.md](../SKILL.md) for overview, [session-lifecycle.md](session-lifecycle.md) for session management.

## Contents

- [Startup Flow](#startup-flow)
- [Request Lifecycle](#request-lifecycle)
- [Module Dependency Graph](#module-dependency-graph)
- [Plugin Loading Mechanism](#plugin-loading-mechanism)
- [Session Model](#session-model)
- [Daemon Architecture](#daemon-architecture)
- [Command Registry](#command-registry)
- [Chain Execution](#chain-execution)

---

## Startup Flow

```
User runs: xbrowser <args>
       │
       ▼
bin/cli.ts
  ├── ensureProxyFetch()      — proxy support
  ├── readStdin()             — pipe/stdin detection
  └── routeCommand(argv, stdin?)
            │
            ▼
      src/router.ts
        ├── Phase 1: Special modes
        │   ├── stdin mode    — pipe commands as chain
        │   ├── eval mode     — -e / --eval flags
        │   └── chain mode    — single arg with && , -> operators
        │
        └── Phase 2: Parsed dispatch (switch/case)
            ├── session    → handleSession()
            ├── plugin     → handlePlugin()
            ├── create     → handleCreate()
            ├── record     → handleRecord()
            ├── replay     → handleReplay()
            ├── config     → handleConfig()
            ├── viewer     → handleViewer()
            ├── daemon     → handleDaemon()
            ├── serve      → handleServe()
            ├── remote     → handleRemote()
            ├── run        → handleRun()
            ├── convert    → handleConvert()
            ├── extract    → handleExtract()
            ├── filter     → handleFilter()
            ├── net        → handleNetCommand()
            ├── test       → handleTest()
            ├── help       → showMainHelp()
            ├── preview    → builtin preview
            └── default    → plugin lookup → handleBrowserCommand()
```

---

## Request Lifecycle

Single command execution path (e.g. `xbrowser click .btn`):

```
routeCommand()
  │
  ├─ Parse args (parseArgs from xcli-core)
  │   ├── Extract --session (or XBROWSER_SESSION env or "default")
  │   ├── Extract --cdp (or XBROWSER_CDP env)
  │   └── Extract --json / --yaml mode
  │
  ├─ Dispatch to handleBrowserCommand()
  │   ├── Map CLI args → command params
  │   │   (selector normalization, value extraction)
  │   └── Call executeCommand()
  │
  └─ executeCommand()
      ├── 1. Guard check
      ├── 2. Command lookup (getCommand from registry)
      ├── 3. Zod validation (safeParse)
      ├── 4. Daemon forward (if needed)
      ├── 5. Session find/create
      │   ├── findOrRestoreSession() — in-memory then disk
      │   └── Liveness check (page.evaluate timeout 3s)
      ├── 6. Context construction (page, browser, storage)
      ├── 7. Pre-command hooks (onBeforeCommand)
      ├── 8. Handler execution (command.handler(params, ctx))
      ├── 9. Post-command hooks (onAfterCommand)
      ├── 10. WebSocket broadcast
      └── 11. Return CommandResult
```

---

## Module Dependency Graph

```
bin/cli.ts
  └── src/router.ts
        ├── src/executor.ts (executeCommand, executeChain)
        │     ├── src/commands/command-registry.ts (getCommand)
        │     ├── src/browser.ts (findOrRestoreSession, createSession)
        │     ├── src/hooks/loader.ts (loadHooks)
        │     └── src/daemon/daemon.ts (forwardExec)
        │
        ├── src/cli/index.ts (re-exports all handlers)
        │     ├── browser-routes.ts (handleBrowserCommand)
        │     ├── session-routes.ts (handleSession)
        │     ├── plugin-routes.ts (handlePlugin)
        │     ├── viewer-routes.ts (handleViewer)
        │     ├── record-routes.ts (handleRecord)
        │     └── ... (daemon, create, config, run, etc.)
        │
        ├── src/commands/ (49 commands via registerCommand)
        │     ├── index.ts (side-effect imports + re-exports)
        │     ├── navigation.ts (goto, open, back, forward, refresh, title, url)
        │     ├── interaction.ts (click, fill, type, press, select, check, hover, dblclick)
        │     ├── query.ts (text, html)
        │     ├── evaluate.ts (eval)
        │     ├── wait.ts (wait)
        │     ├── screenshot.ts
        │     ├── storage.ts (6 cookie/localStorage commands)
        │     ├── ui-debug.ts (console, net-debug, perf, health)
        │     ├── agent.ts (observe, act, waitFor)
        │     └── ... (scroll, mouse, viewport, frame, tab, snapshot, etc.)
        │
        ├── src/plugin/loader.ts (XBrowserPluginLoader)
        │     └── Scans .xcli/plugins/ → loads index.ts → registers via xcli-core
        │
        ├── src/daemon/ (background process)
        │     ├── daemon.ts (start/stop daemon process)
        │     ├── daemon-main.ts (daemon entry point)
        │     ├── rpc-handlers.ts (RPC method handlers)
        │     └── preview-templates.ts (viewer HTML)
        │
        ├── src/cdp-driver/ (custom CDP driver)
        │     ├── page.ts
        │     └── browser.ts
        │
        └── src/builtins/ (preview, config builtins)
```

---

## Plugin Loading Mechanism

### Scan Directories (priority order)

```
1. <cwd>/.xcli/plugins/       — project-local (highest priority)
2. <cwd>/../.xcli/plugins/    — parent directory
3. ~/.xcli/plugins/            — user home
4. ~/.xbrowser/plugins/        — global xbrowser plugins
```

### Loading Flow

```
XBrowserPluginLoader.scanAndLoad()
  │
  ├── For each directory (in priority order):
  │   ├── List subdirectories
  │   ├── Skip if plugin name already seen (higher-priority wins)
  │   ├── Look for index.js → index.ts
  │   ├── Validate package.json exists (warn if missing)
  │   ├── Parse xbrowser metadata from package.json
  │   └── loadPlugin(indexPath, name) → import module
  │       └── Calls exported function with XCLIAPI
  │           └── Plugin calls xcli.createSite() + site.command()
  │               └── Commands registered in xcli-core
  │
  └── Result: all plugins loaded, commands available via getSite()
```

### Plugin Resolution at Runtime

When user runs `xbrowser <site> <command>`:

1. Router default case: `getPluginLoader().getSite(siteName)`
2. If found: resolve sub-command, validate params via Zod
3. Check login guard (if `requiresLogin`)
4. Execute handler with context (page, storage, etc.)

---

## Session Model

### Session Isolation

Each session has:
- Unique name (default: `"default"`)
- Its own CDP connection / browser page
- Persistent metadata in `~/.xbrowser/sessions/`
- Plugin storage in `.xcli/storage/<plugin>/`

### Session Resolution Priority

```
1. --session <name> CLI flag
2. XBROWSER_SESSION environment variable
3. "default" fallback
```

### CDP Connection Priority

```
1. --cdp <endpoint> CLI flag
2. XBROWSER_CDP environment variable
3. Auto-launch headless Chromium
```

---

## Daemon Architecture

The daemon is a **spawned child process** for long-running browser sessions:

```
CLI Process                          Daemon Process (port 9224)
┌─────────────────┐                 ┌──────────────────────────┐
│ routeCommand()   │   HTTP RPC      │ daemon-main.ts           │
│   │              │ ──────────────► │   ├── HTTP RPC Server    │
│   ▼              │                 │   ├── WebSocket Preview  │
│ forwardExec()    │   JSON POST     │   └── Session Manager    │
│                  │ ◄────────────── │                          │
└─────────────────┘   Response       └──────────────────────────┘
                                            │
                                            │ CDP
                                            ▼
                                     ┌──────────────────┐
                                     │ Chromium Browser  │
                                     │ (headless/CDP)    │
                                     └──────────────────┘
```

### When Daemon Starts

- Auto-started when needed
- Spawned as detached child process
- Writes PID + port to `~/.xbrowser/daemon.json`
- Viewer URL: `http://localhost:9224/preview/<session-name>`

---

## Command Registry

Global `Map<string, RegisteredCommand>` in `src/commands/command-registry.ts`:

```typescript
interface RegisteredCommand {
  name: string;
  description: string;
  scope: 'project' | 'browser' | 'page' | 'element';
  parameters: ZodSchema;
  result?: ZodSchema;
  handler: (params: unknown, ctx: unknown) => Promise<unknown>;
  selectorParams?: string[];
}
```

- `registerCommand()` — adds to map (called by each command file at import time)
- `getCommand(name)` — lookup by name
- `getAllCommands()` — returns all entries
- `getCommandNames()` — returns all names

---

## Chain Execution

`executeChain()` in `src/executor.ts` supports these operators:

| Operator | Behavior | Example |
|----------|----------|---------|
| `&&` | Short-circuit AND — stops on first failure | `goto url && title && screenshot` |
| `||` | Short-circuit OR — stops on first success | `click .btn1 || click .btn2` |
| `;` | Sequence — always runs all | `goto url ; screenshot` |
| `->` | Sequence (readable alias) | `goto url -> title -> click btn` |
| `,` | Sequence (readable alias) | `goto url , title , screenshot` |
| `+` | Sequence (readable alias) | `goto url + title + screenshot` |

Detection: `isChainInput()` checks for `/\s&&\s|\s;\s|\s,\s|\s\+\s|\s->\s/`
