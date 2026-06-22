import type { Page } from '../browser-shim.js';
import type { WSMessage } from '../websocket-server.js';

export interface FocusInfo {
  focused: boolean;
  selector?: string;
  value?: string;
  tag?: string;
  placeholder?: string;
  isFileInput?: boolean;
  seq?: number;
}

/**
 * Monitors DOM elements for a browser page session.
 *
 * Manages two periodic tasks:
 * 1. **Focus polling** (every 500ms): Detects input focus/blur changes and
 *    notifies via callback.
 * 2. **Element scanning** (every 3s): Detects visible dialogs, modals, forms
 *    and reports them as "views" via callback.
 *
 * Callers provide callbacks at construction; `start()` / `stop()` control the
 * lifecycle and guarantee timer cleanup.
 */
export class ElementMonitor {
  private focusPollTimer: ReturnType<typeof setInterval> | null = null;
  private elementScanTimer: ReturnType<typeof setInterval> | null = null;
  private lastFocusKey = '';
  private isRunning = false;

  constructor(
    private readonly page: Page,
    private readonly onFocusChange: (message: WSMessage) => void,
    private readonly onViewsUpdate: (message: WSMessage) => void,
    private readonly getClientCount: () => number,
  ) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.injectFocusListeners();
    this.page.on('load', () => {
      this.injectFocusListeners();
    });

    this.focusPollTimer = setInterval(() => {
      this.pollFocus().catch(() => {});
    }, 500);

    this.elementScanTimer = setInterval(() => {
      this.scanElements().catch(() => {});
    }, 3000);
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.focusPollTimer) {
      clearInterval(this.focusPollTimer);
      this.focusPollTimer = null;
    }
    if (this.elementScanTimer) {
      clearInterval(this.elementScanTimer);
      this.elementScanTimer = null;
    }
  }

  clearLastFocusKey(): void {
    this.lastFocusKey = '';
  }

  async blurActiveElement(): Promise<void> {
    try {
      await this.page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        window.__xb_last_focused = null;
      });
    } catch { /* ignore */ }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private injectFocusListeners(): void {
    const fn = () => {
      document.addEventListener('focusin', (e) => {
        const el = e.target as HTMLElement;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.contentEditable === 'true') {
          
          window.__xb_focus_seq = ((window.__xb_focus_seq as number) || 0) + 1;
          const info: { selector: string; tag: string; value: string; placeholder: string; isFileInput?: boolean; seq: number } = {
            selector: '',
            tag: el.tagName,
            value: (el as HTMLInputElement).value || '',
            placeholder: (el as HTMLInputElement).placeholder || '',
            seq: window.__xb_focus_seq as number,
          };
          if (el.id) info.selector = '#' + el.id;
          else if (el.getAttribute('name')) info.selector = '[name="' + el.getAttribute('name') + '"]';
          else info.selector = el.tagName.toLowerCase();
          if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file') {
            info.isFileInput = true;
          }
          window.__xb_last_focused = info;
        }
      }, true);
      document.addEventListener('focusout', () => {
        window.__xb_last_focused = null;
      }, true);
    };
    this.page.evaluate(fn).catch(() => {});
  }

  private async pollFocus(): Promise<void> {
    if (this.getClientCount() <= 0) return;
    try {
      const info: FocusInfo = await this.page.evaluate(() => {
        const f = window.__xb_last_focused;
        if (f) return { focused: true, ...f as object };
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.contentEditable === 'true')) {
          const sel = active.id ? '#' + active.id : (active.getAttribute('name') ? '[name="' + active.getAttribute('name') + '"]' : active.tagName.toLowerCase());
          return {
            focused: true,
            selector: sel,
            tag: active.tagName,
            value: (active as HTMLInputElement).value || '',
            placeholder: (active as HTMLInputElement).placeholder || '',
            isFileInput: active.tagName === 'INPUT' && (active as HTMLInputElement).type === 'file',
          };
        }
        return { focused: false };
      });
      const focusKey = info.focused ? `${info.selector || 'unknown'}#${info.seq ?? 0}` : '';
      if (focusKey === this.lastFocusKey) return;
      this.lastFocusKey = focusKey;
      if (info.focused && info.selector) {
        if (info.isFileInput) {
          this.onFocusChange({ type: 'file_input_clicked', selector: info.selector });
        } else {
          this.onFocusChange({ type: 'input_focused', selector: info.selector, value: info.value || '', tag: info.tag || '', placeholder: info.placeholder });
        }
      } else {
        this.onFocusChange({ type: 'input_blur', selector: '' });
      }
    } catch { /* ignore */ }
  }

  private async scanElements(): Promise<void> {
    if (this.getClientCount() <= 0) return;
    try {
      type ElInfo = { tag: string; id: string; cls: string; rect: { x: number; y: number; width: number; height: number } };
      const elements: ElInfo[] = await this.page.evaluate(() => {
        const sel = '[role="dialog"],dialog,[class*="modal"],[class*="popup"],[class*="overlay"],[class*="drawer"],form';
        const els = document.querySelectorAll(sel);
        const results: ElInfo[] = [];
        const vpW = window.innerWidth, vpH = window.innerHeight;
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.width < 50 || r.height < 30) continue;
          if (r.width * r.height > vpW * vpH * 0.9) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
          const htmlEl = el as HTMLElement;
          results.push({
            tag: el.tagName,
            id: el.id || '',
            cls: (typeof htmlEl.className === 'string' ? htmlEl.className : '').slice(0, 40),
            rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
          });
        }
        return results;
      });
      const views = elements.map((e, i) => ({
        id: 'el-' + i + '-' + (e.id || e.tag),
        label: e.id || e.cls || e.tag,
        rect: e.rect,
      }));
      this.onViewsUpdate({ type: 'views_update', views });
    } catch { /* ignore */ }
  }
}
