import type { Page } from '../browser-shim.js';
import type { SmartTip, Snapshot } from './types.js';
import { DomWatcher } from './dom-watcher.js';
import { ContextTracker } from './context-tracker.js';
import { TipGenerator, buildSnapshot } from './tip-generator.js';
import { detectAntiBot, formatDetectionMessage, type DetectionConfig } from '../anti-bot-detection.js';

const DEBOUNCE_MS = 500;

// 需要跳过检测的命令列表
const SKIP_DETECT_COMMANDS = new Set([
  'goto',      // 导航命令不需要检测
  'screenshot', // 截图不需要检测
  'snapshot',  // snapshot 不需要检测
  'get',       // get 命令不需要检测
  'detect',    // detect 命令本身不需要检测
  'history',   // history 命令不需要检测
  'viewer',    // viewer 命令不需要检测
]);

// 需要重点检测的命令（交互类命令）
const INTERACTION_COMMANDS = new Set([
  'click',
  'fill',
  'type',
  'select',
  'check',
  'uncheck',
  'hover',
  'dblclick',
]);

export class TipsManager {
  private domWatcher: DomWatcher | null = null;
  private contextTracker = new ContextTracker();
  private generator = new TipGenerator(this.contextTracker);
  private beforeSnapshot: Snapshot | null = null;
  private lastDetectionTime = 0;

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

    // 反检测：在交互类命令执行前检测
    if (INTERACTION_COMMANDS.has(commandName) && !SKIP_DETECT_COMMANDS.has(commandName)) {
      await this.checkAntiBot(page, commandName);
    }
  }

  /**
   * 检测反机器人机制
   */
  private async checkAntiBot(page: Page, _commandName: string): Promise<void> {
    // 防抖：5秒内不重复检测
    const now = Date.now();
    if (now - this.lastDetectionTime < 5000) {
      return;
    }
    this.lastDetectionTime = now;

    const config: DetectionConfig = {
      checkCaptcha: true,
      checkWarning: true,
      checkBlocked: true,
      checkWebdriver: true,
    };

    const result = await detectAntiBot(page, config);

    if (result.detected && result.severity === 'high') {
      const message = formatDetectionMessage(result);
      console.error(`\n🚨 ${message}\n`);
      console.log('💡 Action blocked. To continue:');
      console.log('  1. Use viewer mode: xbrowser viewer --json');
      console.log('  2. Or skip detection with --skip-detect flag\n');

      // 抛出错误阻止命令执行
      throw new Error(`Anti-bot detection blocked: ${result.message}`);
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
    this.lastDetectionTime = 0;
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
