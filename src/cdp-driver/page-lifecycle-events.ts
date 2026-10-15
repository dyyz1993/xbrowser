import type { CDPConnection } from './connection.js';
import type { XBDIALOG } from './types.js';

interface DialogInfo {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
  defaultValue: string;
}

export function setupPageEvents(options: {
  conn: CDPConnection;
  sessionId: string;
  addSubscription(unsubscribe: () => void): void;
  emit(event: string, ...args: unknown[]): void;
  setUrl(url: string): void;
  mainFrame(): import('./types.js').XBFrame;
  markLoadFired(): void;
  markDomContentFired(): void;
  getBeforeUnloadAccept(): boolean;
  setInputFiles(selector: string, files: import('./types.js').XBFilePayload | import('./types.js').XBFilePayload[]): Promise<void>;
}): void {
    options.addSubscription(
      options.conn.subscribe('Page.frameNavigated', options.sessionId, (params: unknown) => {
        const p = params as { frame: { url: string } };
        if (p.frame) {
          options.setUrl(p.frame.url);
        }
        options.emit('framenavigated', options.mainFrame());
      }),
    );

    options.addSubscription(
      options.conn.subscribe('Page.loadEventFired', options.sessionId, () => {
        options.markLoadFired();
      }),
    );

    options.addSubscription(
      options.conn.subscribe('Page.domContentEventFired', options.sessionId, () => {
        options.markDomContentFired();
      }),
    );

    options.addSubscription(
      options.conn.subscribe('Page.javascriptDialogOpening', options.sessionId, (params: unknown) => {
        const p = params as DialogInfo;
        const dialog: XBDIALOG = {
          type: p.type,
          message: () => p.message,
          defaultValue: () => p.defaultValue,
          accept: async (text?: string) => {
            await options.conn.send('Page.handleJavaScriptDialog', {
              accept: true,
              promptText: text,
            }, options.sessionId);
          },
          dismiss: async () => {
            await options.conn.send('Page.handleJavaScriptDialog', {
              accept: false,
            }, options.sessionId);
          },
        };
        options.emit('dialog', dialog);

        // Auto-dismiss dialog on next tick (prevents page hangs on alert/confirm/prompt).
        // Playwright auto-dismisses by default; we do the same after the event is dispatched.
        // sup-s11: beforeunload 例外——dismiss=取消导航（回放录制的"离开页面"
        // 流被静默卡死，实测 net::ERR_ABORTED），默认 accept（离开），可经
        // setBeforeUnloadBehavior('dismiss') 配回留守语义。
        const autoAccept = p.type === 'beforeunload' ? options.getBeforeUnloadAccept() : false;
        setTimeout(() => {
          options.conn.send('Page.handleJavaScriptDialog', { accept: autoAccept }, options.sessionId)
            .catch(() => { /* dialog may already be handled */ });
        }, 0);
      }),
    );

    // Enable file chooser interception (optional - don't block if not needed)
    // options.conn.send('Page.setInterceptFileChooserDialog', { enabled: true }, options.sessionId).catch(() => {});

    options.addSubscription(
      options.conn.subscribe('Page.fileChooserOpened', options.sessionId, async (params: unknown) => {
        const p = params as { mode: string; backendNodeId: number };
        // Resolve backendNodeId to a selector
        let selector = '';
        try {
          const result = await options.conn.send('DOM.describeNode', { backendNodeId: p.backendNodeId }, options.sessionId) as { node: { attributes?: string[] } };
          const attrs = result.node?.attributes || [];
          const idIdx = attrs.indexOf('id');
          if (idIdx >= 0) selector = '#' + attrs[idIdx + 1];
        } catch { /* ignore */ }
        if (!selector) {
          try {
            const result = await options.conn.send('DOM.resolveNode', { backendNodeId: p.backendNodeId }, options.sessionId) as { objectId: string };
            const evalResult = await options.conn.send('Runtime.callFunctionOn', {
              objectId: result.objectId,
              functionDeclaration: 'function() { return this.id || this.name || "" }',
              returnByValue: true,
            }, options.sessionId) as { result: { value: string } };
            if (evalResult.result?.value) selector = '#' + evalResult.result.value;
          } catch { /* ignore */ }
        }

        const fileChooser: import('./types.js').XBFileChooser = {
          selector,
          isMultiple: p.mode === 'selectMultiple',
          setFiles: async (files: import('./types.js').XBFilePayload | import('./types.js').XBFilePayload[]) => {
            const fileArray = Array.isArray(files) ? files : [files];
            await options.setInputFiles(selector || 'input[type="file"]', fileArray);
          },
        };
        options.emit('filechooser', fileChooser);
      }),
    );
  }