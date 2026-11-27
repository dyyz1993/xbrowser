# WebSocket Real-time Browser Preview

xbrowser provides a WebSocket-based real-time browser preview feature that streams screenshots and command events to connected clients.

## Opening the Viewer

The viewer is served by the daemon itself (default port `9224`, override with `XBROWSER_DAEMON_PORT`).
`xbrowser preview` starts the daemon when it is not running and prints the viewer URL; the page and its
WebSocket share the daemon port.

```bash
# Default session ("default")
xbrowser preview

# A named session
xbrowser preview --session my-sess

# Daemon on another port (used only when the daemon has to be started)
xbrowser preview --session my-sess --port 19224

# Focus one element in the viewer
xbrowser preview --session my-sess --selector "#submit"
```

### Options

- `--session <name>` - session to watch (default: `XBROWSER_SESSION`, then `default`)
- `--port <number>` - daemon port, only used when the daemon is not running yet
- `--selector <css>` - appends `#focus=<selector>` to the URL when the element exists

### URL

```
http://localhost:9224/preview/<session>
```

Open it in a browser to see the live screencast and the command history, and to take over mouse and
keyboard (human hand-off for CAPTCHA / login).

## WebSocket Protocol

### Connection

Connect to the WebSocket server:

```javascript
const ws = new WebSocket('ws://localhost:9224/preview/<session-id>');
```

### Binding to a Session

Connecting to `/preview/<session-id>` binds that session automatically. A client connected to
`/preview` (no id) can bind later by sending a bind message:

```javascript
ws.send(JSON.stringify({
  type: 'bind',
  sessionId: 'session-id-here'
}));
```

### Message Types

#### Status Message

Sent on connection and when binding to a session:

```json
{
  "type": "status",
  "data": {
    "status": "connected" | "disconnected" | "error",
    "sessionId": "session-id",
    "message": "Optional message"
  }
}
```

#### Screenshot Message

Sent when a new screenshot is captured:

```json
{
  "type": "screenshot",
  "data": {
    "id": "frame-uuid",
    "sessionId": "session-id",
    "timestamp": 1714886400000,
    "data": "base64-encoded-image-data",
    "url": "https://example.com",
    "viewport": {
      "width": 1920,
      "height": 1080
    }
  }
}
```

#### Command Message

Sent when a browser command is executed:

```json
{
  "type": "command",
  "data": {
    "sessionId": "session-id",
    "command": "goto",
    "args": ["https://example.com"],
    "phase": "before" | "after",
    "result": {},
    "error": "error-message",
    "timestamp": 1714886400000,
    "duration": 150
  }
}
```

### Example Client Implementation

```javascript
const ws = new WebSocket('ws://localhost:9224/preview/<session-id>');

ws.onopen = () => {
  console.log('Connected to preview server');
  ws.send(JSON.stringify({
    type: 'bind',
    sessionId: 'default'
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  switch (message.type) {
    case 'status':
      console.log('Status:', message.data);
      break;

    case 'screenshot':
      const img = document.createElement('img');
      img.src = `data:image/jpeg;base64,${message.data.data}`;
      document.body.appendChild(img);
      break;

    case 'command':
      console.log('Command:', message.data);
      break;
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('Connection closed');
};
```

## Use Cases

1. **Live Debugging**: Watch your browser automation in real-time while developing
2. **Presentations**: Show live demos of your automation scripts
3. **Monitoring**: Keep an eye on long-running automation tasks
4. **Testing**: visually verify that your commands are executing correctly

## Performance Considerations

- The screencast only runs while at least one viewer is bound: it starts on bind and stops when the last viewer leaves
- Frame interval, JPEG quality and frame size are the daemon's screencast defaults (100 ms, JPEG quality 40, 1024x576);
  there are no CLI flags or config keys for them today
