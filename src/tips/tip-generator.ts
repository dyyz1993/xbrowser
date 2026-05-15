import type { DetectedElement, SmartTip, Snapshot, TipCategory } from './types.js';
import { classifyPriority } from './dom-watcher.js';
import { ContextTracker } from './context-tracker.js';

const SILENT_CATEGORIES = new Set<TipCategory>(['dropdown', 'tooltip']);
const NOTIFICATION_CATEGORIES = new Set<TipCategory>(['toast', 'notification']);

export class TipGenerator {
  private contextTracker: ContextTracker;
  private reportedSelectors = new Map<string, number>();
  private dedupWindowMs = 30_000;

  constructor(contextTracker: ContextTracker) {
    this.contextTracker = contextTracker;
  }

  diff(before: Snapshot, after: Snapshot, currentElements: DetectedElement[]): DetectedElement[] {
    const beforeSet = new Set(before.overlaySelectors);
    const afterSet = new Set(after.overlaySelectors);
    const newSelectors: string[] = [];
    for (const sel of afterSet) {
      if (!beforeSet.has(sel)) newSelectors.push(sel);
    }
    if (newSelectors.length === 0) return [];
    return currentElements.filter((el) => newSelectors.includes(el.selector));
  }

  generate(newElements: DetectedElement[]): SmartTip[] {
    const tips: SmartTip[] = [];

    for (const el of newElements) {
      if (this.contextTracker.isLikelyTriggered(el.selector)) continue;

      if (SILENT_CATEGORIES.has(el.category)) continue;

      if (NOTIFICATION_CATEGORIES.has(el.category) && el.text && /success|成功|done|完成|saved|已保存/i.test(el.text)) {
        continue;
      }

      if (this.isRecentlyReported(el.selector)) continue;

      const priority = classifyPriority(el.category, el);
      if (priority === 'p3') continue;

      const message = this.buildMessage(el);
      const suggestions = this.buildSuggestions(el);

      tips.push({
        priority,
        category: el.category,
        element: el,
        message,
        suggestions,
      });

      this.reportedSelectors.set(el.selector, Date.now());
    }

    tips.sort((a, b) => {
      const order: Record<string, number> = { p0: 0, p1: 1, p2: 2 };
      return (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
    });

    return tips;
  }

  private buildMessage(el: DetectedElement): string {
    const label = el.ariaLabel || el.text?.slice(0, 40) || '';
    const labelStr = label ? ` "${label}"` : '';
    const sizeStr = `${el.size.width}x${el.size.height}`;
    const typeLabel = this.categoryLabel(el.category);
    return `检测到新${typeLabel}${labelStr} (${sizeStr})，选择器: ${el.selector}`;
  }

  private buildSuggestions(el: DetectedElement): string[] {
    const suggestions: string[] = [];

    if (el.category === 'dialog' || el.category === 'modal') {
      const confirmBtn = this.guessButtonSelector(el, ['confirm', 'ok', 'yes', '确定', '确认', '同意']);
      const cancelBtn = this.guessButtonSelector(el, ['cancel', 'close', 'no', '取消', '关闭', '拒绝']);
      if (confirmBtn) suggestions.push(`click "${confirmBtn}"`);
      if (cancelBtn) suggestions.push(`click "${cancelBtn}"`);
    }

    if (el.category === 'popover' || el.category === 'overlay') {
      suggestions.push(`click "${el.selector}"`);
    }

    if (el.category === 'toast' || el.category === 'notification') {
      suggestions.push(`text "${el.selector}"`);
    }

    if (suggestions.length === 0) {
      suggestions.push(`click "${el.selector}"`);
    }

    return suggestions;
  }

  private guessButtonSelector(el: DetectedElement, keywords: string[]): string | undefined {
    const base = el.selector;
    for (const kw of keywords) {
      return `${base} button:has-text("${kw}"), ${base} [role="button"]:has-text("${kw}")`;
    }
    return undefined;
  }

  private categoryLabel(category: TipCategory): string {
    const labels: Record<TipCategory, string> = {
      dialog: 'Dialog',
      modal: 'Modal',
      popover: 'Popover',
      notification: '通知',
      toast: 'Toast',
      dropdown: '下拉菜单',
      tooltip: 'Tooltip',
      overlay: 'Overlay',
      unknown: '弹窗',
    };
    return labels[category] || '弹窗';
  }

  private isRecentlyReported(selector: string): boolean {
    const lastTime = this.reportedSelectors.get(selector);
    if (!lastTime) return false;
    return (Date.now() - lastTime) < this.dedupWindowMs;
  }

  resetDedup(): void {
    this.reportedSelectors.clear();
  }
}

export function buildSnapshot(elements: DetectedElement[]): Snapshot {
  return {
    timestamp: Date.now(),
    overlaySelectors: elements.map((el) => el.selector),
  };
}
