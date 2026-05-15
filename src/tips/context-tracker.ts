import type { ExecutionContext } from './types.js';

export class ContextTracker {
  private history: ExecutionContext[] = [];
  private maxHistory = 20;

  record(commandName: string, params: Record<string, unknown>): void {
    const entry: ExecutionContext = {
      commandName,
      params,
      timestamp: Date.now(),
      targetSelector: (params.selector as string) || (params.url as string) || undefined,
    };
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  getLastCommand(): ExecutionContext | undefined {
    return this.history.length > 0 ? this.history[this.history.length - 1] : undefined;
  }

  getLastSelector(): string | undefined {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].targetSelector) {
        return this.history[i].targetSelector;
      }
    }
    return undefined;
  }

  isLikelyTriggered(selector: string): boolean {
    const last = this.getLastCommand();
    if (!last) return false;

    const cmd = last.commandName.toLowerCase();
    const target = last.targetSelector?.toLowerCase() || '';

    if (['click', 'dblclick', 'hover', 'tap'].includes(cmd)) {
      return selector === target || selector.startsWith(target.split(/[.\[#]/)[0]);
    }

    if (['fill', 'type', 'select', 'check', 'uncheck'].includes(cmd)) {
      return selector === target;
    }

    return false;
  }

  isRecentCommand(cmdName: string, withinMs = 2000): boolean {
    const last = this.getLastCommand();
    if (!last) return false;
    return last.commandName === cmdName && (Date.now() - last.timestamp) < withinMs;
  }

  clear(): void {
    this.history = [];
  }
}
