import type { Page } from 'playwright';
import type { SmartTip, Snapshot } from './types.js';
import { DomWatcher } from './dom-watcher.js';
import { ContextTracker } from './context-tracker.js';
import { TipGenerator, buildSnapshot } from './tip-generator.js';

const DEBOUNCE_MS = 500;

export class TipsManager {
  private domWatcher: DomWatcher | null = null;
  private contextTracker = new ContextTracker();
  private generator = new TipGenerator(this.contextTracker);
  private beforeSnapshot: Snapshot | null = null;

  async beforeCommand(page: Page, commandName: string, params: Record<string, unknown>): Promise<void> {
    this.contextTracker.record(commandName, params);

    if (!this.domWatcher) {
      this.domWatcher = new DomWatcher(page);
    }

    try {
      await this.domWatcher.inject();
      const elements = await this.domWatcher.scanOverlays();
      this.beforeSnapshot = buildSnapshot(elements);
    } catch {
      this.beforeSnapshot = { timestamp: Date.now(), overlaySelectors: [] };
    }
  }

  async afterCommand(): Promise<SmartTip[]> {
    if (!this.domWatcher || !this.beforeSnapshot) return [];

    await this.debounce();

    try {
      const currentElements = await this.domWatcher.scanOverlays();
      const afterSnapshot = buildSnapshot(currentElements);

      const newElements = this.generator.diff(this.beforeSnapshot, afterSnapshot, currentElements);
      const tips = this.generator.generate(newElements);

      this.beforeSnapshot = null;

      return tips;
    } catch {
      this.beforeSnapshot = null;
      return [];
    }
  }

  private debounce(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS));
  }

  formatTips(tips: SmartTip[]): string[] {
    return tips.map((tip) => {
      const lines: string[] = [tip.message];
      for (const s of tip.suggestions) {
        lines.push(`  → ${s}`);
      }
      return lines.join('\n');
    });
  }

  reset(): void {
    this.beforeSnapshot = null;
    this.generator.resetDedup();
    this.contextTracker.clear();
    this.domWatcher = null;
  }
}

let globalTipsManager: TipsManager | null = null;

export function getTipsManager(): TipsManager {
  if (!globalTipsManager) {
    globalTipsManager = new TipsManager();
  }
  return globalTipsManager;
}

export function resetTipsManager(): void {
  if (globalTipsManager) {
    globalTipsManager.reset();
  }
  globalTipsManager = null;
}
