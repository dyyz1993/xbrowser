import type { Page } from '../browser-shim.js';
import type { DetectedElement, TipCategory } from './types.js';

const DOM_WATCHER_SCRIPT = `
(function() {
  if (window.__xbrowserDomWatcher) return;
  window.__xbrowserDomWatcher = true;

  window.__xbrowserDetectedElements = [];

  function getSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.getAttribute('aria-label')) {
      return el.tagName.toLowerCase() + '[aria-label="' + el.getAttribute('aria-label') + '"]';
    }
    const cls = el.className && typeof el.className === 'string'
      ? el.className.trim().split(/\\s+/).filter(c => c.length > 0 && !c.startsWith('__')).slice(0, 2).join('.')
      : '';
    if (cls) return el.tagName.toLowerCase() + '.' + cls;
    return el.tagName.toLowerCase();
  }

  function isPopupLike(el) {
    const tag = el.tagName?.toLowerCase();
    if (tag === 'dialog') return true;
    if (tag === 'body' || tag === 'html') return false;

    const role = el.getAttribute('role');
    if (['dialog', 'alertdialog', 'popover', 'alert'].includes(role)) return true;

    const cls = (typeof el.className === 'string') ? el.className.toLowerCase() : '';
    const popupPatterns = /modal|popup|popover|overlay|drawer|sheet|lightbox|dialog/;
    if (popupPatterns.test(cls)) return true;

    const style = window.getComputedStyle(el);
    if ((style.position === 'fixed' || style.position === 'absolute') && style.zIndex !== 'auto') {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && parseInt(style.zIndex) >= 100) return true;
    }

    return false;
  }

  function categorize(el) {
    const tag = el.tagName?.toLowerCase();
    const role = el.getAttribute('role');
    const cls = (typeof el.className === 'string') ? el.className.toLowerCase() : '';

    if (tag === 'dialog' || role === 'dialog' || role === 'alertdialog') return 'dialog';
    if (role === 'popover' || /popover/.test(cls)) return 'popover';
    if (/modal/.test(cls) && !/dropdown/.test(cls)) return 'modal';
    if (/toast|notification|message|notice|snack|alert/.test(cls)) return 'toast';
    if (/dropdown|select-menu|listbox|menu/.test(cls) || role === 'listbox') return 'dropdown';
    if (/tooltip|tip/.test(cls) || role === 'tooltip') return 'tooltip';
    if (/overlay|mask|backdrop|dimmer/.test(cls)) return 'overlay';
    return 'unknown';
  }

  function extractElement(el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return {
      selector: getSelector(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      text: (el.textContent || '').trim().slice(0, 100) || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      size: { width: Math.round(rect.width), height: Math.round(rect.height) },
      position: { x: Math.round(rect.x), y: Math.round(rect.y) },
      zIndex: parseInt(style.zIndex) || 0,
      category: categorize(el),
    };
  }

  function scanAndReport() {
    const results = [];
    document.querySelectorAll('*').forEach(el => {
      if (isPopupLike(el)) results.push(extractElement(el));
    });
    window.__xbrowserDetectedElements = results;
  }

  window.__xbrowserScanOverlays = function() {
    scanAndReport();
    return window.__xbrowserDetectedElements;
  };
})();
`;

export class DomWatcher {
  private page: Page;
  private injected = false;

  constructor(page: Page) {
    this.page = page;
  }

  async inject(): Promise<void> {
    if (this.injected) return;
    try {
      await this.page.evaluate(DOM_WATCHER_SCRIPT);
      await this.page.addInitScript(DOM_WATCHER_SCRIPT);
      this.injected = true;
    } catch {
      // page may not be ready
    }
  }

  async scanOverlays(): Promise<DetectedElement[]> {
    try {
      if (!this.injected) await this.inject();
      const result = await this.page.evaluate(
        'window.__xbrowserScanOverlays ? window.__xbrowserScanOverlays() : []'
      ) as DetectedElement[];
      return result || [];
    } catch {
      return [];
    }
  }
}

export function classifyPriority(category: TipCategory, element: DetectedElement): 'p0' | 'p1' | 'p2' | 'p3' {
  if (category === 'dialog' && element.text && /error|错误|fail|失败|denied|拒绝/i.test(element.text)) {
    return 'p0';
  }
  if (category === 'dialog' || category === 'modal') return 'p1';
  if (category === 'popover' || category === 'overlay') return 'p2';
  if (category === 'toast' || category === 'notification') return 'p2';
  if (category === 'dropdown') return 'p3';
  if (category === 'tooltip') return 'p3';
  return 'p2';
}
