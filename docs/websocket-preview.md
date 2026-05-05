# WebSocket Real-time Browser Preview

xbrowser provides a WebSocket-based real-time browser preview feature that streams screenshots and command events to connected clients.

## Starting the Preview Server

Start the preview server using the `xbrowser preview` command:

```bash
# Default settings (port 9223, 1s interval, JPEG quality 80)
xbrowser preview

# Custom port
xbrowser preview --port 8080

# Faster refresh rate
xbrowser preview --interval 500

# Higher quality
xbrowser preview --quality 90

# Use PNG format
xbrowser preview --type png
```

### Options

- `--port <number>` - WebSocket server port (default: 9223)
- `--interval <ms>` - Screenshot capture interval in milliseconds (default: 1000)
- `--quality <0-100>` - JPEG quality level (default: 80)
- `--type <jpeg|png>` - Image format (default: jpeg)

## Using the HTML Viewer

The preview command will display a path to a local HTML viewer file:

```
Open the viewer to see real-time browser preview:
  HTML viewer: file:///Users/user/project/preview.html
  WebSocket: ws://localhost:9223
```

Simply open the `preview.html` file in your browser to see live screenshots and command history.

## WebSocket Protocol

### Connection

Connect to the WebSocket server:

```javascript
const ws = new WebSocket('ws://localhost:9223');
```

### Binding to a Session

To receive events for a specific browser session, send a bind message:

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
const ws = new WebSocket('ws://localhost:9223');

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

- Higher screenshot quality increases bandwidth usage
- Lower intervals increase CPU usage on both server and client
- Use PNG for lossless compression when quality is critical
- Use JPEG for better bandwidth efficiency at the cost of some quality
