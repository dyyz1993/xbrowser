# Console Facade and readonly overview

Stage 0 prototype from the xBrowser 2.0 PRD. It is deliberately read-only and
wraps existing local services without touching browser control semantics.

## Run

```bash
npm run build
xbrowser console-panel --port 9225
```

Open <http://127.0.0.1:9225/overview> for HTML, or call
<http://127.0.0.1:9225/api/overview> with `Accept: application/json`.

## What it reads

- daemon health/status, daemon session list and preview URL
- chrome-bridge `/status`, extension connection count and remembered extension id
- login-bridge availability and archived cookie count
- installed plugin metadata from `PluginInstaller.list()`
- loaded plugin commands from the plugin loader
- recent command log and network capture summary for one selected session

It does not create sessions, execute commands, mutate plugin state, or connect
to the preview WebSocket. Media remains the daemon's existing preview protocol.
