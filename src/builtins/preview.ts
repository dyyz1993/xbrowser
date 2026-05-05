import type { BuiltinCommand, BuiltinContext } from './session.js';

const previewBuiltin: BuiltinCommand = {
  name: 'preview',
  description: 'Start real-time browser preview via WebSocket',
  help: {
    usage: 'xbrowser preview [options]',
    description: 'Start a WebSocket server to stream browser screenshots and command events in real-time',
    options: [
      { name: 'port', description: 'WebSocket port (default: 9223)' },
      { name: 'interval', description: 'Screenshot interval in ms (default: 1000)' },
      { name: 'quality', description: 'JPEG quality 0-100 (default: 80)' },
      { name: 'type', description: 'Image type: jpeg or png (default: jpeg)' },
    ],
    examples: [
      { cmd: 'xbrowser preview', description: 'Start preview with default settings' },
      { cmd: 'xbrowser preview --port 8080', description: 'Start preview on custom port' },
      { cmd: 'xbrowser preview --interval 500', description: 'Start preview with faster refresh rate' },
    ],
  },
  execute: async (args: string[], options: Record<string, unknown>, context: BuiltinContext): Promise<void> => {
    const { cwd } = context;
    const port = options.port ? Number(options.port) : 9223;
    const interval = options.interval ? Number(options.interval) : 1000;
    const quality = options.quality ? Number(options.quality) : 80;
    const type = options.type === 'png' ? 'png' : 'jpeg';

    console.log(`Starting preview server on port ${port}...`);
    console.log(`  Interval: ${interval}ms`);
    console.log(`  Quality: ${quality}`);
    console.log(`  Type: ${type}`);
    console.log('');
    console.log('Open the viewer to see real-time browser preview:');
    console.log(`  HTML viewer: file://${cwd}/preview.html`);
    console.log(`  WebSocket: ws://localhost:${port}`);
    console.log('');
    console.log('Press Ctrl+C to stop the preview server');
    console.log('');

    const { DaemonManager } = await import('../daemon/daemon.js');

    const daemon = new DaemonManager();
    await daemon.startWSServer(port);

    const wsServer = daemon.getWSServer();
    if (!wsServer) {
      throw new Error('Failed to start WebSocket server');
    }

    wsServer.on('client-connected', (clientId: string) => {
      console.log(`[Preview] Client connected: ${clientId}`);
    });

    wsServer.on('client-disconnected', (clientId: string) => {
      console.log(`[Preview] Client disconnected: ${clientId}`);
    });

    process.on('SIGINT', async () => {
      console.log('\\n[Preview] Stopping preview server...');
      await daemon.stopWSServer();
      console.log('[Preview] Preview server stopped');
      process.exit(0);
    });
  },
};

export { previewBuiltin };
