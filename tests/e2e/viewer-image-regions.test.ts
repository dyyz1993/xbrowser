import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import sharp from 'sharp';

vi.mock('../../src/client/daemon-client.js', () => ({
  isDaemonRunning: vi.fn().mockResolvedValue(false),
  forwardExec: vi.fn(),
  forwardChain: vi.fn(),
}));
vi.mock('../../src/daemon/daemon.js', () => ({
  startDaemonProcess: vi.fn().mockRejectedValue(new Error('no daemon')),
  stopDaemonProcess: vi.fn(),
  getDaemonProcessStatus: vi.fn(),
}));

const chromiumExecutablePath = '/Applications/Chromium.app/Contents/MacOS/Chromium';
const e2eAvailable = process.env.XBROWSER_RUN_REAL_E2E === '1' && fs.existsSync(chromiumExecutablePath);
const describeE2E = e2eAvailable ? describe : describe.skip;

import {
  closeSessionByName,
  createSession,
  destroyBrowser,
  resetForTesting,
} from '../../src/index.js';
import { WSServer } from '../../src/websocket-server.js';
import type { Page } from '../../src/browser-shim.js';
import WebSocket from 'ws';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { previewHTML } from '../../src/daemon/preview-templates.js';

type ViewInfo = {
  id: string;
  label: string;
  kind: 'view' | 'image' | 'qr';
  src?: string;
  rect: { x: number; y: number; width: number; height: number };
};

type SnapshotResult = {
  type: 'snapshot_result';
  data: { data: string; format: string } | null;
  error?: string;
};

type ViewerUI = {
  page: Page;
  clickQrTab(): Promise<void>;
  waitForLiveRefresh(): Promise<void>;
};

const QR_TEXT = 'XBROWSER-E2E-20261021';
const QR_CANVAS_TEXT = 'XBROWSER-CANVAS-8899';
const QR_PRODUCT_TEXT = 'xbrowser-product-9527';

async function buildFixture(): Promise<string> {
  const canvasQrDataUrl = await QRCode.toDataURL(QR_CANVAS_TEXT, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 8,
  });
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Viewer image regions</title>
<style>
  body{margin:0;background:#eee;font-family:system-ui;color:#222}
  .wrap{display:grid;grid-template-columns:220px 180px 220px;gap:24px;padding:30px;align-items:start}
  h2{font-size:14px;margin:0 0 8px}
  img,canvas{display:block;border:1px solid #333;background:#fff}
  .qr{width:122px;height:122px}
  .product{width:182px;height:122px}
  .icon{width:20px;height:20px}
  .wide{width:182px;height:92px}
</style></head><body>
<div class="wrap">
  <section><h2>Semantic QR</h2><img id="semantic-qr" class="qr" alt="Login QR code" src="qr.png"><small>Scan text: ${QR_TEXT}</small></section>
  <section><h2>QR canvas · ${QR_CANVAS_TEXT}</h2><canvas id="qr-canvas" class="qr" title="Login 二维码" width="244" height="244"></canvas></section>
  <section><h2>Product</h2><img id="product" class="product" alt="Product photo" src="product.png"><small>Hidden payload: ${QR_PRODUCT_TEXT}</small></section>
  <section><h2>Hidden</h2><img id="hidden" class="qr" src="hidden.png" style="visibility:hidden"></section>
  <section><h2>Icon</h2><img id="icon" class="icon" src="icon.png"></section>
  <section><h2>Wide QR</h2><img id="wide" class="wide" alt="qrcode badge" src="wide.png"></section>
</div>
<img id="offscreen" class="qr" src="offscreen.png" alt="qrcode offscreen" style="position:absolute;top:900px;left:10px;display:none">
<script>
    const qrDataUrl = '${canvasQrDataUrl}';
    const c=document.getElementById('qr-canvas'), x=c.getContext('2d');
    x.fillStyle='#fff';x.fillRect(0,0,244,244);
    const source=new Image();
    source.onload=()=>x.drawImage(source,10,10,224,224);
    source.src=qrDataUrl;
</script>
</body></html>`;
}

async function writeQrPng(filePath: string, text: string, margin = 2): Promise<void> {
  await QRCode.toFile(filePath, text, {
    errorCorrectionLevel: 'M',
    margin,
    scale: 8,
  });
}

async function decodeQrFromImage(buffer: Buffer): Promise<{ data: string; width: number; height: number }> {
  const imported = await import('sharp');
  const sharp = imported.default ?? imported;
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = metadata.width ?? info.width;
  const height = metadata.height ?? info.height;
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  const result = jsQR(pixels, width, height, { inversionAttempts: 'attemptBoth' });
  if (!result) {
    throw new Error(`QR code was not scannable in captured image (${width}x${height})`);
  }
  return { data: result.data, width, height };
}

async function waitForMessage<T>(
  ws: WebSocket,
  predicate: (value: unknown) => boolean,
  timeoutMs = 12_000,
): Promise<T> {
  const inbox: unknown[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      removeListener();
      reject(new Error(`Timed out waiting for WebSocket message; received ${JSON.stringify(inbox.slice(0, 5))}`));
    }, timeoutMs);
    const listener = (raw: WebSocket.RawData, isBinary: boolean): void => {
      const rawBytes = typeof raw === 'string'
        ? Buffer.from(raw, 'utf8')
        : Buffer.from(raw as unknown as Uint8Array);
      let message: unknown;
      try {
        if (isBinary) {
          const headerLength = rawBytes.readUInt32BE(0);
          message = JSON.parse(rawBytes.subarray(4, 4 + headerLength).toString('utf8'));
        } else {
          message = JSON.parse(rawBytes.toString('utf8'));
        }
      } catch {
        return;
      }
      inbox.push(message);
      if (predicate(message)) {
        removeListener();
        resolve(message as T);
      }
    };
    const removeListener = (): void => {
      clearTimeout(timer);
      ws.off('message', listener);
    };
    ws.on('message', listener);
  });
}

function send(ws: WebSocket, message: unknown): void {
  ws.send(JSON.stringify(message));
}

async function openViewerUI(hostPage: Page, port: number, targetSessionName: string): Promise<ViewerUI> {
  const viewer = await hostPage.context().newPage();
  await viewer.setViewportSize({ width: 1280, height: 900 });
  await viewer.goto(`http://127.0.0.1:${port}/preview/${targetSessionName}`, {
    waitUntil: 'domcontentloaded',
    timeout: 10_000,
  });
  await viewer.waitForSelector('.view-tab', { state: 'visible', timeout: 10_000 });
  return {
    page: viewer,
    clickQrTab: async () => {
      await viewer.getByText('Login QR code', { exact: false }).click({ timeout: 10_000 });
    },
    waitForLiveRefresh: async () => {
      await viewer.waitForSelector('#snapshot-preview', { state: 'hidden', timeout: 10_000 });
    },
  };
}

describeE2E('E2E: viewer image and QR regions', () => {
  const sessionName = `viewer-image-e2e-${Date.now()}`;
  const outputDir = path.resolve('output/viewer-image-regions-e2e');
  let server: WSServer;
  let page: Page;
  let ws: WebSocket;
  let viewerPort: number;
  let httpServer: Server;

  beforeAll(async () => {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'fixture.html'), await buildFixture());
    await writeQrPng(path.join(outputDir, 'qr.png'), QR_TEXT);
    await writeQrPng(path.join(outputDir, 'product.png'), QR_PRODUCT_TEXT);
    await writeQrPng(path.join(outputDir, 'hidden.png'), 'should-not-be-visible');
    await writeQrPng(path.join(outputDir, 'icon.png'), 'too-small', 1);
    await writeQrPng(path.join(outputDir, 'wide.png'), 'wide-shape');
    await writeQrPng(path.join(outputDir, 'offscreen.png'), 'should-not-capture');

    const session = await createSession(sessionName, `file://${path.join(outputDir, 'fixture.html')}`, {
      executablePath: chromiumExecutablePath,
      headless: true,
    });
    page = session.page;
    server = new WSServer({ port: 0 });
    server.registerSession(sessionName, page);

    viewerPort = await new Promise<number>((resolve, reject) => {
      httpServer = require('node:http').createServer((req: IncomingMessage, res: ServerResponse) => {
        const urlPath = (req.url || '/').replace(/\?.*$/, '');
        if (urlPath === '/preview' || urlPath.startsWith('/preview/')) {
          const targetSession = urlPath.replace(/^\/preview\/?/, '').replace(/\/+$/, '') || 'default';
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(previewHTML(targetSession, req.headers.host || '127.0.0.1'));
          return;
        }
        res.writeHead(404);
        res.end('Not Found');
      });
      httpServer.listen(0, '127.0.0.1', () => {
        const address = httpServer.address();
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Failed to bind viewer HTTP server'));
      });
      httpServer.on('error', reject);
      void server.attachToServer(httpServer, '/preview');
    });
    ws = new WebSocket(`ws://127.0.0.1:${viewerPort}/preview/${sessionName}`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
  }, 30_000);

  afterAll(async () => {
    ws?.close();
    await server?.stop().catch(() => undefined);
    httpServer?.close();
    server?.unregisterSession(sessionName);
    await closeSessionByName(sessionName);
    await destroyBrowser();
    resetForTesting();
  });

  it('detects meaningful image regions and rejects noise', async () => {
    const viewer = await openViewerUI(page, viewerPort, sessionName);
    const update = await waitForMessage<{ type: 'views_update'; views: ViewInfo[] }>(
      ws,
      value => (value as { type?: string })?.type === 'views_update',
    );
    const ids = update.views.map(view => view.id);
    fs.writeFileSync(path.join(outputDir, 'views-update.json'), JSON.stringify(update, null, 2));

    expect(ids.some(id => id.endsWith('semantic-qr'))).toBe(true);
    expect(ids.some(id => id.endsWith('qr-canvas'))).toBe(true);
    expect(ids.some(id => id.endsWith('product'))).toBe(true);
    expect(ids).not.toContain('hidden');
    expect(ids).not.toContain('icon');
    expect(ids).not.toContain('wide');
    expect(ids).not.toContain('offscreen');
    expect(update.views[0]?.kind).toBe('qr');

    // Capture the actual Viewer shell before interaction: toolbar, view tabs, and canvas.
    await viewer.page.waitForTimeout(1_000);
    const before = await viewer.page.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(outputDir, 'viewer-ui-before.png'), before);
    await viewer.clickQrTab();
    await viewer.waitForLiveRefresh();
    await viewer.page.waitForTimeout(1_500);
    const liveRegion = await viewer.page.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(outputDir, 'viewer-ui-live-region.png'), liveRegion);
    await viewer.page.close();
  }, 20_000);

  it('recaptures a QR region at scale 4 and captures the viewer preview state', async () => {
    const viewer = await openViewerUI(page, viewerPort, sessionName);
    const update = await waitForMessage<{ type: 'views_update'; views: ViewInfo[] }>(
      ws,
      value => (value as { type?: string })?.type === 'views_update',
    );
    const qr = update.views.find(view => view.id.endsWith('semantic-qr'));
    expect(qr).toBeDefined();

    send(ws, {
      type: 'snapshot_request',
      format: 'webp',
      quality: 95,
      clip: qr!.rect,
      scale: 4,
    });
    const result = await waitForMessage<SnapshotResult>(
      ws,
      value => (value as { type?: string })?.type === 'snapshot_result',
    );
    expect(result.error).toBeUndefined();
    expect(result.data?.format).toBe('webp');
    const recaptured = Buffer.from(result.data!.data, 'base64');
    fs.writeFileSync(path.join(outputDir, 'qr-recaptured.webp'), recaptured);
    const scannedPayload = await decodeQrFromImage(recaptured);
    expect(scannedPayload.data).toBe(QR_TEXT);
    fs.writeFileSync(
      path.join(outputDir, 'qr-scan-result.json'),
      JSON.stringify({ source: 'qr-recaptured.webp', decodedText: scannedPayload.data }, null, 2),
    );

    expect(scannedPayload.width).toBeGreaterThanOrEqual(qr!.rect.width * 4 - 2);
    expect(scannedPayload.height).toBeGreaterThanOrEqual(qr!.rect.height * 4 - 2);

    // Exercise the real Viewer interaction path: clicking the QR tab sends a
    // scale-4 recapture but must not cover the live viewport with a preview modal.
    await viewer.clickQrTab();
    await viewer.waitForLiveRefresh();
    await viewer.page.waitForTimeout(1_500);
    await viewer.page.waitForTimeout(300);
    const after = await viewer.page.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(outputDir, 'viewer-ui-after.png'), after);
    await sharp(recaptured).png().toFile(path.join(outputDir, 'qr-recaptured.png'));
    expect(after.length).toBeGreaterThan(0);
    await viewer.page.close();
  }, 20_000);
});
