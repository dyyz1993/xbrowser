import type { BuiltinCommand, BuiltinContext } from './session.js';
import { getCaptchaConfig } from '../config.js';

const previewBuiltin: BuiltinCommand = {
  name: 'preview',
  description: 'Start real-time browser preview via WebSocket',
  help: {
    usage: 'xbrowser preview [options]',
    description: 'Start a WebSocket server to stream browser screenshots and command events in real-time',
    options: [
      { name: 'port', description: 'WebSocket port (default: 9223)' },
      { name: 'interval', description: 'Screenshot interval in ms (default: 500)' },
      { name: 'quality', description: 'JPEG quality 0-100 (default: 90)' },
      { name: 'type', description: 'Image type: jpeg or png (default: jpeg)' },
      { name: 'url', description: 'URL to navigate to (default: about:blank)' },
    ],
    examples: [
      { cmd: 'xbrowser preview', description: 'Start preview with default settings' },
      { cmd: 'xbrowser preview --port 8080', description: 'Start preview on custom port' },
      { cmd: 'xbrowser preview --interval 500 --quality 90', description: 'Fast refresh, high quality' },
      { cmd: 'xbrowser preview --url https://example.com', description: 'Preview a specific URL' },
    ],
  },
  execute: async (_args: string[], options: Record<string, unknown>, context: BuiltinContext): Promise<void> => {
    const { cwd } = context;
    const cfg = getCaptchaConfig();
    const port = options.port ? Number(options.port) : cfg.previewPort;
    const interval = options.interval ? Number(options.interval) : 500;
    const quality = options.quality ? Number(options.quality) : 90;
    const type = options.type === 'png' ? 'png' : 'jpeg' as const;
    const url = (options.url as string) || 'about:blank';

    console.log(`Starting preview server on port ${port}...`);
    console.log(`  Interval: ${interval}ms`);
    console.log(`  Quality: ${quality}`);
    console.log(`  Type: ${type}`);
    console.log(`  URL: ${url}`);
    console.log('');
    console.log('Open the viewer to see real-time browser preview:');
    console.log(`  HTML viewer: file://${cwd}/preview.html`);
    console.log(`  WebSocket: ws://localhost:${port}`);
    console.log('');
    console.log('Press Ctrl+C to stop the preview server');
    console.log('');

    const { DaemonManager } = await import('../daemon/daemon.js');
    const { ScreencastCapturer } = await import('../screencast.js');
    const { getBrowser, createSession } = await import('../browser.js');
    const { WebhookNotifier } = await import('../webhook.js');

    const daemon = new DaemonManager();
    await daemon.startWSServer(port);

    const wsServer = daemon.getWSServer();
    if (!wsServer) {
      throw new Error('Failed to start WebSocket server');
    }

    console.log(`[Preview] WS server listening on ws://localhost:${port}`);

    const browser = await getBrowser({ headless: false });
    const session = await createSession('preview', url);
    const page = session.page;

    console.log(`[Preview] Browser session started: ${url}`);

    wsServer.setPage(page);

    const webhook = new WebhookNotifier(cfg.notifyUrl);
    await webhook.notify({
      event: 'session-started',
      timestamp: new Date().toISOString(),
      url,
      previewUrl: `http://localhost:${port}`,
    });

    const capturer = new ScreencastCapturer({ interval, quality, type });
    capturer.startCapture(page, 'preview', (frame) => {
      wsServer.broadcast({
        type: 'screenshot',
        data: {
          sessionId: frame.sessionId,
          id: frame.id,
          timestamp: frame.timestamp,
          data: frame.data,
          url: frame.url,
          viewport: frame.viewport,
        },
      });
    });

    console.log(`[Preview] Screencast capturer started (${interval}ms interval)`);

    wsServer.on('client-connected', (clientId: string) => {
      console.log(`[Preview] Client connected: ${clientId}`);
    });

    wsServer.on('client-disconnected', (clientId: string) => {
      console.log(`[Preview] Client disconnected: ${clientId}`);
    });

    wsServer.on('human-solved', () => {
      console.log('[Preview] Human interaction resolved via preview');
    });

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log('\n[Preview] Stopping preview server...');
      capturer.stopCapture();
      console.log('[Preview] Screencast capturer stopped');

      await webhook.notify({
        event: 'session-ended',
        timestamp: new Date().toISOString(),
        url: page.url(),
      });

      await daemon.stopWSServer();
      console.log('[Preview] WS server stopped');

      try {
        await browser.close();
        console.log('[Preview] Browser closed');
      } catch {
        // ignore close errors
      }

      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await new Promise<void>(() => {});
  },
};

export { previewBuiltin };
