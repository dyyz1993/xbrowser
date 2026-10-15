import type { CDPConnection } from './connection.js';
import { queryJS } from './selector-utils.js';
import type { XBFilePayload } from './types.js';

export class FileInputService {
  constructor(
    private readonly options: {
      conn: CDPConnection;
      sessionId: string;
      evaluate: <T>(script: string) => Promise<T>;
      mouse: { move(x: number, y: number, opts?: { steps?: number }): Promise<void>; down(): Promise<void>; up(): Promise<void>; };
    },
  ) {}

  async dropFiles(selector: string, payload: XBFilePayload): Promise<void> {
    await this.options.evaluate(`
      (function() {
        var el = ${queryJS(selector)};
        if (!el) throw new Error('drop target not found: ' + ${JSON.stringify(selector)});
        var b64 = ${JSON.stringify(payload.buffer.toString('base64'))};
        var bin = atob(b64);
        var buf = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        var file = new File([buf], ${JSON.stringify(payload.name)}, { type: ${JSON.stringify(payload.mimeType)} });
        var dt = new DataTransfer();
        dt.items.add(file);
        var rect = el.getBoundingClientRect();
        var opts = {
          bubbles: true, cancelable: true,
          clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2,
        };
        el.dispatchEvent(new DragEvent('dragenter', Object.assign({ dataTransfer: dt }, opts)));
        el.dispatchEvent(new DragEvent('dragover', Object.assign({ dataTransfer: dt }, opts)));
        el.dispatchEvent(new DragEvent('drop', Object.assign({ dataTransfer: dt }, opts)));
      })()
    `);
  }

  async setInputFiles(selector: string, files: XBFilePayload | XBFilePayload[]): Promise<void> {
    const fileArr = Array.isArray(files) ? files : [files];

    // Use JavaScript DataTransfer API — more reliable across Chrome versions
    // than CDP DOM.setFileInputFiles which has inconsistent parameter formats
    const fileList = fileArr.map((f) => ({
      name: f.name,
      type: f.mimeType,
      dataBase64: f.buffer.toString('base64'),
    }));

    await this.options.evaluate(`
      (function() {
        var selector = ${JSON.stringify(selector)};
        var input = ${queryJS(selector)};
        if (!input) throw new Error('Element not found: ' + selector);

        var fileList = ${JSON.stringify(fileList)};
        var dt = new DataTransfer();

        fileList.forEach(function(f) {
          var binary = atob(f.dataBase64);
          var bytes = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          var blob = new Blob([bytes], { type: f.type });
          var file = new File([blob], f.name, { type: f.type });
          dt.items.add(file);
        });

        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
  }

  // ── dragAndDrop ─────────────────────────────────────────────

  async dragAndDrop(source: string, target: string): Promise<void> {

    // Get bounding boxes
    const sourceRect = await this.options.evaluate<{ x: number; y: number; width: number; height: number }>(`
      (function() {
        const el = ${queryJS(source)};
        if (!el) throw new Error('Source not found: ${source}');
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()
    `);

    const targetRect = await this.options.evaluate<{ x: number; y: number; width: number; height: number }>(`
      (function() {
        const el = ${queryJS(target)};
        if (!el) throw new Error('Target not found: ${target}');
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()
    `);

    const sx = sourceRect.x + sourceRect.width / 2;
    const sy = sourceRect.y + sourceRect.height / 2;
    const tx = targetRect.x + targetRect.width / 2;
    const ty = targetRect.y + targetRect.height / 2;

    // Simulate drag-and-drop via CDP Input.dispatchDragEvent
    // First try the DragData approach (more reliable for HTML5 drag-and-drop)
    try {
      await this.options.conn.send('Input.dispatchDragEvent', {
        type: 'dragStart',
        x: sx,
        y: sy,
        data: { items: [], dragOperations: ['copy', 'move', 'link'] },
      }, this.options.sessionId);

      await this.options.conn.send('Input.dispatchDragEvent', {
        type: 'dragOver',
        x: tx,
        y: ty,
        data: { items: [], dragOperations: ['copy', 'move', 'link'] },
      }, this.options.sessionId);

      await this.options.conn.send('Input.dispatchDragEvent', {
        type: 'drop',
        x: tx,
        y: ty,
        data: { items: [], dragOperations: ['copy', 'move', 'link'] },
      }, this.options.sessionId);

      await this.options.conn.send('Input.dispatchDragEvent', {
        type: 'dragCancel',
        x: sx,
        y: sy,
        data: { items: [], dragOperations: ['copy', 'move', 'link'] },
      }, this.options.sessionId);
    } catch {
      // Fallback: simulate via mouse events
      await this.options.mouse.move(sx, sy);
      await this.options.mouse.down();
      await this.options.mouse.move(tx, ty, { steps: 10 });
      await this.options.mouse.up();
    }
  }

  // ── setOfflineMode ──────────────────────────────────────────
}
