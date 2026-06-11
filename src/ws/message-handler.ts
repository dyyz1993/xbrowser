import type { WSInboundMessage, WSMessage } from '../websocket-server.js';
import type { StreamCoordinator } from './stream-coordinator.js';
import type { SessionManager } from './session-manager.js';
import type { Page } from '../browser-shim.js';

// ---------------------------------------------------------------------------
// Message context passed to every handler
// ---------------------------------------------------------------------------

export interface MessageContext {
  clientId: string;
  sessionId: string | undefined;
  page: Page | null;
  message: WSInboundMessage;
  cropOffset: { ox: number; oy: number };
  sendToClient(clientId: string, message: WSMessage): void;
  broadcastToSession(sessionId: string, message: WSMessage): void;
}

// ---------------------------------------------------------------------------
// Handler interface
// ---------------------------------------------------------------------------

export interface IMessageHandler {
  readonly type: string;
  handle(ctx: MessageContext): Promise<void>;
}

// ---------------------------------------------------------------------------
// Input handlers (mouse, keyboard)
// ---------------------------------------------------------------------------

class ClickHandler implements IMessageHandler {
  readonly type = 'click';
  constructor(private sc: StreamCoordinator) {}
  async handle(ctx: MessageContext): Promise<void> {
    const msg = ctx.message as Extract<WSInboundMessage, { type: 'click' }>;
    this.sc.onUserInteraction();
    if (ctx.page) {
      await ctx.page.mouse.click(msg.x + ctx.cropOffset.ox, msg.y + ctx.cropOffset.oy, { button: msg.button || 'left' });
    }
  }
}

class TypeHandler implements IMessageHandler {
  readonly type = 'type';
  constructor(private sc: StreamCoordinator) {}
  async handle(ctx: MessageContext): Promise<void> {
    const msg = ctx.message as Extract<WSInboundMessage, { type: 'type' }>;
    this.sc.onUserInteraction();
    if (ctx.page) {
      await ctx.page.keyboard.type(msg.text, { delay: 50 });
    }
  }
}

class KeypressHandler implements IMessageHandler {
  readonly type = 'keypress';
  constructor(private sc: StreamCoordinator) {}
  async handle(ctx: MessageContext): Promise<void> {
    const msg = ctx.message as Extract<WSInboundMessage, { type: 'keypress' }>;
    this.sc.onUserInteraction();
    if (ctx.page) {
      await ctx.page.keyboard.press(msg.key);
    }
  }
}

class ScrollHandler implements IMessageHandler {
  readonly type = 'scroll';
  constructor(private sc: StreamCoordinator) {}
  async handle(ctx: MessageContext): Promise<void> {
    const msg = ctx.message as Extract<WSInboundMessage, { type: 'scroll' }>;
    this.sc.onUserInteraction();
    if (ctx.page) {
      await ctx.page.mouse.wheel(msg.deltaX, msg.deltaY);
    }
  }
}

class InputMouseHandler implements IMessageHandler {
  readonly type = 'input_mouse';
  constructor(private sc: StreamCoordinator) {}
  async handle(ctx: MessageContext): Promise<void> {
    const msg = ctx.message as Extract<WSInboundMessage, { type: 'input_mouse' }>;
    this.sc.onUserInteraction();
    if (!ctx.page) return;
    const x = msg.x + ctx.cropOffset.ox;
    const y = msg.y + ctx.cropOffset.oy;
    switch (msg.action) {
      case 'move': await ctx.page.mouse.move(x, y); break;
      case 'down': await ctx.page.mouse.down({ button: msg.button || 'left' }); break;
      case 'up': await ctx.page.mouse.up({ button: msg.button || 'left' }); break;
      case 'click': await ctx.page.mouse.click(x, y, { button: msg.button || 'left' }); break;
    }
  }
}

class InputKeyboardHandler implements IMessageHandler {
  readonly type = 'input_keyboard';
  constructor(private sc: StreamCoordinator) {}
  async handle(ctx: MessageContext): Promise<void> {
    const msg = ctx.message as Extract<WSInboundMessage, { type: 'input_keyboard' }>;
    this.sc.onUserInteraction();
    if (!ctx.page) return;
    if (msg.action === 'down') await ctx.page.keyboard.down(msg.key);
    else await ctx.page.keyboard.up(msg.key);
  }
}

class InputFillHandler implements IMessageHandler {
  readonly type = 'input_fill';
  constructor(private sc: StreamCoordinator) {}
  async handle(ctx: MessageContext): Promise<void> {
    const msg = ctx.message as Extract<WSInboundMessage, { type: 'input_fill' }>;
    this.sc.onUserInteraction();
    if (!ctx.page) return;
    await ctx.page.fill(msg.selector, msg.text);
  }
}

class InputInsertTextHandler implements IMessageHandler {
  readonly type = 'input_insert_text';
  constructor(private sc: StreamCoordinator) {}
  async handle(ctx: MessageContext): Promise<void> {
    const msg = ctx.message as Extract<WSInboundMessage, { type: 'input_insert_text' }>;
    this.sc.onUserInteraction();
    if (!ctx.page) return;
    await ctx.page.keyboard.insertText(msg.text);
  }
}

// ---------------------------------------------------------------------------
// File handlers
// ---------------------------------------------------------------------------

class FileUploadHandler implements IMessageHandler {
  readonly type = 'file_upload';
  async handle(ctx: MessageContext): Promise<void> {
    const msg = ctx.message as Extract<WSInboundMessage, { type: 'file_upload' }>;
    if (!ctx.page) return;
    try {
      const selector = msg.selector || 'input[type="file"]';
      const result = await ctx.page.evaluate<{ ok: boolean; error?: string }>(
        ({ sel, fileName, base64Data, mimeType }: { sel: string; fileName: string; base64Data: string; mimeType: string }) => {
          const input = document.querySelector(sel) as HTMLInputElement;
          if (!input) return { ok: false, error: 'File input not found: ' + sel };
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
          const file = new File([bytes], fileName, { type: mimeType });
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        },
        { sel: selector, fileName: msg.fileName, base64Data: msg.data, mimeType: msg.mimeType },
      );
      if (result.ok) {
        ctx.sendToClient(ctx.clientId, { type: 'file_upload_result', success: true, fileName: msg.fileName });
      } else {
        ctx.sendToClient(ctx.clientId, { type: 'file_upload_result', success: false, fileName: msg.fileName, error: result.error });
      }
    } catch (err) {
      ctx.sendToClient(ctx.clientId, { type: 'file_upload_result', success: false, fileName: msg.fileName, error: String(err) });
    }
  }
}

class FileListHandler implements IMessageHandler {
  readonly type = 'file_list';
  async handle(ctx: MessageContext): Promise<void> {
    const msg = ctx.message as Extract<WSInboundMessage, { type: 'file_list' }>;
    try {
      const { readdirSync, statSync } = await import('fs');
      const { join, resolve } = await import('path');
      const targetPath = resolve(msg.path);
      const entries = readdirSync(targetPath);
      const files = entries.map(name => {
        try {
          const stat = statSync(join(targetPath, name));
          return { name, isDir: stat.isDirectory(), size: stat.size, modified: stat.mtime.toISOString() };
        } catch {
          return { name, isDir: false, size: 0, modified: '' };
        }
      });
      ctx.sendToClient(ctx.clientId, { type: 'file_list_result', path: targetPath, files });
    } catch (err) {
      ctx.sendToClient(ctx.clientId, { type: 'file_list_result', path: msg.path, files: [], error: String(err) });
    }
  }
}

class FileDownloadHandler implements IMessageHandler {
  readonly type = 'file_download';
  async handle(ctx: MessageContext): Promise<void> {
    const msg = ctx.message as Extract<WSInboundMessage, { type: 'file_download' }>;
    try {
      const { readFileSync } = await import('fs');
      const { resolve, basename } = await import('path');
      const targetPath = resolve(msg.path);
      const data = readFileSync(targetPath);
      const base64 = data.toString('base64');
      const ext = targetPath.split('.').pop()?.toLowerCase() || '';
      const mimeMap: Record<string, string> = {
        txt: 'text/plain', html: 'text/html', css: 'text/css', js: 'text/javascript',
        json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', zip: 'application/zip',
        md: 'text/markdown', xml: 'text/xml', csv: 'text/csv',
      };
      const mimeType = mimeMap[ext] || 'application/octet-stream';
      ctx.sendToClient(ctx.clientId, { type: 'file_download_result', fileName: basename(targetPath), mimeType, data: base64 });
    } catch (err) {
      ctx.sendToClient(ctx.clientId, { type: 'file_download_result', fileName: '', mimeType: '', data: '', error: String(err) });
    }
  }
}

// ---------------------------------------------------------------------------
// Focus / view handlers
// ---------------------------------------------------------------------------

class FocusElementHandler implements IMessageHandler {
  readonly type = 'focus_element';
  constructor(
    private sc: StreamCoordinator,
  ) {}
  async handle(ctx: MessageContext): Promise<void> {
    const msg = ctx.message as Extract<WSInboundMessage, { type: 'focus_element' }>;
    this.sc.onUserInteraction();
    if (!ctx.page || !ctx.sessionId) return;
    try {
      const element = await ctx.page.$(msg.selector);
      if (element) {
        const box = await element.boundingBox();
        if (box) {
          this.sc.setCrop(ctx.sessionId, { selector: msg.selector, box: { x: box.x, y: box.y, width: box.width, height: box.height } });
          ctx.broadcastToSession(ctx.sessionId, {
            type: 'status',
            data: { status: 'connected', viewport: { width: box.width, height: box.height } },
          });
          await this.sc.replayLastFrame(ctx.sessionId);
        }
      }
    } catch { /* ignore */ }
  }
}

class FocusClearHandler implements IMessageHandler {
  readonly type = 'focus_clear';
  constructor(private sc: StreamCoordinator) {}
  async handle(ctx: MessageContext): Promise<void> {
    if (!ctx.sessionId) return;
    this.sc.deleteCrop(ctx.sessionId);
    const vp = this.sc.getLastFrameViewport();
    if (vp) {
      ctx.broadcastToSession(ctx.sessionId, { type: 'status', data: { status: 'connected', viewport: vp } });
    }
    await this.sc.replayLastFrame(ctx.sessionId);
  }
}

class SelectViewHandler implements IMessageHandler {
  readonly type = 'select_view';
  constructor(private sc: StreamCoordinator) {}
  async handle(ctx: MessageContext): Promise<void> {
    const msg = ctx.message as Extract<WSInboundMessage, { type: 'select_view' }>;
    if (!ctx.sessionId) return;
    if (!msg.rect) {
      this.sc.deleteCrop(ctx.sessionId);
      const vp = this.sc.getLastFrameViewport();
      if (vp) {
        ctx.broadcastToSession(ctx.sessionId, { type: 'status', data: { status: 'connected', viewport: vp } });
      }
    } else {
      this.sc.setCrop(ctx.sessionId, { selector: 'view', box: msg.rect });
      ctx.broadcastToSession(ctx.sessionId, {
        type: 'status',
        data: { status: 'connected', viewport: { width: msg.rect.width, height: msg.rect.height } },
      });
    }
    await this.sc.replayLastFrame(ctx.sessionId);
  }
}

class InputBlurHandler implements IMessageHandler {
  readonly type = 'input_blur';
  constructor(private sm: SessionManager) {}
  async handle(ctx: MessageContext): Promise<void> {
    if (!ctx.sessionId) return;
    this.sm.clearMonitorFocusKey(ctx.sessionId);
    await this.sm.blurMonitorElement(ctx.sessionId);
  }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Routes inbound WS messages to the appropriate handler.
 *
 * Construct this once and call `dispatch()` for every non-bind message.
 * The `solved` message is special-cased because it emits an event on the
 * WSServer rather than performing a page action — the caller handles it.
 */
export class MessageDispatcher {
  private readonly handlers = new Map<string, IMessageHandler>();

  constructor(sc: StreamCoordinator, sm: SessionManager) {
    const all: IMessageHandler[] = [
      new ClickHandler(sc),
      new TypeHandler(sc),
      new KeypressHandler(sc),
      new ScrollHandler(sc),
      new InputMouseHandler(sc),
      new InputKeyboardHandler(sc),
      new InputFillHandler(sc),
      new InputInsertTextHandler(sc),
      new FileUploadHandler(),
      new FileListHandler(),
      new FileDownloadHandler(),
      new FocusElementHandler(sc),
      new FocusClearHandler(sc),
      new SelectViewHandler(sc),
      new InputBlurHandler(sm),
    ];
    for (const h of all) {
      this.handlers.set(h.type, h);
    }
  }

  /**
   * Dispatch an inbound message. Returns `true` if handled, `false` if the
   * message type is unknown (caller should handle it, e.g. 'solved').
   */
  async dispatch(ctx: MessageContext): Promise<boolean> {
    const handler = this.handlers.get(ctx.message.type);
    if (!handler) return false;
    await handler.handle(ctx);
    return true;
  }
}
