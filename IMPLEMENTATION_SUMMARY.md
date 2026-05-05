# WebSocket Real-time Browser Preview - Implementation Summary

## Overview

Implemented WebSocket-based real-time browser preview for xbrowser, enabling live screenshot streaming and command event broadcasting.

## Implementation Details

### Core Components

#### 1. Screencast Module (`src/screencast.ts`)
- `ScreencastCapturer` class for capturing periodic screenshots
- Configurable capture interval, quality, and format (JPEG/PNG)
- Event-based architecture for streaming frames
- Base64-encoded image data for WebSocket transmission

#### 2. WebSocket Server (`src/websocket-server.ts`)
- `WSServer` class built on ws library
- Session-based client management
- Message broadcasting to session-specific clients
- Support for multiple message types: status, screenshot, command
- Connection lifecycle management (connect/disconnect)

#### 3. Daemon Integration (`src/daemon/daemon.ts`)
- Updated `DaemonManager` to start WebSocket server
- Configurable WebSocket port (default: 9223)
- Shared WebSocket server instance across daemon lifecycle

#### 4. Command Event Streaming (`src/executor.ts`)
- Updated `executeCommand` to stream events via WebSocket
- Emits `before` and `after` events for each command
- Includes command name, args, result, error, timing, and duration
- Session-aware broadcasting

#### 5. Preview Builtin Command (`src/builtins/preview.ts`)
- `xbrowser preview` command with configuration options
- Starts WebSocket server with customizable settings
- Graceful shutdown on SIGINT
- Integrated with daemon manager

#### 6. HTML Viewer (`preview.html`)
- Self-contained browser-based viewer
- Real-time screenshot display
- Command history sidebar
- Session information panel
- Auto-refresh toggle
- Clear history button

### WebSocket Protocol

#### Message Types

1. **Status Message**
   - Connection status updates
   - Session binding confirmation

2. **Screenshot Message**
   - Base64-encoded image data
   - Page URL and viewport info
   - Timestamp and frame ID

3. **Command Message**
   - Command execution events
   - Before/after phases
   - Results and errors
   - Execution timing

### Features

- Multiple concurrent viewers per session
- Session isolation (viewers only see events for their session)
- Configurable capture parameters
- Graceful error handling
- Connection management
- Event-driven architecture

### CLI Usage

```bash
# Start preview with defaults
xbrowser preview

# Custom port
xbrowser preview --port 8080

# Faster refresh rate
xbrowser preview --interval 500

# Higher quality
xbrowser preview --quality 90

# PNG format
xbrowser preview --type png
```

### Dependencies Added

- `ws` - WebSocket server implementation
- `@types/ws` - TypeScript type definitions

### Exports

Updated `src/index.ts` to export new modules:
- `WSServer` class
- WebSocket message types
- `ScreencastCapturer` class
- Screencast types and options
- `setWSServer` function for executor integration

## Testing

- Created unit tests for screencast module
- Created unit tests for WebSocket server
- Updated existing tests to work with new features
- All tests pass with lint and typecheck

## Documentation

- Created comprehensive WebSocket protocol documentation
- Added usage examples
- Documented client implementation
- Performance considerations included

## Files Created

1. `src/screencast.ts` - Screenshot capture module
2. `src/websocket-server.ts` - WebSocket server implementation
3. `src/builtins/preview.ts` - Preview builtin command
4. `preview.html` - HTML viewer page
5. `docs/websocket-preview.md` - Protocol documentation

## Files Modified

1. `src/executor.ts` - Added WebSocket streaming integration
2. `src/daemon/daemon.ts` - Added WebSocket server management
3. `src/router.ts` - Added preview command routing
4. `src/builtins/index.ts` - Exported preview builtin
5. `src/index.ts` - Exported new modules and types
6. `package.json` - Added ws dependencies
7. `tsconfig.json` - No changes needed

## WebSocket Protocol Summary

### Client Connection Flow

1. Connect to `ws://localhost:9223` (default port)
2. Receive status message confirming connection
3. Send bind message to specify session: `{ type: 'bind', sessionId: '...' }`
4. Receive screenshot and command messages for that session

### Message Flow

```
Client → Server: { type: 'bind', sessionId: 'default' }
Server → Client: { type: 'status', data: { status: 'connected', sessionId: 'default' } }
Server → Client: { type: 'screenshot', data: { ...frame data... } }
Server → Client: { type: 'command', data: { ...command event... } }
```

## Performance Characteristics

- Default: 1-second interval, 80% JPEG quality
- Typical bandwidth: 100-500 KB/s depending on content
- CPU usage: Low to moderate (depends on interval)
- Client rendering: Browser handles image decoding efficiently

## Future Enhancements

Possible improvements:
- Interactive mode (click in viewer → execute command)
- Video recording/streaming
- CDP-based screencast for better performance
- Multiple browser tabs support
- Authentication for remote access
- Playback of command history
- Export screenshots/video

## Integration with xcli-core

The implementation is self-contained within xbrowser and doesn't depend on xcli-core's WebSocket infrastructure (if any), making it portable and independent.
